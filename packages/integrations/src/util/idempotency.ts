import type { Redis } from 'ioredis';

/**
 * Safety rule 6: exactly once. A key is "claimed" before side effects and
 * either "completed" (kept for the retention period) or "released" on failure
 * so a retry can try again. A claim that is never completed (process crash)
 * expires after `claimTtlSeconds`, after which a retry may claim it again.
 */
export interface IdempotencyStore {
  /** True if this caller now owns the key. False if it is completed or claimed by someone else. */
  claim(key: string, claimTtlSeconds?: number): Promise<boolean>;
  complete(key: string): Promise<void>;
  release(key: string): Promise<void>;
  isCompleted(key: string): Promise<boolean>;
}

const DEFAULT_CLAIM_TTL = 600;            // 10 minutes
const DONE_RETENTION = 60 * 60 * 24 * 30; // 30 days

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, { state: 'claimed' | 'done'; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  async claim(key: string, ttl = DEFAULT_CLAIM_TTL): Promise<boolean> {
    const e = this.entries.get(key);
    if (e && e.expiresAt > this.now()) return false;
    this.entries.set(key, { state: 'claimed', expiresAt: this.now() + ttl * 1000 });
    return true;
  }
  async complete(key: string): Promise<void> {
    this.entries.set(key, { state: 'done', expiresAt: this.now() + DONE_RETENTION * 1000 });
  }
  async release(key: string): Promise<void> {
    const e = this.entries.get(key);
    if (e?.state === 'claimed') this.entries.delete(key);
  }
  async isCompleted(key: string): Promise<boolean> {
    const e = this.entries.get(key);
    return !!e && e.state === 'done' && e.expiresAt > this.now();
  }
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private readonly redis: Redis, private readonly prefix = 'tasalli:idem:') {}

  async claim(key: string, ttl = DEFAULT_CLAIM_TTL): Promise<boolean> {
    const ok = await this.redis.set(this.prefix + key, 'claimed', 'EX', ttl, 'NX');
    return ok === 'OK';
  }
  async complete(key: string): Promise<void> {
    await this.redis.set(this.prefix + key, 'done', 'EX', DONE_RETENTION);
  }
  async release(key: string): Promise<void> {
    // Only delete our own claim, never a completed marker.
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == 'claimed' then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      this.prefix + key,
    );
  }
  async isCompleted(key: string): Promise<boolean> {
    return (await this.redis.get(this.prefix + key)) === 'done';
  }
}
