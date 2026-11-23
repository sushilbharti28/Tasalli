import { randomUUID } from 'node:crypto';
import type { CallStep, PlaceCallRequest } from '@tasalli/contracts';
import { CONSENT_KEYS, REMINDER_KEYS, RULES } from '../contracts-values.js';
import { speakNumbers, scriptOf } from '../scripts/spoken-numbers.js';
import { presencePrompt, buildReminderSteps, describeMedicineIds, newMedicineIds, relationPhrase, line, personName, childName } from '../scripts/builder.js';
import { localDay } from '../scheduler/time.js';
import type { CallSession } from '../flows/session.js';
import type { PersonRow } from '../types.js';
import { ownerEntitled } from './billing.js';
import { type Deps, decodeAttempt, encodeAttempt } from './deps.js';
import { callLanguage } from './language.js';
import { MINUTE } from '../clock.js';
import { hardLimitSeconds } from '../flows/limits.js';

export function listenStep(d: Deps, audioUrl: string, purpose: 'consent' | 'reminder' | 'test', speech = true, first = false): CallStep {
  const keys = purpose === 'reminder' ? Object.keys(REMINDER_KEYS) : purpose === 'consent' ? Object.keys(CONSENT_KEYS) : [...'0123456789*#']; // test call: any key
  return { audioUrl, listen: { keys, speech, timeoutSeconds: first ? d.config.firstListenSeconds : d.config.listenSeconds } };
}

export async function alertFor(d: Deps, person: PersonRow, kind: Parameters<Deps['queue']['alert']>[0]['kind'],
  groupId: string | null, doseIds: string[], jobKey: string, reason?: string, localDate?: string) {
  await d.queue.alert({ kind, personId: person.id, ownerUserId: person.ownerUserId, callGroupId: groupId, doseIds,
    at: d.clock.now().toISOString(), reason, ...(localDate ? { localDate } : {}) }, jobKey);
}

type PlaceOutcome = 'placed' | 'capped' | 'blocked' | 'failed';

/** Cap + block check, call row, provider call. Phone lock makes the 6/day cap race-free (rule 5). */
async function place(d: Deps, o: { person: PersonRow | null; to: string; zone: string; purpose: 'consent' | 'reminder' | 'test';
  groupId: string | null; attempt: number; language: PersonRow['language']; session: Omit<CallSession, 'callId' | 'to' | 'purpose' | 'language'> }): Promise<PlaceOutcome> {
  const now = d.clock.now();
  const gate = await d.store.transaction(async (tx) => {
    await tx.lockPhone(o.to);
    if (await tx.isBlocked(o.to)) return { out: 'blocked' as const };
    if (o.purpose !== 'test' && await tx.countCallsToPhoneSince(o.to, localDay(now, o.zone).start) >= RULES.maxCallsPerNumberPerDay) {
      return { out: 'capped' as const };
    }
    const row = await tx.insertCall({ personId: o.person?.id ?? null, purpose: o.purpose, callGroupId: o.groupId, attempt: o.attempt,
      provider: d.provider.name, status: 'queued' }, now);
    return { out: 'ok' as const, row };
  });
  if (gate.out !== 'ok') return gate.out;
  const callId = gate.row.id;
  await d.sessions.set({ callId, purpose: o.purpose, language: o.language, to: o.to, ...o.session });
  try {
    const first = listenStep(d, await d.audio.urlFor(speakNumbers(o.session.mainText, scriptOf(d.scripts.get(o.language).templates.reminder.step_ack_next)), o.language), o.purpose, true, true);
    const req: PlaceCallRequest & { timeLimitSeconds?: number } = { callId, to: o.to, callerId: d.config.callerId, language: o.language, purpose: o.purpose,
      firstStep: first, statusWebhookUrl: `${d.config.publicBaseUrl}/webhooks/${d.provider.name}/status`,
      inputWebhookUrl: `${d.config.publicBaseUrl}/webhooks/${d.provider.name}/input` };
    if (o.purpose === 'reminder' && o.session.reminder) req.timeLimitSeconds = hardLimitSeconds(o.session.reminder.items.length); // hard backstop behind the soft limit
    const res = await d.provider.placeCall(req);
    await d.store.updateCall(callId, { providerCallId: res.providerCallId });
    return 'placed';
  } catch (err) {
    d.log.error('placeCall failed', { callId, to: o.to, err: (err as Error).message });
    await d.store.updateCall(callId, { status: 'failed', endedAt: d.clock.now() });
    return 'failed';
  }
}

const blank = { unclearCount: 0, repeats: 0, steps: 0, keypadOnly: false, responses: {} };

/** Reminder call for a dose group. attemptCode = encodeAttempt(cycle, n). */
export async function placeReminder(d: Deps, groupId: string, attemptCode: number): Promise<void> {
  const details = (await d.store.getGroupDetails(groupId)).filter((x) => x.dose.status === 'calling' || x.dose.status === 'upcoming');
  if (details.length === 0) return; // confirmed in the app meanwhile, or closed
  const person = await d.store.getPerson(details[0]!.dose.personId);
  if (!person) return;
  const user = await d.store.getUser(person.ownerUserId);
  const doseIds = details.map((x) => x.dose.id);
  const stop = async (to: 'skipped_paused' | 'missed', reason?: string) => {
    if ((await d.store.closeGroup(groupId, to)) > 0 && reason) await alertFor(d, person, 'dose_missed', groupId, doseIds, `missed_${groupId}`, reason);
  };
  if (person.deleted || person.paused || person.consent !== 'consented' || await d.store.isBlocked(person.phone)) return void await stop('skipped_paused');

  // Billing gate: no reminder call (first call, retry or snooze) for an account that is not entitled. The family gets one plan_lapsed alert a day (not dose_missed: nothing was missed by the parent).
  if (!(await ownerEntitled(d, person.ownerUserId))) {
    d.log.info('reminder skipped: subscription not entitled', { personId: person.id, groupId });
    await d.store.closeGroup(groupId, 'skipped_paused');
    // Tell the child, once per owner per local day: the job id dedupes every attempt, retry and person of this owner.
    const localDate = localDay(d.clock.now(), user?.timeZone ?? person.timeZone).date;
    await alertFor(d, person, 'plan_lapsed', groupId, doseIds, `plan_lapsed_${person.ownerUserId}_${localDate}`, 'plan_not_entitled', localDate);
    return;
  }

  const now = d.clock.now();
  const day = localDay(now, person.timeZone);
  const lang = callLanguage(d, person.language, person.id);
  const pack = d.scripts.get(lang);
  const prior = await d.store.answeredRemindersBetween(person.id, day.start, day.end, groupId);
  const base = {
    templates: pack.templates, person, childName: user?.name ?? null, isSunday: day.isSunday,
    localHour: localDay(details[0]!.dose.dueAt, person.timeZone).hour, // the dose time (not the retry time) picks the meal name
    announcedTodayMedicineIds: prior.medicineIds, items: details.map((x) => ({ medicine: x.medicine, schedule: x.schedule })),
  };
  // One medicine at a time. v1.6: look and pack are said only for medicines where they matter (describeMedicineIds); the rest get
  // name and family name, and "phir se" / 0 plays the full description. `mode` still picks the intro wording.
  const mode = prior.answeredCalls === 0 ? 'full' : 'short';
  const allActive = (await d.store.listActiveSchedules(person.id)).map((x) => x.medicine);
  const describe = describeMedicineIds({ items: base.items, allActive, canReadStrip: person.canReadStrip, now, localToday: day.date });
  const steps = buildReminderSteps({ ...base, mode, describeMedicineIds: describe, newMedicineIds: newMedicineIds(base.items, now) });
  const reminder = { items: details.map((x, i) => ({ doseId: x.dose.id, first: steps.items[i]!.first, full: steps.items[i]!.full })),
    index: 0, outcomes: {}, heard: {}, retryLeft: decodeAttempt(attemptCode).n < RULES.retryCount };
  const out = await place(d, { person, to: person.phone, zone: person.timeZone, purpose: 'reminder', groupId, attempt: attemptCode,
    language: lang, session: steps.presence
      ? { ...blank, mainText: presencePrompt(steps.greeting, steps.presence), fullText: steps.items[0]!.full, reminder, presence: { state: 'pending' as const, asks: 0, text: steps.presenceRetry, next: steps.opening } }
      : { ...blank, mainText: presencePrompt(steps.greeting, steps.opening), fullText: steps.items[0]!.full, reminder } });
  if (out === 'capped') return void await stop('missed', 'daily_cap');
  if (out === 'blocked') return void await stop('skipped_paused');
  if (out === 'failed') await afterNoConfirmation(d, groupId, attemptCode);
}

/** Unanswered, busy, failed, or hung up without confirming: retry 10 minutes later, or give up. */
export async function afterNoConfirmation(d: Deps, groupId: string, attemptCode: number): Promise<void> {
  const { cycle, n } = decodeAttempt(attemptCode);
  if (n < RULES.retryCount) {
    const next = encodeAttempt(cycle, n + 1);
    await d.queue.add('reminder.retry', { callGroupId: groupId, attempt: next, cycle }, { delayMs: RULES.retryGapMinutes * MINUTE, jobId: `retry_${groupId}_${next}` });
    return;
  }
  const details = await d.store.getGroupDetails(groupId);
  if (details.length === 0) return;
  const person = await d.store.getPerson(details[0]!.dose.personId);
  if (person && (await d.store.closeGroup(groupId, 'missed')) > 0) {
    await alertFor(d, person, 'dose_missed', groupId, details.map((x) => x.dose.id), `missed_${groupId}`, 'retries_exhausted');
  }
}

export async function placeConsent(d: Deps, personId: string, attempt: number): Promise<void> {
  const person = await d.store.getPerson(personId);
  if (!person || person.deleted || person.consent === 'consented' || person.consent === 'opted_out') return;
  if (await d.store.isBlocked(person.phone)) return;
  const user = await d.store.getUser(person.ownerUserId);
  const lang = callLanguage(d, person.language, person.id);
  const t = d.scripts.get(lang).templates;
  const text = line(t.consent.prompt, { person_name: personName(t, person), child_name: childName(t, user?.name ?? null), relation_phrase: relationPhrase(t, person.callerRelation) });
  // Same presence check as reminder calls: greeting, "can you hear me?", and only after a yes the consent question (without its own greeting).
  const rs = t.reminder;
  const spoken = (x: string) => speakNumbers(x, scriptOf(rs.step_ack_next));
  const greeting = rs.step_greeting ? spoken(line(rs.step_greeting, { person_name: personName(t, person) })) : '';
  const question = rs.step_presence ? spoken(rs.step_presence) : '';
  const next = greeting && text.startsWith(greeting) ? text.slice(greeting.length).trim() : text;
  const out = await place(d, { person, to: person.phone, zone: person.timeZone, purpose: 'consent', groupId: null, attempt, language: lang,
    session: question && greeting ? { ...blank, mainText: presencePrompt(greeting, question), fullText: text, presence: { state: 'pending', asks: 0, text: question, next } }
      : { ...blank, mainText: text, fullText: text } });
  if (out === 'capped') return void await alertFor(d, person, 'consent_no_answer', null, [], `consent_noanswer_${person.id}`, 'daily_cap');
  if (out === 'failed') await consentUnanswered(d, personId, attempt);
}

export async function consentUnanswered(d: Deps, personId: string, attempt: number): Promise<void> {
  if (attempt < RULES.retryCount) {
    await d.queue.add('consent.retry', { personId, attempt: attempt + 1 }, { delayMs: RULES.retryGapMinutes * MINUTE, jobId: `cretry_${personId}_${attempt + 1}` });
    return;
  }
  const person = await d.store.getPerson(personId);
  if (!person || person.consent !== 'pending') return;
  await d.store.insertConsentEvent({ personId, result: 'no_answer', via: 'key', callId: null });
  await alertFor(d, person, 'consent_no_answer', null, [], `consent_noanswer_${personId}`, 'retries_exhausted');
}

export async function placeTest(d: Deps, userId: string): Promise<void> {
  const user = await d.store.getUser(userId);
  if (!user || user.deleted) return;
  const day = localDay(d.clock.now(), user.timeZone).date;
  if ((await d.sessions.incr(`test_${userId}_${day}`, 86400)) > d.config.testCallsPerDay) return;
  const lang = callLanguage(d, user.locale, null);
  const t = d.scripts.get(lang).templates;
  const text = line(t.test.prompt, { person_name: personName(t, { nickname: '', fullName: user.name ?? null }) /* the test call greets the account holder by their own name */ });
  await place(d, { person: null, to: user.phone, zone: user.timeZone, purpose: 'test', groupId: null, attempt: 0, language: lang,
    session: { ...blank, mainText: text, fullText: text } });
}

export const newGroupId = () => randomUUID();
