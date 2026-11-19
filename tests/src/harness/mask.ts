// Safety rule 8: never log phone numbers in full (mask all but the last 4 digits).

/** Mask a phone number for logs: "+919812345678" -> "+91••••••5678". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  const last4 = digits.slice(-4);
  const cc = phone.startsWith('+91') ? '+91' : phone.startsWith('+') ? '+' : '';
  return `${cc}••••••${last4}`;
}

/**
 * Find full phone numbers in text. Flags any run of 8+ digits (allowing spaces,
 * dashes and a leading +), which covers E.164 and Indian 10-digit numbers.
 * Masked forms like "+91••••••5678" do not match.
 */
export function findUnmaskedPhones(text: string): string[] {
  const hits = text.match(/\+?\d(?:[\s-]?\d){7,}/g) ?? [];
  return hits.filter((h) => !/^\d{4}-\d{2}-\d{2}/.test(h)); // ignore ISO dates that slip through
}

/** Return the subset of `phones` that appear unmasked anywhere in `text`. */
export function leakedPhones(text: string, phones: string[]): string[] {
  const compact = text.replace(/[\s-]/g, '');
  return phones.filter((p) => {
    const digits = p.replace(/\D/g, '');
    const national = digits.length > 10 ? digits.slice(-10) : digits;
    return compact.includes(digits) || compact.includes(national);
  });
}
