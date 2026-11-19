import type { Redis } from 'ioredis';

export interface OtpRecord {
  codeHash: string;
  expiresAt: number;   // epoch ms
  attempts: number;
}

export interface OtpStore {
  get(phone: string): Promise<OtpRecord | undefined>;
  put(phone: string, rec: OtpRecord): Promise<void>;
  delete(phone: string): Promise<void>;
  /** Timestamps (epoch ms) of recent sends, for rate limiting. */
  recordSend(phone: string, at: number, windowMs: number): Promise<number[]>;
}

export class InMemoryOtpStore implements OtpStore {
  private readonly recs = new Map<string, OtpRecord>();
  private readonly sends = new Map<string, number[]>();

  async get(phone: string) { return this.recs.get(phone); }
  async put(phone: string, rec: OtpRecord) { this.recs.set(phone, { ...rec }); }
  async delete(phone: string) { this.recs.delete(phone); }
  async recordSend(phone: string, at: number, windowMs: number) {
    const list = (this.sends.get(phone) ?? []).filter((t) => t > at - windowMs);
    list.push(at);
    this.sends.set(phone, list);
    return [...list];
  }
}

export class RedisOtpStore implements OtpStore {
  constructor(private readonly redis: Redis, private readonly prefix = 'tasalli:otp:') {}

  async get(phone: string) {
    const raw = await this.redis.get(this.prefix + phone);
    return raw ? (JSON.parse(raw) as OtpRecord) : undefined;
  }
  async put(phone: string, rec: OtpRecord) {
    const ttl = Math.max(1, rec.expiresAt - Date.now());
    await this.redis.set(this.prefix + phone, JSON.stringify(rec), 'PX', ttl);
  }
  async delete(phone: string) { await this.redis.del(this.prefix + phone); }
  async recordSend(phone: string, at: number, windowMs: number) {
    const key = `${this.prefix}sends:${phone}`;
    await this.redis
      .multi()
      .zremrangebyscore(key, 0, at - windowMs)
      .zadd(key, at, `${at}-${Math.random()}`)
      .pexpire(key, windowMs)
      .exec();
    return (await this.redis.zrange(key, 0, -1, 'WITHSCORES'))
      .filter((_, i) => i % 2 === 1)
      .map(Number);
  }
}
