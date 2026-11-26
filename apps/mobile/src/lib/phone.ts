/** Phone helpers. Safety rule 8: never log or show a full number we didn't need to. */

export const COUNTRY_CODES = [
  { code: '+91', label: 'India' },
  { code: '+1', label: 'USA / Canada' },
  { code: '+44', label: 'UK' },
  { code: '+971', label: 'UAE' },
  { code: '+65', label: 'Singapore' },
  { code: '+61', label: 'Australia' },
] as const;

/**
 * Reminder calls go to Indian numbers only for now (founder, 27 Nov 2026), so a loved one's number is always +91.
 * Signing in still accepts every code in COUNTRY_CODES (children abroad).
 */
export const CALL_COUNTRY_CODE = '+91';

/** A loved one's number: +91 plus the 10 digits typed. Null when it is not a valid Indian mobile number. */
export function toCallableE164(local: string): string | null {
  return toE164(CALL_COUNTRY_CODE, local);
}

/** Build an E.164 number from a country code and the digits the user typed. */
export function toE164(countryCode: string, local: string): string | null {
  const digits = local.replace(/\D/g, '').replace(/^0+/, '');
  const cc = countryCode.replace(/\D/g, '');
  if (cc === '91') {
    if (!/^[6-9]\d{9}$/.test(digits)) return null;
  } else if (digits.length < 6 || digits.length > 12) {
    return null;
  }
  const full = `+${cc}${digits}`;
  return full.length <= 16 ? full : null;
}

/** "+919876512861" -> "+91 ••••• •2861" (all but the last 4 digits hidden). */
export function maskPhone(e164: string): string {
  if (!/^\+\d{6,15}$/.test(e164)) return '••••';
  // Known codes first (longest first: +971 before +91), so "+919876…" splits as +91, not +919.
  const known = COUNTRY_CODES.map((c) => c.code.slice(1))
    .sort((a, b) => b.length - a.length)
    .find((c) => e164.startsWith(`+${c}`));
  const cc = known ?? e164.slice(1, 3);
  const rest = e164.slice(1 + cc.length);
  const last4 = rest.slice(-4);
  const hidden = '•'.repeat(Math.max(rest.length - 4, 0));
  const grouped = (hidden + last4).replace(/^(.{5})(.*)$/, '$1 $2');
  return `+${cc} ${grouped}`;
}
