import { join } from 'node:path';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { TelephonyProvider } from '@tasalli/contracts';
import { systemClock } from './clock.js';
import { defaultConfig, type AudioSource } from './engine/deps.js';
import { Engine } from './engine/engine.js';
import { LocalFsRecordingStorage } from './recordings/storage.js';
import { TwilioRecordingClient } from './recordings/twilio-client.js';
import { buildTwilio } from './providers/twilio-factory.js';
import { createWebhookServer } from './server.js';
import { MemorySessionStore, RedisSessionStore } from './flows/session.js';
import { createLogger } from './log.js';
import { FakeProvider } from './providers/fake-telephony.js';
import { FakeSpeech } from './providers/fake-speech.js';
import { BullQueues } from './queue/bullmq.js';
import { MemoryQueue } from './queue/memory.js';
import { loadRootEnv } from './env.js';
import { DEFAULT_SCRIPTS_DIR, ScriptLibrary } from './scripts/loader.js';
import { MemoryStore } from './store/memory.js';
import { PgStore } from './store/postgres.js';
import { AudioCache, LocalFsAudioStorage } from './tts/cache.js';

/** Config comes from environment variables by name; nothing secret is in the repository. */
export async function start() {
  loadRootEnv();
  const env = process.env;
  const log = createLogger();
  const port = Number(env.CALL_ENGINE_PORT || env.PORT || 8080);
  const base = (env.CALL_ENGINE_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
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
  // Recordings are copied to RECORDINGS_DIR (production: storage in the Mumbai region) and then deleted at Twilio.
  const recStorage = new LocalFsRecordingStorage(env.RECORDINGS_DIR || join(process.cwd(), '.recordings'));
  const recordings = env.TELEPHONY_PROVIDER === 'twilio'
    ? { storage: recStorage, client: new TwilioRecordingClient(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!) } : undefined;
  const engine = new Engine({
    recordings,
    store, queue, provider, audio, speech, sessions: redis ? new RedisSessionStore(redis) : new MemorySessionStore(),
    scripts: new ScriptLibrary(env.SCRIPTS_DIR || DEFAULT_SCRIPTS_DIR, log), clock: systemClock, log,
    config: defaultConfig({ callerId: env.CALLER_ID || env.TWILIO_FROM_NUMBER || '+910000000000', publicBaseUrl: base,
      // The provider plan's limits (Twilio starts at 1 call per second). Calls wait on our side instead of failing at the provider.
      maxCallsPerSecond: positiveInt(env.MAX_CALLS_PER_SECOND, 1), maxConcurrentCalls: positiveInt(env.MAX_CONCURRENT_CALLS, 20) }),
  });
  if (queue instanceof BullQueues) {
    queue.startWorker((n, data) => engine.handleJob(n, data), log);
    await queue.ensurePlanAllSchedule();
    await queue.ensureSweepSchedule();
  } else {
    queue.setHandler((n, data) => engine.handleJob(n, data));
    setInterval(() => void queue.runDue().catch((e) => log.error('job error', { err: String(e) })), 1000);
    setInterval(() => void engine.handleJob('calls.sweep', {}).catch((e) => log.error('sweep error', { err: String(e) })), 5 * 60_000);
  }
  // Heartbeat: a dose that runs late while the engine was up is still called; after real downtime it is reported as missed.
  void engine.heartbeat();
  setInterval(() => void engine.heartbeat().catch((e) => log.error('heartbeat error', { err: String(e) })), 30_000);

  createWebhookServer(engine, provider, base, log, { storage: recStorage, readToken: env.RECORDINGS_READ_TOKEN }).listen(port, () => log.info('call-engine listening', { port, provider: provider.name }));
}

if (import.meta.url === `file://${process.argv[1]}`) void start();

function positiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
