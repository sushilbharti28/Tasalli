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
  listenSeconds: number;
  testCallsPerDay: number;
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
  /** Recordings are copied to `storage` (India) and removed from the provider with `client`. Absent: recording webhooks are ignored. */
  recordings?: { storage: RecordingStorage; client: RecordingClient };
}

export const defaultConfig = (over: Partial<EngineConfig> = {}): EngineConfig => ({
  callerId: '+910000000000', publicBaseUrl: 'http://localhost:8080', listenSeconds: 8, testCallsPerDay: 3, ...over,
});

/** attempt = cycle * 3 + n, where n counts calls inside a cycle (0 first call, 1 and 2 retries). */
export const encodeAttempt = (cycle: number, n: number) => cycle * 3 + n;
export const decodeAttempt = (a: number) => ({ cycle: Math.floor(a / 3), n: a % 3 });
