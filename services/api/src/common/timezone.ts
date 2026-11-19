import { IANAZone } from 'luxon';

/** True for a real IANA zone name such as "Asia/Kolkata" or "America/New_York". */
export function isValidTimeZone(tz: unknown): tz is string {
  return typeof tz === 'string' && tz.includes('/') && IANAZone.isValidZone(tz);
}
