import { describe, expect, it } from 'vitest';
import {
  createOtpSenderFromEnv,
  DevConsoleOtpSender,
  FakeOtpSender,
  InMemoryOtpStore,
  MemoryLogger,
  OtpService,
  RoutingOtpSender,
  DEFAULT_OTP_POLICY,
} from '../src';

const PHONE = '+919876512861';
const ABROAD = '+14155550123';

function setup(env: Record<string, string> = {}) {
  let t = Date.parse('2026-11-19T10:00:00Z');
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const sender = new FakeOtpSender();
  const logger = new MemoryLogger();
  const svc = new OtpService(sender, new InMemoryOtpStore(), env, DEFAULT_OTP_POLICY, clock.now, logger);
  return { svc, sender, clock, logger };
}

describe('OtpService', () => {
  it('issues a 6-digit code and verifies it once', async () => {
    const { svc, sender } = setup();
    const r = await svc.request(PHONE, 'hi');
    expect(r.ok).toBe(true);
    const code = sender.lastCodeFor(PHONE)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(sender.sent[0]).toMatchObject({ to: PHONE, locale: 'hi', ttlMinutes: 5 });
    expect(await svc.verify(PHONE, code)).toEqual({ ok: true });
    expect(await svc.verify(PHONE, code)).toEqual({ ok: false, reason: 'expired' }); // single use
  });

  it('works for international numbers', async () => {
    const { svc, sender } = setup();
    expect((await svc.request(ABROAD)).ok).toBe(true);
    expect(await svc.verify(ABROAD, sender.lastCodeFor(ABROAD)!)).toEqual({ ok: true });
  });

  it('rejects non-E.164 numbers', async () => {
    const { svc, sender } = setup();
    expect(await svc.request('9876512861')).toEqual({ ok: false, reason: 'invalid_phone' });
    expect(sender.sent).toHaveLength(0);
  });

  it('expires after 5 minutes', async () => {
    const { svc, sender, clock } = setup();
    await svc.request(PHONE);
    clock.advance(5 * 60_000 + 1);
    expect(await svc.verify(PHONE, sender.lastCodeFor(PHONE)!)).toEqual({ ok: false, reason: 'expired' });
  });

  it('locks after 5 wrong attempts, even if the right code comes next', async () => {
    const { svc, sender } = setup();
    await svc.request(PHONE);
    const code = sender.lastCodeFor(PHONE)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect(await svc.verify(PHONE, wrong)).toEqual({ ok: false, reason: 'invalid' });
    expect(await svc.verify(PHONE, wrong)).toEqual({ ok: false, reason: 'locked' });
    expect(await svc.verify(PHONE, code)).toEqual({ ok: false, reason: 'locked' });
  });

  it('enforces a resend cooldown and an hourly cap', async () => {
    const { svc, clock } = setup();
    expect((await svc.request(PHONE)).ok).toBe(true);
    const tooSoon = await svc.request(PHONE);
    expect(tooSoon).toMatchObject({ ok: false, reason: 'rate_limited', retryAfterSeconds: 30 });
    for (let i = 0; i < 4; i++) {
      clock.advance(31_000);
      expect((await svc.request(PHONE)).ok).toBe(true);
    }
    clock.advance(31_000);
    expect(await svc.request(PHONE)).toMatchObject({ ok: false, reason: 'rate_limited' });
    clock.advance(60 * 60_000);
    expect((await svc.request(PHONE)).ok).toBe(true);
  });

  it('a new code replaces the old one', async () => {
    const { svc, sender, clock } = setup();
    await svc.request(PHONE);
    const first = sender.lastCodeFor(PHONE)!;
    clock.advance(31_000);
    await svc.request(PHONE);
    const second = sender.lastCodeFor(PHONE)!;
    if (first !== second) expect(await svc.verify(PHONE, first)).toEqual({ ok: false, reason: 'invalid' });
    expect(await svc.verify(PHONE, second)).toEqual({ ok: true });
  });

  it('cleans up and rethrows when the sender fails, without logging the full number', async () => {
    const { svc, sender, logger } = setup();
    sender.failNext();
    await expect(svc.request(PHONE)).rejects.toThrow('fake send failure');
    expect(await svc.verify(PHONE, '123456')).toEqual({ ok: false, reason: 'expired' });
    expect(logger.lines.join('\n')).not.toContain('9876512861');
    expect(logger.lines.join('\n')).toContain('2861');
  });

  it('dev mode: OTP_DEV_FIXED_CODE is the code', async () => {
    const { svc, sender } = setup({ OTP_DEV_FIXED_CODE: '424242' });
    await svc.request(PHONE);
    expect(sender.lastCodeFor(PHONE)).toBe('424242');
    expect(await svc.verify(PHONE, '424242')).toEqual({ ok: true });
  });

  it('dev mode: refuses a fixed code in production or a malformed one', () => {
    expect(() => setup({ OTP_DEV_FIXED_CODE: '424242', NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => setup({ OTP_DEV_FIXED_CODE: '42' })).toThrow(/6 digits/);
  });
});

describe('OTP senders', () => {
  it('console sender logs the code with the phone masked', async () => {
    const logger = new MemoryLogger();
    const s = new DevConsoleOtpSender({}, logger);
    await s.send({ to: PHONE, code: '123456', locale: 'en', ttlMinutes: 5 });
    const out = logger.lines.join('\n');
    expect(out).toContain('123456');
    expect(out).toContain('2861');
    expect(out).not.toContain('98765');
  });

  it('console sender cannot start in production', () => {
    expect(() => new DevConsoleOtpSender({ NODE_ENV: 'production' })).toThrow();
    expect(() => new DevConsoleOtpSender({ APP_ENV: 'production' })).toThrow();
  });

  it('routes +91 to the domestic sender and others to the international one', async () => {
    const dom = new FakeOtpSender();
    const intl = new FakeOtpSender();
    const r = new RoutingOtpSender(dom, intl);
    await r.send({ to: PHONE, code: '1', locale: 'en', ttlMinutes: 5 });
    await r.send({ to: ABROAD, code: '2', locale: 'en', ttlMinutes: 5 });
    expect(dom.sent.map((m) => m.to)).toEqual([PHONE]);
    expect(intl.sent.map((m) => m.to)).toEqual([ABROAD]);
  });

  it('factory: console by default outside production, refuses production with no real provider', () => {
    expect(createOtpSenderFromEnv({}).name).toBe('console');
    expect(createOtpSenderFromEnv({ OTP_PROVIDER: 'fake' }).name).toBe('fake');
    expect(() => createOtpSenderFromEnv({ NODE_ENV: 'production' })).toThrow(/No OTP provider/);
    expect(() => createOtpSenderFromEnv({ NODE_ENV: 'production', OTP_PROVIDER: 'console' })).toThrow();
    expect(() => createOtpSenderFromEnv({ OTP_PROVIDER: 'msg91' })).toThrow(/No OTP provider/);
  });
});
