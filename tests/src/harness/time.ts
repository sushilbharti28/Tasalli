// Time zone helpers built on Intl only (no dependencies). Safety rule 7:
// dose times are wall-clock times in the parent's IANA time zone.

function partsIn(tz: string, ms: number) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds. */
export function tzOffsetMs(tz: string, ms: number): number {
  const p = partsIn(tz, ms);
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Convert a local wall-clock date + time in `tz` to a UTC Date. */
export function localToUtc(localDate: string, localTime: string, tz: string): Date {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const [hh, mm] = localTime.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMs(tz, guess);
  let t = guess - off1;
  const off2 = tzOffsetMs(tz, t);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDateOf(at: Date, tz: string): string {
  const p = partsIn(tz, at.getTime());
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local wall-clock time (HH:MM) of an instant in `tz`. */
export function localTimeOf(at: Date, tz: string): string {
  const p = partsIn(tz, at.getTime());
  return `${p.hour}:${p.minute}`;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** ISO weekday (1 = Monday) of an instant in `tz`. */
export function isoWeekdayOf(at: Date, tz: string): number {
  return WEEKDAYS[partsIn(tz, at.getTime()).weekday!]!;
}

/** Add days to a YYYY-MM-DD date string. */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
