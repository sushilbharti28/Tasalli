// The adapter a call engine implements so the scenario suites can drive it.
// services/call-engine should provide a factory returning this interface,
// wired to the injected FakeTelephonyProvider, FakeSpeechProvider and clock.

import type { CallLanguage, NextAction } from '@tasalli/contracts';
import type { TestClock } from './clock';
import type { FakeSpeechProvider } from './fake-speech';
import type { FakeTelephonyProvider } from './fake-telephony';

export type ConsentState = 'pending' | 'consented' | 'declined' | 'opted_out';
export type DoseStatus = 'upcoming' | 'calling' | 'confirmed' | 'missed' | 'skipped_paused';

export interface PersonFixture {
  accountId: string;
  personId: string;
  phone: string;               // E.164
  language: CallLanguage;
  timeZone: string;            // IANA, the parent's zone
  /** 'pending' means the engine must run the consent call flow itself. */
  consent: ConsentState;
  isSelf?: boolean;
  paused?: boolean;
}

export interface ScheduleFixture {
  personId: string;
  medicineId: string;
  spokenName: string;
  localTime: string;           // 'HH:MM' in the person's time zone
  amountText: string;          // verbatim
  food: 'before' | 'after' | 'with' | 'any';
  daysOfWeek?: number[];       // ISO, 1 = Monday; default every day
}

export type AddPersonResult = { ok: true } | { ok: false; reason: 'limit_reached' | 'blocked' };

export interface DoseView {
  doseId: string;
  personId: string;
  medicineId: string;
  dueAt: string;               // UTC ISO instant
  status: DoseStatus;
  confirmedVia: 'key' | 'speech' | 'manual' | null;
  confirmedAt: string | null;
}

export interface AlertView {
  personId: string;
  kind: 'missed_dose' | string;
  doseIds: string[];
  at: string;
}

export interface PersonView {
  personId: string;
  consent: ConsentState;
}

export interface WebhookResponse {
  /** HTTP status the webhook endpoint would return. 2xx accepted; 401/403 for bad signatures. */
  status: number;
  /** For input events, what the call does next. */
  next?: NextAction;
}

export interface EngineUnderTest {
  addAccount(accountId: string, opts?: { timeZone?: string }): Promise<void>;
  addPerson(p: PersonFixture): Promise<AddPersonResult>;
  /** Pause or resume calls (child app toggle). */
  setPaused(personId: string, paused: boolean): Promise<void>;
  addSchedule(s: ScheduleFixture): Promise<void>;
  /**
   * One scheduler pass at the clock's current time: materialise doses, place
   * due calls (consent, reminder, retry, snooze), mark missed, send alerts.
   * The suites call this once per simulated minute.
   */
  tick(): Promise<void>;
  /** Deliver a raw provider webhook exactly as the HTTP endpoint would receive it. */
  handleWebhook(headers: Record<string, string>, body: unknown): Promise<WebhookResponse>;
  listDoses(personId: string): Promise<DoseView[]>;
  listAlerts(personId: string): Promise<AlertView[]>;
  getPerson(personId: string): Promise<PersonView>;
  isBlocked(phone: string): Promise<boolean>;
  /** Everything the engine logged, if it can expose it. Used for phone-masking checks. */
  logs?(): string[];
  close?(): Promise<void>;
}

export interface EngineDeps {
  telephony: FakeTelephonyProvider;
  speech: FakeSpeechProvider;
  clock: TestClock;
  /** Base URL the engine should put in statusWebhookUrl / inputWebhookUrl. */
  webhookBaseUrl: string;
}

export type EngineFactory = (deps: EngineDeps) => Promise<EngineUnderTest> | EngineUnderTest;
