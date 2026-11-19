/** Phone helpers. Safety rule 8: never log or show a full number we didn't need to. */

export const COUNTRY_CODES = [
  { code: '+91', label: 'India' },
  { code: '+1', label: 'USA / Canada' },
  { code: '+44', label: 'UK' },
  { code: '+971', label: 'UAE' },
  { code: '+65', label: 'Singapore' },
  { code: '+61', label: 'Australia' },
] as const;

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
  const m = /^\+(\d{1,3})(\d+)$/.exec(e164);
  if (!m) return '••••';
  const [, cc, rest] = m;
  const last4 = rest.slice(-4);
  const hidden = '•'.repeat(Math.max(rest.length - 4, 0));
  const grouped = (hidden + last4).replace(/^(.{5})(.*)$/, '$1 $2');
  return `+${cc} ${grouped}`;
}
