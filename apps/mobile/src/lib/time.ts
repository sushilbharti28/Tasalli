/**
 * Time helpers. Safety rule 7: schedule times are stored as local "HH:mm" in the PARENT's
 * time zone. The app only converts at the edges (showing a dueAt instant to the child).
 */

const FALLBACK_OFFSETS_MIN: Record<string, number> = { 'Asia/Kolkata': 330, 'Asia/Calcutta': 330, UTC: 0 };

function partsInZone(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (IST = +330). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  try {
    const p = partsInZone(instant, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  } catch {
    return FALLBACK_OFFSETS_MIN[timeZone] ?? 330;
  }
}

/** "2026-11-19" + "09:00" in Asia/Kolkata -> the UTC instant. */
export function zonedTimeToUtc(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMinutes(new Date(guess), timeZone);
  const first = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(first), timeZone);
  return new Date(guess - off2 * 60000);
}

/** Calendar date ("YYYY-MM-DD") of `instant` in `timeZone`. */
export function dateInZone(instant: Date, timeZone: string): string {
  const off = tzOffsetMinutes(instant, timeZone);
  return new Date(instant.getTime() + off * 60000).toISOString().slice(0, 10);
}

/** "HH:mm" (24h) of `instant` in `timeZone`. */
export function hhmmInZone(instant: Date, timeZone: string): string {
  const off = tzOffsetMinutes(instant, timeZone);
  return new Date(instant.getTime() + off * 60000).toISOString().slice(11, 16);
}

/** Display a 24h "HH:mm" as "9:00 AM" style text without any time-zone conversion. */
export function displayHhmm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Show an instant as the parent's local clock time. */
export function displayInstant(iso: string, timeZone: string): string {
  return displayHhmm(hhmmInZone(new Date(iso), timeZone));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday 1 (Mon) .. 7 (Sun) of a calendar date. */
export function isoWeekday(date: string): number {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** Time zones offered when adding a person (parents abroad are common for NRI families). */
export const TIME_ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const;
