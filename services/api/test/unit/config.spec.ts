import { loadConfig } from '../../src/config';

describe('config', () => {
  it('requires SESSION_SECRET in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
  });

  it('only the fake OTP sender exists (no paid services)', () => {
    expect(() => loadConfig({ OTP_SENDER: 'msg91' })).toThrow(/not available/);
    expect(loadConfig({}).otpSender).toBe('fake');
  });

  it('accepts a fixed 6-digit test OTP outside production only', () => {
    expect(loadConfig({ OTP_FIXED_CODE: '123456' }).otpFixedCode).toBe('123456');
    expect(() => loadConfig({ OTP_FIXED_CODE: '12' })).toThrow();
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x', OTP_FIXED_CODE: '123456' })).toThrow();
  });
});
