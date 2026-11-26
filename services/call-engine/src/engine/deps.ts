import type { CallLanguage, SpeechProvider, TelephonyProvider } from '@tasalli/contracts';
import type { Clock } from '../clock.js';
import type { Logger } from '../log.js';
import type { AlertSink, JobQueue } from '../queue/jobs.js';
import type { ScriptLibrary } from '../scripts/loader.js';
import type { SessionStore } from '../flows/session.js';
import type { RecordingClient, RecordingStorage } from '../recordings/types.js';
import type { Store } from '../store/store.js';

/** Text -> something the provider can play. AudioCache (TTS files) or SayUrls (Twilio <Say>). */
export interface AudioSource {
  urlFor(text: string, language: CallLanguage): Promise<string>;
}

export interface EngineConfig {
  callerId: string;
  /** Public base URL the provider calls back, no trailing slash. */
  publicBaseUrl: string;
  /** Seconds to wait for a reply (Gather timeout). */
  listenSeconds: number;
  /** The first medicine of a reminder call waits a little longer: the parent has only just picked up. */
  firstListenSeconds: number;
  testCallsPerDay: number;
  /** Dial limiter (v1.7): the provider plan's calls per second and concurrent calls. MAX_CALLS_PER_SECOND / MAX_CONCURRENT_CALLS. */
  maxCallsPerSecond: number;
  maxConcurrentCalls: number;
  /** Longest a call waits for a dial slot before it is dialled anyway (a dose is never dropped by the limiter). */
  dialWaitMaxMs: number;
  /** A dose processed late while the engine was up (busy, not down) is still called up to this many minutes after its time. */
  backlogMaxMinutes: number;
}

export interface Deps {
  store: Store;
  queue: JobQueue & AlertSink;
  provider: TelephonyProvider;
  audio: AudioSource;
  speech: SpeechProvider;
  scripts: ScriptLibrary;
  sessions: SessionStore;
  clock: Clock;
  log: Logger;
  config: EngineConfig;
  /** Waiting in the dial limiter. Default: a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Recordings are copied to `storage` (India) and removed from the provider with `client`. Absent: recording webhooks are ignored. */
  recordings?: { storage: RecordingStorage; client: RecordingClient };
}

export const defaultConfig = (over: Partial<EngineConfig> = {}): EngineConfig => ({
  callerId: '+910000000000', publicBaseUrl: 'http://localhost:8080', listenSeconds: 6, firstListenSeconds: 8, testCallsPerDay: 3,
  // Unlimited unless set: production reads the provider plan's limits from the environment (main.ts).
  maxCallsPerSecond: 1_000_000, maxConcurrentCalls: 1_000_000, dialWaitMaxMs: 20 * 60_000, backlogMaxMinutes: 90, ...over,
});

/** attempt = cycle * 3 + n, where n counts calls inside a cycle (0 first call, 1 and 2 retries). */
export const encodeAttempt = (cycle: number, n: number) => cycle * 3 + n;
export const decodeAttempt = (a: number) => ({ cycle: Math.floor(a / 3), n: a % 3 });
