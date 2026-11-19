import { RULES } from '../contracts-values.js';
import { MINUTE } from '../clock.js';
import { occurrences, stillMatches } from '../scheduler/time.js';
import type { PersonRow } from '../types.js';
import { alertFor, newGroupId, placeReminder } from './calls.js';
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
  // Too late (service was down): do not call an hour after the dose time.
  if (now.getTime() - first.dueAt.getTime() > RULES.groupWindowMinutes * MINUTE) {
    if ((await d.store.setDoseStatus([doseId], ['upcoming'], 'missed')) > 0) {
      await alertFor(d, person, 'dose_missed', null, [doseId], `late_${doseId}`, 'too_late');
    }
    return;
  }
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
      ids.push(dose.id);
    }
    return ids.length ? tx.assignGroup(ids, groupId) : [];
  });
  if (assigned.length === 0) return;
  await placeReminder(d, groupId, encodeAttempt(0, 0));
}
