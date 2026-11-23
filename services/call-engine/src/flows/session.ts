import type { Redis } from 'ioredis';
import type { CallLanguage, NextAction } from '@tasalli/contracts';

/** Conversation state for one live call (not in the schema: it only matters while the call is up). */
export interface CallSession {
  callId: string;
  purpose: 'consent' | 'reminder' | 'test';
  language: CallLanguage;
  to: string;
  /** What the first prompt said, and the full description used for key 0. */
  mainText: string;
  fullText: string;
  unclearCount: number;
  repeats: number;
  steps: number;
  keypadOnly: boolean;
  /** Reminder calls: silence on the current medicine was already answered by playing it again (once per medicine). */
  silenceRepeated?: boolean;
  /** Reminder and consent calls: "can you hear me?" comes first. `next` is what plays after a yes (intro and first medicine, or the consent question). */
  presence?: { state: 'pending' | 'ok'; asks: number; text: string; next: string };
  /** When the call was answered (ms since epoch). Set once, by the 'answered' status (or by the first input if that never arrived). */
  answeredAtMs?: number;
  /** "Not taken" was answered once with not_taken_ack (take it, press 1, or 2 for a reminder). */
  notTakenAsked?: boolean;
  /** Reminder calls: one medicine at a time. Survives webhooks (Redis/memory), so a repeated webhook never advances twice. */
  reminder?: {
    items: Array<{ doseId: string; /** first time it is said (full or short) */ first: string; /** key 0 / "phir se" */ full: string }>;
    index: number;
    outcomes: Record<string, 'confirmed' | 'declined' | 'none'>;
    /** What was heard for each medicine, for logs and test-reminder. */
    heard: Record<string, string[]>;
  };
  /** NextAction returned per input event id, replayed for duplicate webhooks. */
  responses: Record<string, NextAction>;
}

export interface SessionStore {
  get(callId: string): Promise<CallSession | null>;
  set(session: CallSession): Promise<void>;
  /** Atomic counter with expiry (used for test-call caps). */
  incr(key: string, ttlSeconds: number): Promise<number>;
  peek(key: string): Promise<number>;
}

const TTL = 6 * 3600;

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, CallSession>();
  private counters = new Map<string, number>();
  async get(callId: string) {
    const s = this.sessions.get(callId);
    return s ? structuredClone(s) : null;
  }
  async set(session: CallSession) {
    this.sessions.set(session.callId, structuredClone(session));
  }
  async incr(key: string) {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }
  async peek(key: string) {
    return this.counters.get(key) ?? 0;
  }
}

export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: Redis, private readonly prefix = 'tasalli:ce:') {}
  async get(callId: string) {
    const raw = await this.redis.get(`${this.prefix}session:${callId}`);
    return raw ? (JSON.parse(raw) as CallSession) : null;
  }
  async set(session: CallSession) {
    await this.redis.set(`${this.prefix}session:${session.callId}`, JSON.stringify(session), 'EX', TTL);
  }
  async incr(key: string, ttlSeconds: number) {
    const k = `${this.prefix}counter:${key}`;
    const res = await this.redis.multi().incr(k).expire(k, ttlSeconds).exec();
    return Number(res?.[0]?.[1] ?? 0);
  }
  async peek(key: string) {
    return Number((await this.redis.get(`${this.prefix}counter:${key}`)) ?? 0);
  }
}
