import { join } from 'node:path';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { TelephonyProvider } from '@tasalli/contracts';
import { systemClock } from './clock.js';
import { defaultConfig, type AudioSource } from './engine/deps.js';
import { Engine } from './engine/engine.js';
import { buildTwilio } from './providers/twilio-factory.js';
import { createWebhookServer } from './server.js';
import { MemorySessionStore, RedisSessionStore } from './flows/session.js';
import { createLogger } from './log.js';
import { FakeProvider } from './providers/fake-telephony.js';
import { FakeSpeech } from './providers/fake-speech.js';
import { BullQueues } from './queue/bullmq.js';
import { MemoryQueue } from './queue/memory.js';
import { ScriptLibrary } from './scripts/loader.js';
import { MemoryStore } from './store/memory.js';
import { PgStore } from './store/postgres.js';
import { AudioCache, LocalFsAudioStorage } from './tts/cache.js';

/** Config comes from environment variables by name; nothing secret is in the repository. */
export async function start() {
  const env = process.env;
  const log = createLogger();
  const port = Number(env.PORT ?? 8080);
  const base = (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  const speech = new FakeSpeech();
  let provider: TelephonyProvider;
  let audio: AudioSource;
  if (env.TELEPHONY_PROVIDER === 'twilio') {
    ({ provider, audio } = buildTwilio(env));
  } else {
    provider = new FakeProvider(env.FAKE_WEBHOOK_SECRET ?? 'dev-secret', systemClock);
    audio = new AudioCache(speech, new LocalFsAudioStorage(env.AUDIO_DIR ?? join(process.cwd(), '.audio'), `${base}/audio`));
  }
  const store = env.DATABASE_URL ? new PgStore(new pg.Pool({ connectionString: env.DATABASE_URL })) : new MemoryStore();
  const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) : null;
  const queue = redis ? new BullQueues(redis) : new MemoryQueue(systemClock);
  const engine = new Engine({
    store, queue, provider, audio, speech, sessions: redis ? new RedisSessionStore(redis) : new MemorySessionStore(),
    scripts: new ScriptLibrary(env.SCRIPTS_DIR ?? null, log), clock: systemClock, log,
    config: defaultConfig({ callerId: env.CALLER_ID ?? env.TWILIO_FROM_NUMBER ?? '+910000000000', publicBaseUrl: base }),
  });
  if (queue instanceof BullQueues) {
    queue.startWorker((n, data) => engine.handleJob(n, data), log);
    await queue.ensurePlanAllSchedule();
  } else {
    queue.setHandler((n, data) => engine.handleJob(n, data));
    setInterval(() => void queue.runDue().catch((e) => log.error('job error', { err: String(e) })), 1000);
  }

  createWebhookServer(engine, provider, base, log).listen(port, () => log.info('call-engine listening', { port, provider: provider.name }));
}

if (import.meta.url === `file://${process.argv[1]}`) void start();
