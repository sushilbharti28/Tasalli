import { afterAll, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RedisIdempotencyStore, RedisOtpStore } from '../src';

// Runs only when REDIS_URL is set (CI service container or local Redis).
const url = process.env['REDIS_URL'];
const d = url ? describe : describe.skip;

d('Redis-backed stores', () => {
  const redis = new IORedis(url ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const prefix = `test:${randomUUID()}:`;
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('idempotency: claim once, release on failure, complete is permanent', async () => {
    const s = new RedisIdempotencyStore(redis, prefix);
    expect(await s.claim('k')).toBe(true);
    expect(await s.claim('k')).toBe(false);
    await s.release('k');
    expect(await s.claim('k')).toBe(true);
    await s.complete('k');
    await s.release('k'); // must not delete a completed marker
    expect(await s.claim('k')).toBe(false);
    expect(await s.isCompleted('k')).toBe(true);
  });

  it('otp store round-trips and counts sends in a window', async () => {
    const s = new RedisOtpStore(redis, prefix);
    await s.put('+919876512861', { codeHash: 'ab', expiresAt: Date.now() + 60_000, attempts: 1 });
    expect(await s.get('+919876512861')).toMatchObject({ codeHash: 'ab', attempts: 1 });
    await s.delete('+919876512861');
    expect(await s.get('+919876512861')).toBeUndefined();
    const now = Date.now();
    await s.recordSend('+919876512861', now - 2 * 3600_000, 3600_000);
    await s.recordSend('+919876512861', now - 1000, 3600_000);
    expect(await s.recordSend('+919876512861', now, 3600_000)).toHaveLength(2);
  });
});
