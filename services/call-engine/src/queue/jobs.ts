/**
 * Queue names and job payloads. These are the interface with services/api and the
 * integrations agent; they are documented in README.md under "Interfaces with api".
 */

/** Consumed by the call engine. services/api produces consent.call, schedule.replan and test.call. */
export const CALL_ENGINE_QUEUE = 'call-engine';
/** Produced by the call engine, consumed by the integrations agent (push, WhatsApp). */
export const ALERTS_QUEUE = 'integrations-alerts';

export interface EngineJobs {
  /** Place (or retry from the app) the consent call for a parent. */
  'consent.call': { personId: string };
  /** Recompute doses for the next 48 h and (re)arm their delayed jobs. Safe to send any time, any number of times. */
  'schedule.replan': { personId: string };
  /** Sample reminder call to the account holder's own phone. */
  'test.call': { userId: string };
  /** From services/api: "send one more reminder" for this dose. One call, no retries; consent, block list, billing and the daily cap are re-checked. */
  'dose.remind': { doseId: string };
  /** Internal: re-plan every schedulable person (repeatable, hourly). */
  'schedule.plan_all': Record<string, never>;
  /** Internal: a dose is due now. */
  'dose.due': { doseId: string };
  /** Internal: retry an unanswered reminder call. cycle is 0 before snooze, 1 after. */
  'reminder.retry': { callGroupId: string; attempt: number; cycle: number };
  /** Internal: the snoozed call, 15 minutes later. */
  'reminder.snooze': { callGroupId: string };
  /** Internal: retry an unanswered consent call. */
  'consent.retry': { personId: string; attempt: number };
  /** Internal: 20:00 in the parent's time zone: emit the evening_summary alert for that local date. */
  'summary.evening': { personId: string; localDate: string; /** v1.7: planned time (ISO); a job planned for an older time is skipped. */ at?: string };
  /** Internal (v1.7): one alert for the doses a person missed while the engine was down. */
  'outage.alert': { personId: string; localDate: string };
  /** Internal (v1.7, every 5 min): finish stale calls and never-dialled groups. */
  'calls.sweep': Record<string, never>;
  /** Recording-completed webhook: copy the audio to our storage in India, size-check it, then delete it from Twilio. Idempotent per recordingSid. */
  'recording.fetch': { callId: string; recordingSid: string; recordingUrl: string };
}

export type EngineJobName = keyof EngineJobs;

export type AlertKind =
  | 'dose_missed'        // 2 retries unanswered/unconfirmed, or parent said not taken after the snooze
  | 'doctor_changed'     // key 3 / "doctor ne badli"
  | 'unwell'             // parent said they are unwell
  | 'opted_out'          // key 9 / stop phrase: number blocked across all accounts
  | 'consent_given'
  | 'consent_declined'
  | 'consent_no_answer'  // consent call unanswered after 2 retries
  | 'evening_summary'    // once per person per local day, 20:00 parent's time
  | 'plan_lapsed';       // reminder skipped, plan not entitled; once per owner per local day

export interface AlertJob {
  kind: AlertKind;
  personId: string;
  ownerUserId: string;
  callGroupId: string | null;
  doseIds: string[];
  /** ISO timestamp (UTC) when the engine decided this. */
  at: string;
  /** Extra machine-readable reason, e.g. 'retries_exhausted' | 'said_not_taken' | 'daily_cap' | 'too_late'. */
  reason?: string;
  /** evening_summary: the person's local date; plan_lapsed: the owner's local date. YYYY-MM-DD. */
  localDate?: string;
}

export interface AddOptions {
  delayMs?: number;
  /** Deduplication key: a second add with the same jobId is ignored. Never contains ':' (BullMQ rule). */
  jobId?: string;
  /** BullMQ attempts (exponential backoff). Default 3. */
  attempts?: number;
}

export interface JobQueue {
  add<N extends EngineJobName>(name: N, data: EngineJobs[N], opts?: AddOptions): Promise<void>;
}

export interface AlertSink {
  /** jobId makes alerts exactly-once: one alert per (kind, group or person). */
  alert(job: AlertJob, jobId: string): Promise<void>;
}

export function jobId(...parts: Array<string | number>): string {
  return parts.join('_').replace(/:/g, '-');
}
