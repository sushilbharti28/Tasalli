import type { CallLanguage } from '@tasalli/contracts';

/** Domain rows the call engine reads and writes. Mirrors packages/contracts/schema.sql. */

export type ConsentState = 'pending' | 'consented' | 'declined' | 'opted_out';
export type DoseStatus = 'upcoming' | 'calling' | 'confirmed' | 'missed' | 'skipped_paused';
export type CallPurposeRow = 'consent' | 'reminder' | 'test';
export type CallStatusRow = 'queued' | 'ringing' | 'answered' | 'no_answer' | 'busy' | 'failed' | 'completed';
export type CallResultRow =
  | 'confirmed' | 'snoozed' | 'repeat' | 'doctor_changed' | 'unwell' | 'stop' | 'declined' | 'consented' | 'none';

export interface UserRow {
  id: string;
  phone: string;
  name: string | null;
  timeZone: string;
  locale: 'en' | 'hi';
  deleted: boolean;
}

export interface PersonRow {
  id: string;
  ownerUserId: string;
  isSelf: boolean;
  nickname: string;
  fullName: string | null;
  phone: string;
  language: CallLanguage;
  timeZone: string;
  canReadStrip: 'yes' | 'no' | 'not_sure';
  consent: ConsentState;
  paused: boolean;
  deleted: boolean;
}

export type MedicineKind = 'tablet' | 'capsule' | 'syrup' | 'other';

export interface MedicineRow {
  id: string;
  personId: string;
  kind: MedicineKind;
  stripName: string;
  strengthText: string | null;
  spokenName: string;
  colourPrimary: string | null;
  colourSecondary: string | null;
  shape: 'round' | 'oval' | 'long' | 'square' | null;
  size: 'rai' | 'dal' | 'matar' | 'badam' | 'bigger' | null;
  marking: 'plain' | 'line' | 'letters' | 'unknown' | null;
  keptIn: 'strip' | 'loose' | 'bottle' | null;
  packColour: string | null;
  printColour: string | null;
  capColour: string | null;
  numberLabel: number | null;
  sayPrintedName: boolean;
  extraInstruction: string | null;
  active: boolean;
}

export interface ScheduleRow {
  id: string;
  medicineId: string;
  localTime: string; // 'HH:MM' or 'HH:MM:SS' in the person's time zone
  amountText: string;
  food: 'before' | 'after' | 'with' | 'any';
  daysOfWeek: number[]; // ISO 1=Mon..7=Sun
  startDate: string; // YYYY-MM-DD (person's local date)
  endDate: string | null;
}

export interface DoseRow {
  id: string;
  scheduleId: string;
  personId: string;
  dueAt: Date;
  status: DoseStatus;
  confirmedAt: Date | null;
  confirmedVia: 'key' | 'speech' | 'manual' | null;
  callGroupId: string | null;
}

/** A dose joined with what the call needs to say about it. */
export interface DoseDetail {
  dose: DoseRow;
  schedule: ScheduleRow;
  medicine: MedicineRow;
}

export interface CallRow {
  id: string;
  personId: string | null;
  purpose: CallPurposeRow;
  callGroupId: string | null;
  attempt: number;
  provider: string;
  providerCallId: string | null;
  status: CallStatusRow;
  result: CallResultRow | null;
  inputKind: 'key' | 'speech' | null;
  inputValue: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  /** Our own copy of the recording (path under /internal/recordings/), set only after it is saved in India and size-checked. Never a Twilio URL. */
  recordingUrl: string | null;
  createdAt: Date;
}

/** Mirrors the subscriptions table in packages/contracts/schema.sql. */
export interface SubscriptionRow {
  status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  currentPeriodEnd: Date | null;
  /** Set when a payment fails; the 3-day grace period runs from here. */
  pastDueSince: Date | null;
  trialEndsAt: Date | null;
}
