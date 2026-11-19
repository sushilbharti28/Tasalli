/**
 * Alert queue interface with the call engine.
 *
 * Mirrors services/call-engine/src/queue/jobs.ts (call-engine/v1 branch): queue
 * `integrations-alerts`, job name `alert`, payload `AlertJob`, enqueued with a dedupe jobId
 * (one alert per kind and call group or person) and attempts: 5 with exponential backoff.
 *
 * Added here, pending alignment with the call engine: kind `evening_summary` with `localDate`.
 * These types should move to packages/contracts once both sides agree.
 */
export const ALERTS_QUEUE = 'integrations-alerts';
export const ALERT_JOB_NAME = 'alert';

export type AlertKind =
  | 'dose_missed'        // 2 retries unanswered/unconfirmed, or parent said not taken after the snooze
  | 'doctor_changed'     // key 3 / "doctor ne badli"
  | 'unwell'             // parent said they are unwell
  | 'opted_out'          // key 9 / stop phrase: number blocked across all accounts
  | 'consent_given'
  | 'consent_declined'
  | 'consent_no_answer'  // consent call unanswered after 2 retries
  | 'evening_summary';   // PROPOSED: once per person per local day

export interface AlertJob {
  kind: AlertKind;
  personId: string;
  ownerUserId: string;
  callGroupId: string | null;
  doseIds: string[];
  /** ISO timestamp (UTC) when the engine decided this. */
  at: string;
  /** e.g. 'retries_exhausted' | 'said_not_taken' | 'daily_cap' | 'too_late'. */
  reason?: string;
  /** PROPOSED, evening_summary only: the person's local date, YYYY-MM-DD. */
  localDate?: string;
}

/** Same jobId rule as the call engine: parts joined by '_', never ':' (BullMQ rule). */
export function alertJobId(...parts: Array<string | number>): string {
  return parts.join('_').replace(/:/g, '-');
}

/** Suggested dedupe id for the evening summary: one per person per local date. */
export function eveningSummaryJobId(personId: string, localDate: string): string {
  return alertJobId('evening_summary', personId, localDate);
}
