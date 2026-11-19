/**
 * Safety rule 8: never show or log a phone number in full.
 * Everything except the last 4 digits is replaced with "x"; a leading "+" is kept.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return 'xxxx';
  const last4 = digits.slice(-4);
  return `${phone.trim().startsWith('+') ? '+' : ''}${'x'.repeat(digits.length - 4)}${last4}`;
}

/** Digits only, for search input like "98765" or "+91 98765 43210". */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}
