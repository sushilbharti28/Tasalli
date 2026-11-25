import { RULES } from '../contracts-values.js';
import { MINUTE } from '../clock.js';
import { jobId } from '../queue/jobs.js';
import { localDay, nextLocalHour, occurrences, stillMatches } from '../scheduler/time.js';
import type { PersonRow } from '../types.js';
import { alertFor, newGroupId, placeReminder } from './calls.js';
import { engineWasUp, queueOutageAlert } from './dispatch.js';
import { DateTime } from 'luxon';
import { ownerEntitled } from './billing.js';
import { encodeAttempt, type Deps } from './deps.js';

const HORIZON_MS = 48 * 60 * MINUTE;

async function schedulable(d: Deps, person: PersonRow): Promise<boolean> {
  return !person.deleted && !person.paused && person.consent === 'consented' && !(await d.store.isBlocked(person.phone));
}

/** Safety rule 3: nothing is planned for a person who is not consented, or whose number is blocked. */
export async function planPerson(d: Deps, personId: string): Promise<void> {
  const person = await d.store.getPerson(personId);
  const now = d.clock.now();
  if (person && !person.deleted && person.consent === 'consented' && person.paused) {
    const open = await d.store.listUpcomingDoses(personId, now);
    await d.store.setDoseStatus(open.map((x) => x.id), ['upcoming'], 'skipped_paused');
    return;
  }
  if (!person || !(await schedulable(d, person))) return;
  const to = new Date(now.getTime() + HORIZON_MS);
  const rows: Array<{ scheduleId: string; personId: string; dueAt: Date }> = [];
  for (const { schedule } of await d.store.listActiveSchedules(personId)) {
    for (const dueAt of occurrences(schedule, person.timeZone, now, to)) rows.push({ scheduleId: schedule.id, personId, dueAt });
  }
  await d.store.insertDoses(rows);
  for (const dose of await d.store.listDoses(personId, now, to)) {
    if (dose.status !== 'upcoming' || dose.callGroupId) continue;
    await d.queue.add('dose.due', { doseId: dose.id }, { delayMs: Math.max(0, dose.dueAt.getTime() - now.getTime()), jobId: `dose_${dose.id}` });
  }
  // Evening summary (v1.7): 60 minutes after the parent's last dose of the day, not before 20:00 and not after 23:30 local
  // (rule 7: wall-clock in their zone, converted here at the edge). Re-planning after an edit queues the new time; the
  // job for an older time skips itself (eveningSummary checks `at`).
  const evening = await summaryTime(d, person, now);
  await d.queue.add('summary.evening', { personId, localDate: evening.date, at: evening.at.toISOString() },
    { delayMs: evening.at.getTime() - now.getTime(), jobId: jobId('summary', personId, evening.date, String(evening.at.getTime())) });
}

export const EVENING_SUMMARY_HOUR = 20;
const SUMMARY_AFTER_LAST_DOSE_MS = 60 * MINUTE;
const SUMMARY_LATEST = { hour: 23, minute: 30 };

/** When the evening summary for the parent's current (or next) local day goes out. */
export async function summaryTime(d: Deps, person: PersonRow, now: Date): Promise<{ at: Date; date: string }> {
  for (const dayOffset of [0, 1]) {
    const base = nextLocalHour(new Date(now.getTime() - 24 * 60 * MINUTE + dayOffset * 24 * 60 * MINUTE), person.timeZone, EVENING_SUMMARY_HOUR);
    const day = localDay(base.at, person.timeZone);
    const doses = await d.store.listDoses(person.id, day.start, new Date(day.end.getTime() - 1));
    const lastDue = doses.length ? Math.max(...doses.map((x) => x.dueAt.getTime())) : 0;
    const latest = DateTime.fromJSDate(day.start, { zone: person.timeZone }).set(SUMMARY_LATEST).toMillis();
    const at = new Date(Math.min(latest, Math.max(base.at.getTime(), lastDue + SUMMARY_AFTER_LAST_DOSE_MS)));
    if (at.getTime() > now.getTime()) return { at, date: day.date };
  }
  const next = nextLocalHour(now, person.timeZone, EVENING_SUMMARY_HOUR);
  return { at: next.at, date: next.date };
}

/** 20:00 local: one evening_summary alert per person per local date (deduped by job id). */
export async function eveningSummary(d: Deps, personId: string, localDate: string, at?: string): Promise<void> {
  const person = await d.store.getPerson(personId);
  if (!person || !(await schedulable(d, person)) || !(await ownerEntitled(d, person.ownerUserId))) return;
  // A late or retried job must not summarise a different day than it was planned for.
  if (localDay(d.clock.now(), person.timeZone).date !== localDate) return;
  // v1.7: a job planned for an older time (doses changed since) skips itself; the job for the current time sends.
  if (at) {
    const current = await summaryTime(d, person, new Date(new Date(at).getTime() - 1));
    if (current.at.toISOString() !== at) return;
  }
  await d.queue.alert({ kind: 'evening_summary', personId, ownerUserId: person.ownerUserId, callGroupId: null, doseIds: [],
    at: d.clock.now().toISOString(), localDate }, jobId('evening_summary', personId, localDate));
}

export async function planAll(d: Deps): Promise<void> {
  const bucket = Math.floor(d.clock.now().getTime() / (30 * MINUTE));
  for (const p of await d.store.listSchedulablePeople()) await d.queue.add('schedule.replan', { personId: p.id }, { jobId: `replan_${p.id}_${bucket}` });
}

/** A dose is due: group it with others due within 30 minutes (one call), then call. */
export async function doseDue(d: Deps, doseId: string): Promise<void> {
  const first = await d.store.getDose(doseId);
  if (!first || first.status !== 'upcoming' || first.callGroupId) return; // already grouped, confirmed or closed
  const person = await d.store.getPerson(first.personId);
  const now = d.clock.now();
  if (!person) return;
  if (!(await schedulable(d, person))) {
    if (person.paused && person.consent === 'consented') await d.store.setDoseStatus([doseId], ['upcoming'], 'skipped_paused');
    return;
  }
  // Too late (v1.7): if the engine was DOWN at the dose time, do not call now; mark it missed and report it in one
  // alert per person. If the engine was up but busy (a dialling backlog), still call, up to backlogMaxMinutes late.
  const lateMs = now.getTime() - first.dueAt.getTime();
  if (lateMs > RULES.groupWindowMinutes * MINUTE) {
    const busyNotDown = lateMs <= d.config.backlogMaxMinutes * MINUTE && await engineWasUp(d, first.dueAt);
    if (!busyNotDown) {
      if ((await d.store.setDoseStatus([doseId], ['upcoming'], 'missed')) > 0) await queueOutageAlert(d, person.id, first.dueAt, person.timeZone);
      return;
    }
    d.log.warn('dose dialled late (backlog)', { doseId, lateMinutes: Math.round(lateMs / MINUTE) });
  }
  // One call at a time per person: a dose with a different food timing waits for the live call to end.
  const live = (await d.store.listCallsForPerson(person.id, 'reminder', new Date(now.getTime() - 15 * MINUTE))).some((c) => !c.endedAt);
  if (live) {
    await d.queue.add('dose.due', { doseId }, { delayMs: 2 * MINUTE, jobId: `dose_${doseId}_w${Math.floor(now.getTime() / (2 * MINUTE))}` });
    return;
  }
  const firstSchedule = await d.store.getSchedule(first.scheduleId);
  const groupId = newGroupId();
  const assigned = await d.store.transaction(async (tx) => {
    await tx.lockPerson(person.id);
    const window = await tx.listDoses(person.id, first.dueAt, new Date(first.dueAt.getTime() + RULES.groupWindowMinutes * MINUTE));
    const ids: string[] = [];
    for (const dose of window) {
      if (dose.status !== 'upcoming' || dose.callGroupId) continue;
      const sched = await tx.getSchedule(dose.scheduleId);
      const med = sched ? await tx.getMedicine(sched.medicineId) : null;
      // Edited or removed since planning: the old dose must not be spoken.
      if (!sched || !med?.active || !stillMatches(sched, person.timeZone, dose.dueAt)) continue;
      if (sched.food !== firstSchedule?.food) continue; // same time window AND same food timing in one call
      ids.push(dose.id);
    }
    return ids.length ? tx.assignGroup(ids, groupId) : [];
  });
  if (assigned.length === 0) return;
  await placeReminder(d, groupId, encodeAttempt(0, 0));
}

/**
 * API asked for one more reminder for a dose. One call only (attempt code = last retry, so an unanswered call is not retried).
 * placeReminder re-checks consent, paused, block list and billing; place() re-checks the block list and the 6/day cap.
 */
export async function doseRemind(d: Deps, doseId: string): Promise<void> {
  const dose = await d.store.getDose(doseId);
  if (!dose || (dose.status !== 'upcoming' && dose.status !== 'missed')) return; // confirmed, mid-call, or skipped
  const person = await d.store.getPerson(dose.personId);
  if (!person || !(await schedulable(d, person))) return;
  // A dose that is still far in the future is not "one more reminder"; the normal schedule will call at its time.
  if (dose.status === 'upcoming' && dose.dueAt.getTime() - d.clock.now().getTime() > RULES.groupWindowMinutes * MINUTE) return;
  const groupId = newGroupId();
  if (!(await d.store.regroupDose(doseId, groupId))) return; // duplicate request: someone else already took it
  await placeReminder(d, groupId, encodeAttempt(0, RULES.retryCount));
}
