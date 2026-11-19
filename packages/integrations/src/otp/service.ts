import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { isE164, maskPhone } from '../util/mask';
import { isProduction, optionalEnv, type Env } from '../util/env';
import { consoleLogger, type Logger } from '../util/logger';
import type { OtpStore } from './store';
import type { AppLocale, OtpSender } from './types';

export interface OtpPolicy {
  codeLength: number;
  ttlMinutes: number;
  maxVerifyAttempts: number;
  resendCooldownSeconds: number;
  maxSendsPerHour: number;
}

export const DEFAULT_OTP_POLICY: OtpPolicy = {
  codeLength: 6,
  ttlMinutes: 5,
  maxVerifyAttempts: 5,
  resendCooldownSeconds: 30,
  maxSendsPerHour: 5,
};

export type OtpRequestResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: 'invalid_phone' | 'rate_limited'; retryAfterSeconds?: number };

export type OtpVerifyResult = { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

const HOUR_MS = 60 * 60 * 1000;

/**
 * Issues and checks one-time codes. Codes are stored hashed, single use, expire,
 * and lock after too many wrong attempts.
 *
 * Dev mode: if OTP_DEV_FIXED_CODE is set (and we are not in production) every issued
 * code is that value, so testers and e2e tests can sign in without reading logs.
 */
export class OtpService {
  private readonly fixedCode?: string;

  constructor(
    private readonly sender: OtpSender,
    private readonly store: OtpStore,
    env: Env,
    private readonly policy: OtpPolicy = DEFAULT_OTP_POLICY,
    private readonly now: () => number = Date.now,
    private readonly logger: Logger = consoleLogger,
  ) {
    const fixed = optionalEnv(env, 'OTP_DEV_FIXED_CODE');
    if (fixed !== undefined) {
      if (isProduction(env)) throw new Error('OTP_DEV_FIXED_CODE must not be set in production');
      if (!new RegExp(`^\\d{${policy.codeLength}}$`).test(fixed)) {
        throw new Error(`OTP_DEV_FIXED_CODE must be ${policy.codeLength} digits`);
      }
      this.fixedCode = fixed;
    }
  }

  async request(phone: string, locale: AppLocale = 'en'): Promise<OtpRequestResult> {
    if (!isE164(phone)) return { ok: false, reason: 'invalid_phone' };
    const at = this.now();

    const existing = await this.store.get(phone);
    const issuedAt = existing ? existing.expiresAt - this.policy.ttlMinutes * 60_000 : undefined;
    if (issuedAt !== undefined && at - issuedAt < this.policy.resendCooldownSeconds * 1000) {
      return {
        ok: false,
        reason: 'rate_limited',
        retryAfterSeconds: Math.ceil((this.policy.resendCooldownSeconds * 1000 - (at - issuedAt)) / 1000),
      };
    }
    const sends = await this.store.recordSend(phone, at, HOUR_MS);
    if (sends.length > this.policy.maxSendsPerHour) {
      const oldest = Math.min(...sends);
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: Math.ceil((oldest + HOUR_MS - at) / 1000) };
    }

    const code = this.fixedCode ?? this.generate();
    const expiresAt = at + this.policy.ttlMinutes * 60_000;
    await this.store.put(phone, { codeHash: hash(phone, code), expiresAt, attempts: 0 });
    try {
      await this.sender.send({ to: phone, code, locale, ttlMinutes: this.policy.ttlMinutes });
    } catch (err) {
      await this.store.delete(phone);
      this.logger.error(`OTP send failed for ${maskPhone(phone)} via ${this.sender.name}`);
      throw err;
    }
    return { ok: true, expiresAt: new Date(expiresAt) };
  }

  async verify(phone: string, code: string): Promise<OtpVerifyResult> {
    const rec = await this.store.get(phone);
    if (!rec || rec.expiresAt <= this.now()) {
      if (rec) await this.store.delete(phone);
      return { ok: false, reason: 'expired' };
    }
    if (rec.attempts >= this.policy.maxVerifyAttempts) return { ok: false, reason: 'locked' };

    const given = Buffer.from(hash(phone, String(code).trim()), 'hex');
    const expected = Buffer.from(rec.codeHash, 'hex');
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      await this.store.delete(phone); // single use
      return { ok: true };
    }
    rec.attempts += 1;
    await this.store.put(phone, rec);
    return { ok: false, reason: rec.attempts >= this.policy.maxVerifyAttempts ? 'locked' : 'invalid' };
  }

  private generate(): string {
    return String(randomInt(0, 10 ** this.policy.codeLength)).padStart(this.policy.codeLength, '0');
  }
}

function hash(phone: string, code: string): string {
  return createHash('sha256').update(`${phone}:${code}`).digest('hex');
}
