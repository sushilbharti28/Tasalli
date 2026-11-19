import { describe, expect, it } from 'vitest';
import { maskPhone, maskPhonesInText, isE164, hmacSha256Hex, verifyHmacSha256Hex, header } from '../src';

describe('maskPhone', () => {
  it('keeps only the last 4 digits', () => {
    expect(maskPhone('+919876512861')).toBe('+••••••••2861');
    expect(maskPhone('+14155550123')).toBe('+•••••••0123');
    expect(maskPhone('123')).toBe('••••');
  });
  it('masks numbers inside text', () => {
    expect(maskPhonesInText('call to +919876512861 failed')).toBe('call to +••••••••2861 failed');
  });
  it('validates E.164', () => {
    expect(isE164('+919876512861')).toBe(true);
    expect(isE164('09876512861')).toBe(false);
  });
});

describe('HMAC signatures', () => {
  it('verifies in constant time and rejects tampering or missing signatures', () => {
    const body = '{"a":1}';
    const sig = hmacSha256Hex('s3cret', body);
    expect(verifyHmacSha256Hex('s3cret', body, sig)).toBe(true);
    expect(verifyHmacSha256Hex('s3cret', body + ' ', sig)).toBe(false);
    expect(verifyHmacSha256Hex('other', body, sig)).toBe(false);
    expect(verifyHmacSha256Hex('s3cret', body, undefined)).toBe(false);
    expect(verifyHmacSha256Hex('s3cret', body, 'zz')).toBe(false);
    expect(verifyHmacSha256Hex('', body, sig)).toBe(false);
  });
  it('reads headers case-insensitively', () => {
    expect(header({ 'X-Sig': 'a' }, 'x-sig')).toBe('a');
    expect(header({ 'x-sig': ['b', 'c'] }, 'X-SIG')).toBe('b');
  });
});
