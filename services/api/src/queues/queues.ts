/**
 * Interfaces with call-engine. Shared names; documented in services/api/README.md.
 * Producer side mirrors services/call-engine/src/queue/jobs.ts (EngineJobs): one queue,
 * "call-engine", payloads carry ids only, never phone numbers or medicine details.
 * The consumer reads current state from Postgres when it acts and re-checks consent,
 * block list and caps itself (safety rules 3 and 5).
 */
export const QUEUES = {
  /** API -> call-engine (consumed by call-engine). */
  callEngine: 'call-engine',
  /** call-engine -> API: optional notifications so the API can regenerate or drop doses at once. */
  apiEvents: 'tasalli-api-events',
  /** API internal: repeatable job that extends the dose window hourly. */
  apiMaintenance: 'tasalli-api-maintenance',
} as const;

export const JOBS = {
  /** call-engine job names (do not rename; defined by call-engine). */
  consentCall: 'consent.call',
  scheduleReplan: 'schedule.replan',
  testCall: 'test.call',
  /** NOT yet in call-engine's EngineJobs: one extra reminder call for a dose. Needs a call-engine handler. */
  doseRemind: 'dose.remind',
  /** tasalli-api-events */
  consentRecorded: 'consent-recorded',
  numberBlocked: 'number-blocked',
  /** tasalli-api-maintenance */
  extendDoseWindow: 'extend-dose-window',
} as const;

export interface ConsentCallJob { personId: string }
export interface ScheduleReplanJob { personId: string }
export interface TestCallJob { userId: string }
export interface DoseRemindJob { doseId: string }

/**
 * Queue tasalli-api-events, job consent-recorded. OPTIONAL, sent by call-engine AFTER it has
 * written people.consent and a consent_events row. The API then generates (or removes) doses.
 * Without it, doses appear at the next hourly window extension or call-engine replan.
 */
export interface ConsentRecordedJob {
  personId: string;
  result: 'consented' | 'declined' | 'opted_out' | 'no_answer';
}

/**
 * Queue tasalli-api-events, job number-blocked. OPTIONAL, sent by call-engine AFTER it has
 * inserted into blocked_numbers. The API removes upcoming doses for every person with that
 * number, across all accounts.
 */
export interface NumberBlockedJob {
  personId: string;
  reason: 'key_9' | 'stop_phrase' | 'declined' | 'admin';
}
