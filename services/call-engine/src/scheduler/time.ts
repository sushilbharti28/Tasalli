import { DateTime } from 'luxon';
import type { ScheduleRow } from '../types.js';

/**
 * Safety rule 7: dose times are wall-clock times in the parent's IANA time zone.
 * Conversion to UTC happens only here, at the edge.
 */

export function assertZone(zone: string): void {
  if (!DateTime.now().setZone(zone).isValid) throw new Error(`invalid time zone: ${zone}`);
}

/** UTC instants for every occurrence of a schedule in [from, to]. */
export function occurrences(schedule: ScheduleRow, zone: string, from: Date, to: Date): Date[] {
  assertZone(zone);
  const [h, m] = schedule.localTime.split(':').map(Number) as [number, number];
  const out: Date[] = [];
  let day = DateTime.fromJSDate(from, { zone }).startOf('day').minus({ days: 1 });
  const last = DateTime.fromJSDate(to, { zone }).startOf('day').plus({ days: 1 });
  const start = DateTime.fromISO(schedule.startDate, { zone }).startOf('day');
  const end = schedule.endDate ? DateTime.fromISO(schedule.endDate, { zone }).endOf('day') : null;
  while (day <= last) {
    if (day >= start && (!end || day <= end) && schedule.daysOfWeek.includes(day.weekday)) {
      // Wall-clock time; in a DST gap luxon moves forward, which is the right thing for a reminder.
      const at = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      const d = at.toJSDate();
      if (d >= from && d <= to) out.push(d);
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

/** Does this UTC instant still match the schedule in the person's current zone (time edited, zone changed, day removed)? */
export function stillMatches(schedule: ScheduleRow, zone: string, dueAt: Date): boolean {
  const t = dueAt.getTime();
  return occurrences(schedule, zone, new Date(t - 1000), new Date(t + 1000)).some((d) => d.getTime() === t);
}

/** Start and end (exclusive) of the parent's local day containing `at`, as UTC instants. */
export function localDay(at: Date, zone: string): { start: Date; end: Date; isSunday: boolean; hour: number; date: string } {
  const local = DateTime.fromJSDate(at, { zone });
  const start = local.startOf('day');
  return {
    start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate(), isSunday: local.weekday === 7, hour: local.hour,
    date: local.toISODate()!,
  };
}
