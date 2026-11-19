import type { CallEvent, NextAction, ReplyIntent } from '@tasalli/contracts';
import { CONSENT_KEYS, REMINDER_KEYS, RULES } from '../contracts-values.js';
import { MINUTE } from '../clock.js';
import { fetchAudio } from '../providers/fake-speech.js';
import { line, childName } from '../scripts/builder.js';
import { matchIntent } from '../speech/intent.js';
import type { CallSession } from '../flows/session.js';
import type { CallResultRow, CallRow, PersonRow } from '../types.js';
import { alertFor, listenStep } from './calls.js';
import type { Deps } from './deps.js';

type InputEvent = Extract<CallEvent, { type: 'input' }>;

/** Turn a webhook input into an intent. Silence, unknown keys, low confidence and speech on a keypad-only step are 'unclear'. */
async function interpret(d: Deps, s: CallSession, ev: InputEvent): Promise<{ intent: ReplyIntent; kind: 'key' | 'speech'; raw: string }> {
  const ctx = s.purpose === 'reminder' ? 'reminder' : 'consent';
  if (ev.kind === 'key') {
    const map = ctx === 'reminder' ? REMINDER_KEYS : CONSENT_KEYS;
    return { intent: map[ev.value] ?? 'unclear', kind: 'key', raw: ev.value };
  }
  if (s.keypadOnly) return { intent: 'unclear', kind: 'speech', raw: '' };
  let transcript = ev.transcript;
  let confidence = (ev as { confidence?: number }).confidence ?? 1;
  if (transcript === undefined && ev.audioUrl) {
    try {
      const r = await d.speech.transcribe(await fetchAudio(ev.audioUrl), s.language);
      transcript = r.transcript;
      confidence = r.confidence;
    } catch (err) {
      d.log.warn('transcribe failed', { callId: s.callId, err: (err as Error).message });
    }
  }
  let intent = matchIntent(transcript, d.scripts.get(s.language).phrases, ctx, confidence).intent;
  // Opting out must work in any language the parent might say it in.
  if (intent !== 'stop') {
    for (const lang of ['hi', 'en'] as const) {
      if (matchIntent(transcript, d.scripts.get(lang).phrases, ctx, confidence).intent === 'stop') intent = 'stop';
    }
  }
  return { intent, kind: 'speech', raw: transcript ?? '' };
}

/** Handle one input event for a live call. Returns what the call does next. Everything it changes is idempotent. */
export async function handleInput(d: Deps, call: CallRow, s: CallSession, ev: InputEvent): Promise<NextAction> {
  const t = d.scripts.get(s.language).templates;
  const say = async (text: string) => d.audio.urlFor(text, s.language);
  const bye = async (text: string, result: CallResultRow): Promise<NextAction> => {
    await d.store.updateCall(call.id, { result });
    return { action: 'hangup', finalAudioUrl: await say(text) };
  };
  const stored = call.personId ? await d.store.getPerson(call.personId) : null;
  const person = stored && { ...stored, language: s.language }; // scripts follow the language the call was placed in
  const user = person ? await d.store.getUser(person.ownerUserId) : null;
  const child = childName(t, user?.name ?? null);
  s.steps++;

  // Test call: any key (or any speech) ends it; there is nothing to decide.
  if (s.purpose === 'test') {
    return bye(ev.kind === 'key' || ev.transcript || ev.audioUrl ? t.test.ack : t.reminder.no_input_goodbye, ev.kind === 'key' || ev.transcript || ev.audioUrl ? 'confirmed' : 'none');
  }

  const { intent, kind, raw } = await interpret(d, s, ev);
  await d.store.updateCall(call.id, { inputKind: kind, inputValue: kind === 'key' ? raw : raw.slice(0, 80) });
  const ask = async (text: string, speech: boolean): Promise<NextAction> => ({ action: 'play', step: listenStep(d, await say(text), s.purpose, speech) });

  if (intent === 'unclear') {
    s.unclearCount++;
    if (s.unclearCount === 1) return ask(s.purpose === 'consent' ? t.consent.unclear : t.reminder.unclear, true);
    if (s.unclearCount === 2) {
      s.keypadOnly = true;
      return ask(s.purpose === 'consent' ? t.consent.keypad_only : t.reminder.keypad_only, false);
    }
    return bye(s.purpose === 'consent' ? t.consent.no_input_goodbye : t.reminder.no_input_goodbye, 'none');
  }
  if (intent === 'repeat') {
    if (++s.repeats > 3) return bye(t.reminder.no_input_goodbye, 'none');
    return ask(s.fullText, !s.keypadOnly);
  }
  if (intent === 'stop') {
    await stopNumber(d, s.to, kind === 'key' ? 'key_9' : 'stop_phrase', kind, call);
    return bye(s.purpose === 'consent' ? t.consent.stop_ack : t.reminder.stop_ack, 'stop');
  }
  if (s.purpose === 'consent' && person) return consentReply(d, call, person, intent, kind, child, bye);
  if (!person || !call.callGroupId) return bye(t.reminder.no_input_goodbye, 'none');
  return reminderReply(d, call, s, person, intent, kind as 'key' | 'speech', child, ask, bye);
}

async function consentReply(d: Deps, call: CallRow, person: PersonRow, intent: ReplyIntent, via: 'key' | 'speech', child: string,
  bye: (text: string, r: CallResultRow) => Promise<NextAction>): Promise<NextAction> {
  const t = d.scripts.get(person.language).templates;
  if (intent === 'confirm') {
    const changed = await d.store.transaction(async (tx) => {
      await tx.lockPhone(person.phone);
      const p = await tx.getPerson(person.id);
      if (!p || p.consent === 'consented') return false;
      if (p.consent === 'opted_out' || await tx.isBlocked(p.phone)) return false; // a blocked number never becomes consented
      await tx.setPersonConsent(p.id, 'consented', d.clock.now());
      await tx.insertConsentEvent({ personId: p.id, result: 'consented', via, callId: call.id });
      return true;
    });
    if (changed) {
      await alertFor(d, person, 'consent_given', null, [], `consent_given_${person.id}`);
      await d.queue.add('schedule.replan', { personId: person.id }, { jobId: `replan_consent_${call.id}` });
    }
    return bye(t.consent.yes_ack, 'consented');
  }
  // decline ('nahi'), or any other intent that makes no sense in a consent call: not consent.
  await d.store.transaction(async (tx) => {
    const p = await tx.getPerson(person.id);
    if (p?.consent === 'pending') {
      await tx.setPersonConsent(p.id, 'declined', d.clock.now());
      await tx.insertConsentEvent({ personId: p.id, result: 'declined', via, callId: call.id });
    }
  });
  await alertFor(d, person, 'consent_declined', null, [], `consent_declined_${person.id}_${call.id}`);
  return bye(line(t.consent.no_ack, { child_name: child }), 'declined');
}

async function reminderReply(d: Deps, call: CallRow, s: CallSession, person: PersonRow, intent: ReplyIntent, via: 'key' | 'speech', child: string,
  ask: (text: string, speech: boolean) => Promise<NextAction>, bye: (text: string, r: CallResultRow) => Promise<NextAction>): Promise<NextAction> {
  const t = d.scripts.get(person.language).templates.reminder;
  const gid = call.callGroupId!;
  const doseIds = async () => (await d.store.getGroupDetails(gid)).map((x) => x.dose.id);
  switch (intent) {
    case 'confirm':
      await d.store.confirmGroup(gid, via, d.clock.now());
      return bye(t.confirm_ack, 'confirmed');
    case 'doctor_changed':
    case 'unwell': {
      const ids = await doseIds();
      if ((await d.store.closeGroup(gid, 'missed')) > 0) await alertFor(d, person, intent, gid, ids, `${intent}_${gid}`);
      return bye(line(intent === 'unwell' ? t.unwell_ack : t.doctor_changed_ack, { child_name: child }), intent);
    }
    case 'snooze':
    case 'decline': {
      const used = (await d.store.listCallsForGroup(gid)).some((c) => c.result === 'snoozed');
      // First "nahi li" while the snooze is still available: tell them to take it, press 1, or 2 for a reminder. Never a confirmation.
      if (!used && intent === 'decline' && !s.notTakenAsked && t.not_taken_ack) {
        s.notTakenAsked = true;
        return ask(t.not_taken_ack, !s.keypadOnly);
      }
      if (!used) {
        const at = RULES.snoozeMinutes;
        await d.queue.add('reminder.snooze', { callGroupId: gid }, { delayMs: at * MINUTE, jobId: `snooze_${gid}` });
        return bye(line(t.snooze_ack, { minutes: at }), 'snoozed');
      }
      if (intent === 'snooze') return ask(t.snooze_used, true); // second snooze request: take it now, press 1
      const ids = await doseIds();
      if ((await d.store.closeGroup(gid, 'missed')) > 0) await alertFor(d, person, 'dose_missed', gid, ids, `missed_${gid}`, 'said_not_taken');
      return bye(line(t.declined_ack, { child_name: child }), 'declined');
    }
    default:
      return bye(t.no_input_goodbye, 'none');
  }
}

/** Key 9 or a stop phrase: block the number across all accounts, immediately (rule 3). */
export async function stopNumber(d: Deps, phone: string, reason: 'key_9' | 'stop_phrase', via: 'key' | 'speech', call: CallRow): Promise<void> {
  const people = await d.store.transaction(async (tx) => {
    await tx.lockPhone(phone);
    await tx.blockNumber(phone, reason);
    const all = await tx.listPeopleByPhone(phone);
    for (const p of all) {
      if (p.consent !== 'opted_out') {
        await tx.setPersonConsent(p.id, 'opted_out', d.clock.now());
        await tx.insertConsentEvent({ personId: p.id, result: 'opted_out', via, callId: call.id });
      }
      const open = await tx.listUpcomingDoses(p.id, new Date(0));
      await tx.setDoseStatus(open.map((x) => x.id), ['upcoming'], 'skipped_paused');
    }
    if (call.callGroupId) await tx.closeGroup(call.callGroupId, 'skipped_paused');
    return all;
  });
  for (const p of people) await alertFor(d, p, 'opted_out', null, [], `opted_out_${p.id}`);
}
