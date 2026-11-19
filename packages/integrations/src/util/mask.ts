/**
 * Safety rule 8: never log phone numbers in full. Keeps the leading "+" and
 * the last 4 digits, masks everything else: "+919876512861" -> "+•••••••••2861".
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  const prefix = phone.trim().startsWith('+') ? '+' : '';
  return prefix + '•'.repeat(digits.length - 4) + digits.slice(-4);
}

/** Masks every E.164-looking number inside free text (for error messages and logs). */
export function maskPhonesInText(text: string): string {
  return text.replace(/\+?\d[\d\s-]{7,}\d/g, (m) => maskPhone(m));
}

const E164 = /^\+[1-9]\d{6,14}$/;
export function isE164(phone: string): boolean {
  return E164.test(phone);
}
