import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Returns the E.164 form of a valid phone number, or null. Indian and international numbers. */
export function normalizeE164(input: string): string | null {
  if (typeof input !== 'string' || !input.trim().startsWith('+')) return null;
  const parsed = parsePhoneNumberFromString(input.trim());
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/**
 * Display mask used in API responses (Person.phoneMasked), e.g. "+91 ••••• •2861".
 * Only the country code and the last 4 digits are shown.
 */
export function maskPhoneForDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  const cc = parsed ? `+${parsed.countryCallingCode}` : '+';
  const national = parsed ? parsed.nationalNumber : e164.replace(/\D/g, '');
  const last4 = national.slice(-4);
  const hidden = Math.max(national.length - 4, 0);
  const dots = '•'.repeat(hidden);
  // Group as in the contract example: first 5 dots, a space, then the rest + last 4.
  const head = dots.slice(0, 5);
  const tail = dots.slice(5);
  return `${cc} ${head} ${tail}${last4}`.replace(/\s+/g, ' ').trim();
}

/** Log mask (safety rule 8): everything but the last 4 digits replaced. "+91******2861". */
export function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${phone.trim().startsWith('+') ? '+' : ''}${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/**
 * Defence in depth for logs: masks anything that looks like a phone number
 * (7+ digits, optionally with +, spaces or dashes) inside free text.
 */
export function redactPhones(text: string): string {
  return text.replace(/\+?\d[\d\s-]{5,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 7) return m;
    return maskPhoneForLog(m);
  });
}
