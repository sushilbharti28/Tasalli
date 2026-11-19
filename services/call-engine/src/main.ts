import { createServer } from 'node:http';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { TelephonyProvider } from '@tasalli/contracts';
import { systemClock } from './clock.js';
import { defaultConfig, type AudioSource } from './engine/deps.js';
import { Engine } from './engine/engine.js';
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
  {
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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    if (req.method === 'GET' && url.pathname === '/health') return void res.writeHead(200).end('ok');
    const m = /^\/webhooks\/([a-z]+)\/(status|input)$/.exec(url.pathname);
    if (req.method !== 'POST' || !m || m[1] !== provider.name) return void res.writeHead(404).end();
    const raw = Buffer.concat(await req.toArray() as Buffer[]).toString('utf8');
    const ctype = String(req.headers['content-type'] ?? '');
    const body = ctype.includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    headers['x-tasalli-url'] = base + (req.url ?? '');
    const out = await engine.handleWebhook(headers, body).catch((e) => {
      log.error('webhook error', { err: String(e) });
      return { status: 500, contentType: 'text/plain', body: 'error' };
    });
    res.writeHead(out.status, { 'content-type': out.contentType }).end(out.body);
  });
  server.listen(port, () => log.info('call-engine listening', { port, provider: provider.name }));
}

if (import.meta.url === `file://${process.argv[1]}`) void start();
