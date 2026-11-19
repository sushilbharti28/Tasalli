export const DEFAULT_TZ = 'Asia/Kolkata';

/** Format an instant in a given IANA zone (safety rule 7: convert only at the edges). */
export function fmtDateTime(d: Date | string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function fmtPercent(rate: number | null, digits = 1): string {
  return rate === null ? '–' : `${(rate * 100).toFixed(digits)}%`;
}

export function fmtDuration(start: Date | null, end: Date | null): string {
  if (!start || !end) return '';
  const s = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
