import { DateTime } from 'luxon';

export interface ScheduleForGeneration {
  id: string;
  localTime: string; // 'HH:MM' or 'HH:MM:SS' wall-clock time in the person's zone
  daysOfWeek: number[]; // ISO 1=Mon..7=Sun
  startDate: string; // 'YYYY-MM-DD'
  endDate: string | null;
}

export interface DueTime {
  scheduleId: string;
  localDate: string;
  dueAt: Date; // UTC instant
}

/**
 * Safety rule 7: dose times are wall-clock times in the PERSON's (parent's) time zone.
 * They are converted to UTC instants here and nowhere else. The child's own time zone
 * plays no part. Only instants after `now` are returned (the past is never backfilled).
 */
export function computeDueTimes(
  schedules: ScheduleForGeneration[],
  timeZone: string,
  now: Date,
  horizonDays: number,
): DueTime[] {
  const out: DueTime[] = [];
  const todayLocal = DateTime.fromJSDate(now, { zone: timeZone }).startOf('day');
  for (let i = 0; i < horizonDays; i++) {
    const day = todayLocal.plus({ days: i });
    const iso = day.toISODate()!;
    for (const s of schedules) {
      if (iso < s.startDate) continue;
      if (s.endDate && iso > s.endDate) continue;
      if (!s.daysOfWeek.includes(day.weekday)) continue;
      const [h, m] = s.localTime.split(':').map(Number);
      // Luxon moves a time that falls in a DST gap forward, and picks the earlier
      // instant for an ambiguous time; India has no DST.
      const due = DateTime.fromObject({ year: day.year, month: day.month, day: day.day, hour: h, minute: m }, { zone: timeZone });
      if (due.toMillis() <= now.getTime()) continue;
      out.push({ scheduleId: s.id, localDate: iso, dueAt: due.toUTC().toJSDate() });
    }
  }
  return out;
}

/** UTC bounds of the local dates [from, to] (inclusive) in a zone. */
export function localDateRangeToUtc(from: string, to: string, timeZone: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(from, { zone: timeZone }).startOf('day');
  const end = DateTime.fromISO(to, { zone: timeZone }).plus({ days: 1 }).startOf('day');
  return { start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate() };
}

/** Today's date in a zone, 'YYYY-MM-DD'. */
export function localToday(now: Date, timeZone: string): string {
  return DateTime.fromJSDate(now, { zone: timeZone }).toISODate()!;
}
