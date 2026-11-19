import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config';

export const REDIS = Symbol('REDIS');

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_REQUESTS = 3;
export const OTP_REQUEST_WINDOW_SECONDS = 600;

/** OTPs live in Redis only (hashed, 5 minute expiry). No table needed. */
@Injectable()
export class OtpStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private hash(phone: string, code: string) {
    return createHmac('sha256', this.config.sessionSecret).update(`${phone}:${code}`).digest('hex');
  }
  private key(phone: string) {
    return `tasalli:otp:${phone}`;
  }

  /** Counts a request; false when the phone asked too often in the window. */
  async allowRequest(phone: string): Promise<boolean> {
    const k = `tasalli:otp-req:${phone}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, OTP_REQUEST_WINDOW_SECONDS);
    return n <= OTP_MAX_REQUESTS;
  }

  async save(phone: string, code: string): Promise<void> {
    await this.redis
      .multi()
      .hset(this.key(phone), { hash: this.hash(phone, code), attempts: '0' })
      .expire(this.key(phone), OTP_TTL_SECONDS)
      .exec();
  }

  /** True once per code. Wrong guesses count; after the limit the code is burnt. */
  async verify(phone: string, code: string): Promise<boolean> {
    const k = this.key(phone);
    const stored = await this.redis.hgetall(k);
    if (!stored.hash) return false;
    const attempts = await this.redis.hincrby(k, 'attempts', 1);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(k);
      return false;
    }
    const a = Buffer.from(stored.hash, 'hex');
    const b = Buffer.from(this.hash(phone, code), 'hex');
    if (a.length === b.length && timingSafeEqual(a, b)) {
      // Delete returns 1 for exactly one caller, so a code cannot be used twice concurrently.
      return (await this.redis.del(k)) === 1;
    }
    return false;
  }
}
