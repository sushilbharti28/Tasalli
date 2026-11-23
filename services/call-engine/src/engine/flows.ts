import type { CallEvent, NextAction, ReplyIntent } from '@tasalli/contracts';
import { CONSENT_KEYS, REMINDER_KEYS, RULES } from '../contracts-values.js';
import { MINUTE } from '../clock.js';
import { fetchAudio } from '../providers/fake-speech.js';
import { joinSentences } from '../scripts/render.js';
import { line, childName } from '../scripts/builder.js';
import { speakNumbers, scriptOf } from '../scripts/spoken-numbers.js';
import { MAX_REPEATS_PER_MEDICINE, softLimitSeconds } from '../flows/limits.js';
import { matchIntent, hasNegation, isExactConfirm } from '../speech/intent.js';
import type { CallSession } from '../flows/session.js';
import type { CallResultRow, CallRow, PersonRow } from '../types.js';
import { alertFor, listenStep } from './calls.js';
import type { Deps } from './deps.js';

type InputEvent = Extract<CallEvent, { type: 'input' }>;

/** Extra yes-phrases for "can you hear me?" (a negation word anywhere already rules a reply out): ji, aa rahi hai, sun raha/rahi hoon. */
const PRESENCE_YES = /(^|\s)(ji|जी|haan|han|हाँ|हां|aa rahi hai|आ रही है|आ रहा है|aa raha hai|sun raha hoon|sun rahi hoon|sun raha hun|sun rahi hun|सुन रहा हूँ|सुन रही हूँ|सुन रहा हूं|सुन रही हूं)(\s|$)/u;

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
  // Twilio reports confidence 0.0 for some clear answers ("हां!"). On a medicine, 0.0 counts as "no score given" only when the
  // whole reply is exactly a confirm phrase; anything partial or unknown stays unclear, and real low scores (e.g. 0.3) never confirm.
  // Consent answers stay strict (founder decision, 24 Nov 2026).
  if (ctx === 'reminder' && confidence === 0 && isExactConfirm(transcript, d.scripts.get(s.language).phrases, ctx)) confidence = 1;
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
  const say = async (text: string) => d.audio.urlFor(speakNumbers(text, scriptOf(t.reminder.step_ack_next)), s.language); // no digit is ever spoken as a digit
  const bye = async (text: string, result: CallResultRow): Promise<NextAction> => {
    await d.store.updateCall(call.id, { result });
    return { action: 'hangup', finalAudioUrl: await say(text) };
  };
  const stored = call.personId ? await d.store.getPerson(call.personId) : null;
  const person = stored && { ...stored, language: s.language }; // scripts follow the language the call was placed in
  const user = person ? await d.store.getUser(person.ownerUserId) : null;
  const child = childName(t, user?.name ?? null);
  s.steps++;
  if (s.answeredAtMs === undefined) s.answeredAtMs = d.clock.now().getTime(); // 'answered' status never arrived: count from the first input

  // Test call: any key (or any speech) ends it; there is nothing to decide.
  if (s.purpose === 'test') {
    return bye(ev.kind === 'key' || ev.transcript || ev.audioUrl ? t.test.ack : t.reminder.no_input_goodbye, ev.kind === 'key' || ev.transcript || ev.audioUrl ? 'confirmed' : 'none');
  }

  const { intent, kind, raw } = await interpret(d, s, ev);
  await d.store.updateCall(call.id, { inputKind: kind, inputValue: kind === 'key' ? raw : raw.slice(0, 80) });
  // The first medicine waits 8 s for a reply, the others 6 s.
  const ask = async (text: string, speech: boolean): Promise<NextAction> => ({ action: 'play', step: listenStep(d, await say(text), s.purpose, speech, s.purpose === 'reminder' && (s.reminder?.index ?? 1) === 0) });

  // Presence check first ("can you hear me?"): never a dose or consent confirmation; 9 / a stop phrase still opts out.
  if (s.presence?.state === 'pending') {
    const p = s.presence;
    // Speech confidence is not used here: this step is never a dose or consent confirmation, and Twilio reports 0.0 for some
    // clear answers (a real "हां!" on 24 Nov 2026 came with confidence 0.0). The words still have to be a yes, with no negation.
    const presencePhrases = d.scripts.get(s.language).phrases;
    const yesWords = kind === 'speech' && raw.trim() !== '' && matchIntent(raw, presencePhrases, s.purpose === 'reminder' ? 'reminder' : 'consent', 1).intent === 'confirm';
    const heardYou = kind === 'key' ? intent !== 'stop' // any key but 9
      : raw.trim() !== '' && !hasNegation(raw, presencePhrases) && (yesWords || PRESENCE_YES.test(raw.normalize('NFC').toLowerCase()));
    (p.heard ??= []).push(kind === 'key' ? `key ${raw}` : raw.slice(0, 80));
    if (intent === 'stop') {
      await stopNumber(d, s.to, kind === 'key' ? 'key_9' : 'stop_phrase', kind, call);
      return bye(s.purpose === 'consent' ? t.consent.stop_ack : t.reminder.stop_ack, 'stop');
    }
    if (heardYou) {
      p.state = 'ok';
      s.unclearCount = 0;
      s.keypadOnly = false;
      return ask(p.next, true);
    }
    if (++p.asks === 1) return ask(p.text, true); // once more
    return bye(s.purpose === 'consent' ? t.consent.no_input_goodbye : t.reminder.no_input_goodbye, 'none'); // no medicine marked: the normal 10-minute retry follows
  }

  // Reminder calls go through the medicines one at a time: every intent is about the medicine being asked now.
  if (s.purpose === 'reminder' && s.reminder && person && call.callGroupId) {
    return reminderStep(d, call, s, person, intent, kind, raw, child, ask, bye);
  }

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
  return bye(t.reminder.no_input_goodbye, 'none'); // reminder call with no per-medicine state (placed before this version)
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

/**
 * One input for the medicine being asked now (s.reminder.index). Per-dose outcomes live in the session, so every
 * webhook decides about exactly one medicine; a replayed webhook gets its stored reply (Engine.handleWebhook) and never advances twice.
 * Intents arrive with "no" already ahead of "yes" (matchIntent, rule 4); unclear speech and silence never confirm.
 */
async function reminderStep(d: Deps, call: CallRow, s: CallSession, person: PersonRow, intent: ReplyIntent, via: 'key' | 'speech', raw: string, child: string,
  ask: (text: string, speech: boolean) => Promise<NextAction>, bye: (text: string, r: CallResultRow) => Promise<NextAction>): Promise<NextAction> {
  const t = d.scripts.get(person.language).templates.reminder;
  const r = s.reminder!;
  const gid = call.callGroupId!;
  const cur = r.items[r.index];
  if (!cur) return bye(t.no_input_goodbye, 'none'); // already past the last medicine
  (r.heard[cur.doseId] ??= []).push(via === 'key' ? `key ${raw}` : raw.slice(0, 80));
  const n = r.items.length;
  const openDoseIds = async () => (await d.store.getGroupDetails(gid)).filter((x) => x.dose.status === 'calling' || x.dose.status === 'upcoming').map((x) => x.dose.id);

  // Soft call-time limit: counted from answer, checked before any step that would start (next medicine, repeat, re-ask).
  const elapsedSeconds = (d.clock.now().getTime() - (s.answeredAtMs ?? d.clock.now().getTime())) / 1000;
  const overLimit = () => elapsedSeconds >= softLimitSeconds(n);

  const finish = async (ack: string, timeUp = false): Promise<NextAction> => {
    const ids = r.items.map((i) => i.doseId);
    const declined = ids.filter((id) => r.outcomes[id] === 'declined');
    const silent = ids.filter((id) => r.outcomes[id] === 'none');
    let result: CallResultRow = 'confirmed';
    if (declined.length > 0) {
      const used = (await d.store.listCallsForGroup(gid)).some((c) => c.result === 'snoozed');
      if (!used) {
        // Snooze once: the call that comes back covers whatever is still unconfirmed in the group (confirmed doses are not called again).
        await d.queue.add('reminder.snooze', { callGroupId: gid }, { delayMs: RULES.snoozeMinutes * MINUTE, jobId: `snooze_${gid}` });
        result = 'snoozed';
      } else {
        if ((await d.store.closeDoses(declined, 'missed')) > 0) await alertFor(d, person, 'dose_missed', gid, declined, `missed_${gid}`, 'said_not_taken');
        result = silent.length > 0 ? 'none' : 'declined';
      }
    } else if (silent.length > 0) {
      result = 'none'; // the normal 10-minute retry covers the doses nobody answered for
    }
    // "We will call again" only when a call really follows: the 15 minute reminder, or a 10-minute retry that is still left.
    const callsBack = result === 'snoozed' || (result === 'none' && r.retryLeft !== false);
    const someLeft = n === 1 ? t.step_some_left_one : t.step_some_left;
    const end = t.step_end_no_call_back !== undefined // v1.6 wording: time_up no longer carries the promise itself
      ? joinSentences([timeUp ? (t.step_time_up ?? '') : '', result === 'confirmed' && !timeUp ? (n === 1 ? t.step_all_done_one : t.step_all_done) : callsBack ? someLeft : t.step_end_no_call_back])
      : timeUp ? (t.step_time_up ?? t.step_some_left) : result === 'confirmed' ? (n === 1 ? t.step_all_done_one : t.step_all_done) : someLeft;
    return bye(joinSentences([ack, end]), result);
  };
  const advance = async (outcome: 'confirmed' | 'declined' | 'none', ack: string, forceTimeUp = false): Promise<NextAction> => {
    r.outcomes[cur.doseId] = outcome;
    r.index++;
    s.unclearCount = 0;
    s.repeats = 0;
    s.silenceRepeated = false;
    s.keypadOnly = false;
    const upcoming = r.items[r.index];
    if (!upcoming) return finish(forceTimeUp ? '' : ack, forceTimeUp);
    if (overLimit()) { // the next step would start after the limit: end politely; the doses not yet asked about stay unconfirmed (normal retry/snooze rules)
      for (const rest of r.items.slice(r.index)) r.outcomes[rest.doseId] = 'none';
      r.index = r.items.length;
      return finish(ack, true);
    }
    s.fullText = upcoming.full;
    return ask(joinSentences([ack, upcoming.first]), true);
  };

  // No usable answer for this medicine: "not recorded", then (if another medicine follows) "moving on", and "we will call again" only when a retry is left.
  // On the last medicine, finish() says whether a call follows.
  const notRecorded = (): string => {
    if (t.step_moving_on === undefined) return t.step_repeat_limit ?? t.step_ack_silence; // languages without the v1.6 lines
    const last = r.index >= n - 1;
    return joinSentences([t.step_repeat_limit ?? '', last ? '' : t.step_moving_on, !last && r.retryLeft !== false ? (t.step_will_call_again ?? '') : '']);
  };

  switch (intent) {
    case 'stop':
      await stopNumber(d, s.to, via === 'key' ? 'key_9' : 'stop_phrase', via, call);
      return bye(t.stop_ack, 'stop');
    case 'doctor_changed':
    case 'unwell': {
      const ids = await openDoseIds();
      if ((await d.store.closeGroup(gid, 'missed')) > 0) await alertFor(d, person, intent, gid, ids, `${intent}_${gid}`);
      return bye(line(intent === 'unwell' ? t.unwell_ack : t.doctor_changed_ack, { child_name: child }), intent);
    }
    case 'confirm':
      await d.store.confirmDoses([cur.doseId], via, d.clock.now());
      return advance('confirmed', t.step_ack_next);
    case 'snooze':
    case 'decline':
      return advance('declined', t.step_ack_not_now);
    case 'repeat':
      if (overLimit()) return advance('none', '', true);
      if (s.repeats >= MAX_REPEATS_PER_MEDICINE) return advance('none', notRecorded()); // heard 3 times: leave it, move on
      s.repeats++;
      return ask(cur.full, !s.keypadOnly);
    default: { // unclear or silence: ask once more (speech or key), then leave this medicine unconfirmed
      // Silence (nothing heard, no key) first plays the same medicine again, once. It counts toward the repeat limit and never confirms.
      if (via === 'speech' && raw.trim() === '' && !s.keypadOnly && !s.silenceRepeated && s.repeats < MAX_REPEATS_PER_MEDICINE && !overLimit()) {
        s.silenceRepeated = true;
        s.repeats++;
        return ask(joinSentences([t.step_silence_repeat ?? '', cur.full]), true);
      }
      s.unclearCount++;
      if (s.unclearCount === 1) {
        if (overLimit()) return advance('none', '', true);
        // Rule 4: unclear speech never confirms. The re-ask listens for speech and keys again; only a clear yes or key 1 confirms.
        return ask(t.step_unclear, true);
      }
      return advance('none', notRecorded());
    }
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
