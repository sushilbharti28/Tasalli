import { RedactingLogger } from '../../src/common/logger';
import { maskPhoneForDisplay, maskPhoneForLog, normalizeE164, redactPhones } from '../../src/common/phone';

describe('phone numbers', () => {
  it('accepts Indian and international E.164 numbers', () => {
    expect(normalizeE164('+919876512861')).toBe('+919876512861');
    expect(normalizeE164('+1 415 555 2671')).toBe('+14155552671');
    expect(normalizeE164('+447911123456')).toBe('+447911123456');
  });

  it('rejects numbers without a country code or invalid ones', () => {
    expect(normalizeE164('9876512861')).toBeNull();
    expect(normalizeE164('+91123')).toBeNull();
    expect(normalizeE164('hello')).toBeNull();
  });

  it('display mask shows only the country code and last 4 digits', () => {
    expect(maskPhoneForDisplay('+919876512861')).toBe('+91 ••••• •2861');
    expect(maskPhoneForDisplay('+14155552671')).toBe('+1 ••••• •2671');
  });

  it('log mask keeps only the last 4 digits (safety rule 8)', () => {
    expect(maskPhoneForLog('+919876512861')).toBe('+********2861');
    expect(maskPhoneForLog('+919876512861')).not.toContain('98765');
  });

  it('redacts phone-like numbers inside free text', () => {
    const out = redactPhones('calling +91 98765 12861 and 9876512861 now, code 123456');
    expect(out).not.toMatch(/98765/);
    expect(out).toContain('2861');
    expect(out).toContain('123456'); // 6-digit codes and ids are left alone
  });

  it('the app logger never prints a full number', () => {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      writes.push(String(s));
      return true;
    });
    try {
      const logger = new RedactingLogger();
      logger.log('placing call to +919876512861', 'Test');
      logger.log({ phone: '+919876512861' }, 'Test');
    } finally {
      spy.mockRestore();
    }
    const all = writes.join('');
    expect(all).not.toContain('9876512861');
    expect(all).toContain('2861');
  });
});
