import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { CLOCK, FixedClock } from '../../src/common/clock';
import { loadConfig } from '../../src/config';
import { Db } from '../../src/db/db.service';
import { JOB_PUBLISHER, JobPublisher } from '../../src/queues/job-publisher';
import Redis from 'ioredis';
import { REDIS } from '../../src/auth/otp-store';
import { TEST_DB_URL } from './global-setup';

export class RecordingPublisher implements JobPublisher {
  jobs: { queue: string; name: string; data: any }[] = [];
  async publish(queue: string, name: string, data: object) {
    this.jobs.push({ queue, name, data });
  }
  named(name: string) {
    return this.jobs.filter((j) => j.name === name);
  }
}

export const CODE = '123456';
export const WEBHOOK_SECRET = 'test-billing-secret';

export async function createApp(now = '2026-11-20T06:00:00Z') {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DB_URL, OTP_FIXED_CODE: CODE, RUN_WORKERS: 'false', BILLING_WEBHOOK_SECRET: WEBHOOK_SECRET,
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  } as NodeJS.ProcessEnv);
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(new Date(now));
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(JOB_PUBLISHER).useValue(publisher)
    .overrideProvider(CLOCK).useValue(clock)
    .compile();
  const app = configureApp(mod.createNestApplication({ rawBody: true }));
  await app.init();
  const db = app.get(Db);
  await db.query('truncate users, blocked_numbers, audit_log, webhook_events cascade');
  const http = () => request(app.getHttpServer());
  /** Signs in with the fixed OTP; returns a bearer token. */
  const redis = app.get<Redis>(REDIS);
  const clearOtp = async () => { const k = await redis.keys('tasalli:otp*'); if (k.length) await redis.del(...k); };
  await clearOtp();
  const login = async (phone: string) => {
    const keys = await redis.keys('tasalli:otp*');
    if (keys.length) await redis.del(...keys); // reset OTP rate limits between logins
    await http().post('/auth/otp/request').send({ phone }).expect(204);
    const r = await http().post('/auth/otp/verify').send({ phone, code: CODE }).expect(200);
    return r.body.token as string;
  };
  const close = async () => { await app.close(); redis.disconnect(); };
  return { app: app as INestApplication, db, http, login, publisher, clock, redis, close };
}
export type Harness = Awaited<ReturnType<typeof createApp>>;

export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
