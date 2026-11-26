import type {
  CallRow, ConsentState, DoseDetail, DoseRow, DoseStatus, MedicineRow, PersonRow, ScheduleRow, SubscriptionRow, UserRow,
} from '../types.js';

export type ConsentEventResult = 'consented' | 'declined' | 'no_answer' | 'opted_out';
export type ConsentEventVia = 'key' | 'speech' | 'self_otp' | 'admin';
export type BlockReason = 'key_9' | 'stop_phrase' | 'declined' | 'admin';

export interface NewCall {
  personId: string | null;
  purpose: CallRow['purpose'];
  callGroupId: string | null;
  attempt: number;
  provider: string;
  status: CallRow['status'];
}

export type CallPatch = Partial<Pick<CallRow,
  'providerCallId' | 'status' | 'result' | 'inputKind' | 'inputValue' | 'startedAt' | 'endedAt' | 'recordingUrl'>>;

/**
 * Persistence used by the call engine. Two implementations:
 * - PgStore: Postgres, against packages/contracts/schema.sql (production).
 * - MemoryStore: in-process, for the FakeProvider scenario suite and local work.
 *
 * Methods called on the object passed to `transaction` run inside one transaction.
 * Calling `transaction` on a transaction-scoped store just runs the function in the same transaction.
 */
export interface Store {
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  /** Serialise work per phone number (caps, global block) until the transaction ends. */
  lockPhone(phone: string): Promise<void>;
  /** Serialise work per person (dose grouping) until the transaction ends. */
  lockPerson(personId: string): Promise<void>;

  getUser(id: string): Promise<UserRow | null>;
  /** All subscription rows of an account (billing gate). */
  listSubscriptions(userId: string): Promise<SubscriptionRow[]>;
  getPerson(id: string): Promise<PersonRow | null>;
  listPeopleByPhone(phone: string): Promise<PersonRow[]>;
  /** Consented, not paused, not deleted, number not blocked. */
  listSchedulablePeople(): Promise<PersonRow[]>;
  setPersonConsent(personId: string, state: ConsentState, at: Date): Promise<void>;
  insertConsentEvent(e: { personId: string; result: ConsentEventResult; via: ConsentEventVia; callId: string | null }): Promise<void>;

  isBlocked(phone: string): Promise<boolean>;
  /** Returns true if the number was newly blocked. */
  blockNumber(phone: string, reason: BlockReason): Promise<boolean>;

  listActiveSchedules(personId: string): Promise<Array<{ schedule: ScheduleRow; medicine: MedicineRow }>>;
  getSchedule(id: string): Promise<ScheduleRow | null>;
  getMedicine(id: string): Promise<MedicineRow | null>;

  /** Insert doses; existing (schedule_id, due_at) pairs are left untouched. */
  insertDoses(rows: Array<{ scheduleId: string; personId: string; dueAt: Date }>): Promise<void>;
  listDoses(personId: string, from: Date, to: Date): Promise<DoseRow[]>;
  getDose(id: string): Promise<DoseRow | null>;
  /** Move doses in `from` statuses to `to`. Returns the number of rows changed. */
  setDoseStatus(ids: string[], from: DoseStatus[], to: DoseStatus): Promise<number>;
  /** Mark doses as part of a call group (status calling). Only upcoming, ungrouped doses change. */
  assignGroup(doseIds: string[], groupId: string): Promise<string[]>;
  /**
   * "One more reminder": move one dose that is upcoming or missed (never confirmed, never mid-call) into a new group, status calling.
   * Atomic, so a duplicate request changes nothing. Returns false if the dose was not in such a state.
   */
  regroupDose(doseId: string, groupId: string): Promise<boolean>;
  getGroupDetails(groupId: string): Promise<DoseDetail[]>;
  /** Confirm the group's doses that are still upcoming/calling. Returns rows changed. */
  confirmGroup(groupId: string, via: 'key' | 'speech', at: Date): Promise<number>;
  /** Confirm these doses if they are still upcoming/calling (one medicine of a call). Returns rows changed. */
  confirmDoses(ids: string[], via: 'key' | 'speech', at: Date): Promise<number>;
  /** Move these doses to `to` if they are still upcoming/calling. Returns rows changed. */
  closeDoses(ids: string[], to: 'missed' | 'skipped_paused'): Promise<number>;
  /** Move the group's still-open (upcoming/calling) doses to `to`. Returns rows changed. */
  closeGroup(groupId: string, to: 'missed' | 'skipped_paused'): Promise<number>;
  /** Upcoming doses for a person from `from` onward. */
  listUpcomingDoses(personId: string, from: Date): Promise<DoseRow[]>;

  insertCall(row: NewCall, at: Date): Promise<CallRow>;
  getCall(id: string): Promise<CallRow | null>;
  /** Our call for a provider's call id (Exotel Voicebot stream start). */
  getCallByProviderCallId(providerCallId: string): Promise<CallRow | null>;
  updateCall(id: string, patch: CallPatch): Promise<void>;
  listCallsForGroup(groupId: string): Promise<CallRow[]>;
  /** Calls of this person and purpose, oldest first; only those created at or after `since` when given (keeps the query bounded). */
  listCallsForPerson(personId: string, purpose: CallRow['purpose'], since?: Date): Promise<CallRow[]>;
  /**
   * Scheduling (v1.7): how many first calls are still to come for this phone in [from, to): distinct 30-minute windows and
   * food timings of upcoming, ungrouped doses of every person with this number. Retries leave this many calls of the daily cap free.
   */
  countUpcomingSlotsForPhone(phone: string, from: Date, to: Date): Promise<number>;
  /** Calls not ended yet, created at or after `since` (dial limiter: concurrent calls). */
  countLiveCalls(since: Date): Promise<number>;
  /** Calls still open (no end) that were created before `before`: lost status webhooks or crashes (sweeper). */
  listStaleCalls(before: Date): Promise<CallRow[]>;
  /** Groups whose doses are 'calling', due before `before`, with no call row at all (crash between grouping and dialling). */
  listOrphanGroups(before: Date): Promise<string[]>;
  /** Calls placed (or being placed) to people with this number since `since`, across all accounts. */
  countCallsToPhoneSince(phone: string, since: Date): Promise<number>;
  /**
   * Answered reminder calls for this person in [from, to), excluding one group,
   * and the medicines those calls announced. Drives full-vs-short and the Sunday line.
   */
  answeredRemindersBetween(personId: string, from: Date, to: Date, excludeGroupId: string | null):
    Promise<{ answeredCalls: number; medicineIds: string[] }>;

  /** Safety rule 6: returns false if (provider, eventId) was already recorded. */
  recordWebhookEvent(provider: string, eventId: string, at: Date): Promise<boolean>;
}
