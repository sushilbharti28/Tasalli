import { afterAll, describe, expect, it } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  ALERTS_QUEUE, ALERT_JOB_NAME, FakePushSender, FakeWhatsAppSender, InMemoryAlertData, MemoryLogger,
  RedisIdempotencyStore, startAlertWorker, type AlertJob,
} from '../src';

const url = process.env['REDIS_URL'];
const d = url ? describe : describe.skip;

d('alert worker on BullMQ + Redis', () => {
  const prefix = `test-${randomUUID()}`;
  const connection = { url: url ?? 'redis://localhost:6379', maxRetriesPerRequest: null };
  const redis = new IORedis(connection.url);
  const closers: Array<() => Promise<unknown>> = [];
  afterAll(async () => {
    for (const c of closers.reverse()) await c();
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('a duplicated enqueue and a retried job still give exactly one push and one WhatsApp', async () => {
    const data = new InMemoryAlertData();
    data.people.set('p1', { id: 'p1', ownerUserId: 'u1', nickname: 'Maa', timeZone: 'Asia/Kolkata' });
    data.recipients.set('u1', { userId: 'u1', phoneE164: '+919876512861', locale: 'en', timeZone: 'Asia/Kolkata', whatsappOptIn: true, pushTokens: ['t1'] });
    data.doses.set('d1', { personId: 'p1', doseId: 'd1', spokenName: 'Thyroid wali', dueAt: '2026-11-19T01:30:00Z', status: 'missed' });
    const push = new FakePushSender();
    const whatsapp = new FakeWhatsAppSender();
    whatsapp.failNext(1, true); // first attempt: WhatsApp temporarily down

    const queue = new Queue(ALERTS_QUEUE, { connection, prefix });
    const events = new QueueEvents(ALERTS_QUEUE, { connection, prefix });
    await events.waitUntilReady();
    const worker = startAlertWorker(
      { data, push, whatsapp, idempotency: new RedisIdempotencyStore(redis, `${prefix}:idem:`), logger: new MemoryLogger() },
      { connection, prefix },
    );
    closers.push(() => queue.close(), () => events.close(), () => worker.close());

    const job: AlertJob = { kind: 'dose_missed', personId: 'p1', ownerUserId: 'u1', callGroupId: 'g9', doseIds: ['d1'], at: new Date().toISOString(), reason: 'retries_exhausted' };
    const opts = { jobId: 'dose_missed_g9', attempts: 3, backoff: { type: 'fixed', delay: 50 } };
    const done = new Promise<void>((resolve) => events.on('completed', ({ jobId }) => jobId === 'dose_missed_g9' && resolve()));
    await queue.add(ALERT_JOB_NAME, job, opts);
    await queue.add(ALERT_JOB_NAME, job, opts); // engine webhook replay: same jobId, ignored by BullMQ
    await done;

    const j = await queue.getJob('dose_missed_g9');
    expect(j?.attemptsMade).toBe(2);
    expect(push.sent).toHaveLength(1);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]!.params['medicines']).toBe('Thyroid wali');
  }, 15_000);
});
