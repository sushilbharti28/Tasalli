import { randomUUID } from 'node:crypto';
import type {
  CallRow, ConsentState, DoseDetail, DoseRow, DoseStatus, MedicineRow, PersonRow, ScheduleRow, UserRow,
} from '../types.js';
import type { BlockReason, CallPatch, ConsentEventResult, ConsentEventVia, NewCall, Store } from './store.js';

interface State {
  users: Map<string, UserRow>;
  people: Map<string, PersonRow & { consentAt: Date | null }>;
  medicines: Map<string, MedicineRow>;
  schedules: Map<string, ScheduleRow>;
  doses: Map<string, DoseRow>;
  calls: Map<string, CallRow>;
  blocked: Map<string, { reason: BlockReason; at: Date }>;
  consentEvents: Array<{ personId: string; result: ConsentEventResult; via: ConsentEventVia; callId: string | null }>;
  webhookEvents: Set<string>;
}

function emptyState(): State {
  return {
    users: new Map(), people: new Map(), medicines: new Map(), schedules: new Map(), doses: new Map(),
    calls: new Map(), blocked: new Map(), consentEvents: [], webhookEvents: new Set(),
  };
}

/**
 * In-memory Store with the same semantics as PgStore. Transactions are serialised with a
 * mutex and rolled back on error (state snapshot), so concurrency tests behave like Postgres.
 */
export class MemoryStore implements Store {
  state: State;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly inTx: boolean;

  constructor(state?: State, inTx = false) {
    this.state = state ?? emptyState();
    this.inTx = inTx;
  }

  // ---- seeding helpers (tests and local dev) ----
  addUser(u: Partial<UserRow> & { phone: string }): UserRow {
    const row: UserRow = { id: randomUUID(), name: null, timeZone: 'Asia/Kolkata', locale: 'en', deleted: false, ...u };
    this.state.users.set(row.id, row);
    return row;
  }
  addPerson(p: Partial<PersonRow> & { ownerUserId: string; phone: string; nickname: string }): PersonRow {
    const row = {
      id: randomUUID(), isSelf: false, fullName: null, language: 'hi' as const, timeZone: 'Asia/Kolkata',
      canReadStrip: 'not_sure' as const, consent: 'pending' as const, paused: false, deleted: false, consentAt: null, ...p,
    };
    this.state.people.set(row.id, row);
    return row;
  }
  addMedicine(m: Partial<MedicineRow> & { personId: string; spokenName: string }): MedicineRow {
    const row: MedicineRow = {
      id: randomUUID(), kind: 'tablet', stripName: m.spokenName, strengthText: null, colourPrimary: null,
      colourSecondary: null, shape: null, size: null, marking: null, keptIn: null, packColour: null, printColour: null,
      capColour: null, numberLabel: null, sayPrintedName: false, extraInstruction: null, active: true, ...m,
    };
    this.state.medicines.set(row.id, row);
    return row;
  }
  addSchedule(s: Partial<ScheduleRow> & { medicineId: string; localTime: string; amountText: string }): ScheduleRow {
    const row: ScheduleRow = {
      id: randomUUID(), food: 'any', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate: '2000-01-01', endDate: null, ...s,
    };
    this.state.schedules.set(row.id, row);
    return row;
  }
  consentEvents() {
    return [...this.state.consentEvents];
  }
  allCalls(): CallRow[] {
    return [...this.state.calls.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  allDoses(): DoseRow[] {
    return [...this.state.doses.values()].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  }

  // ---- Store ----
  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    const run = async () => {
      const snapshot = cloneState(this.state);
      const tx = new MemoryStore(this.state, true);
      try {
        return await fn(tx);
      } catch (err) {
        restoreState(this.state, snapshot);
        throw err;
      }
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  async lockPhone(): Promise<void> {}
  async lockPerson(): Promise<void> {}

  async getUser(id: string) {
    return copy(this.state.users.get(id)) ?? null;
  }
  async getPerson(id: string) {
    const p = this.state.people.get(id);
    return p ? toPerson(p) : null;
  }
  async listPeopleByPhone(phone: string) {
    return [...this.state.people.values()].filter((p) => p.phone === phone && !p.deleted).map(toPerson);
  }
  async listSchedulablePeople() {
    return [...this.state.people.values()]
      .filter((p) => p.consent === 'consented' && !p.paused && !p.deleted && !this.state.blocked.has(p.phone))
      .map(toPerson);
  }
  async setPersonConsent(personId: string, state: ConsentState, at: Date) {
    const p = this.state.people.get(personId);
    if (!p) return;
    p.consent = state;
    if (state === 'consented') p.consentAt = at;
  }
  async insertConsentEvent(e: { personId: string; result: ConsentEventResult; via: ConsentEventVia; callId: string | null }) {
    this.state.consentEvents.push({ ...e });
  }
  async isBlocked(phone: string) {
    return this.state.blocked.has(phone);
  }
  async blockNumber(phone: string, reason: BlockReason) {
    if (this.state.blocked.has(phone)) return false;
    this.state.blocked.set(phone, { reason, at: new Date() });
    return true;
  }
  async listActiveSchedules(personId: string) {
    const out: Array<{ schedule: ScheduleRow; medicine: MedicineRow }> = [];
    for (const s of this.state.schedules.values()) {
      const m = this.state.medicines.get(s.medicineId);
      if (m && m.personId === personId && m.active) out.push({ schedule: copy(s)!, medicine: copy(m)! });
    }
    return out;
  }
  async getSchedule(id: string) {
    return copy(this.state.schedules.get(id)) ?? null;
  }
  async getMedicine(id: string) {
    return copy(this.state.medicines.get(id)) ?? null;
  }
  async insertDoses(rows: Array<{ scheduleId: string; personId: string; dueAt: Date }>) {
    for (const r of rows) {
      const exists = [...this.state.doses.values()].some(
        (d) => d.scheduleId === r.scheduleId && d.dueAt.getTime() === r.dueAt.getTime());
      if (exists) continue;
      const row: DoseRow = {
        id: randomUUID(), scheduleId: r.scheduleId, personId: r.personId, dueAt: new Date(r.dueAt), status: 'upcoming',
        confirmedAt: null, confirmedVia: null, callGroupId: null,
      };
      this.state.doses.set(row.id, row);
    }
  }
  async listDoses(personId: string, from: Date, to: Date) {
    return [...this.state.doses.values()]
      .filter((d) => d.personId === personId && d.dueAt >= from && d.dueAt <= to)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map((d) => copy(d)!);
  }
  async getDose(id: string) {
    return copy(this.state.doses.get(id)) ?? null;
  }
  async setDoseStatus(ids: string[], from: DoseStatus[], to: DoseStatus) {
    let n = 0;
    for (const id of ids) {
      const d = this.state.doses.get(id);
      if (d && from.includes(d.status)) {
        d.status = to;
        n++;
      }
    }
    return n;
  }
  async assignGroup(doseIds: string[], groupId: string) {
    const out: string[] = [];
    for (const id of doseIds) {
      const d = this.state.doses.get(id);
      if (d && d.status === 'upcoming' && d.callGroupId === null) {
        d.status = 'calling';
        d.callGroupId = groupId;
        out.push(id);
      }
    }
    return out;
  }
  async getGroupDetails(groupId: string): Promise<DoseDetail[]> {
    return [...this.state.doses.values()]
      .filter((d) => d.callGroupId === groupId)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map((d) => {
        const schedule = this.state.schedules.get(d.scheduleId)!;
        return { dose: copy(d)!, schedule: copy(schedule)!, medicine: copy(this.state.medicines.get(schedule.medicineId))! };
      });
  }
  async confirmGroup(groupId: string, via: 'key' | 'speech', at: Date) {
    let n = 0;
    for (const d of this.state.doses.values()) {
      if (d.callGroupId === groupId && (d.status === 'upcoming' || d.status === 'calling')) {
        d.status = 'confirmed';
        d.confirmedAt = new Date(at);
        d.confirmedVia = via;
        n++;
      }
    }
    return n;
  }
  async closeGroup(groupId: string, to: 'missed' | 'skipped_paused') {
    let n = 0;
    for (const d of this.state.doses.values()) {
      if (d.callGroupId === groupId && (d.status === 'upcoming' || d.status === 'calling')) {
        d.status = to;
        n++;
      }
    }
    return n;
  }
  async listUpcomingDoses(personId: string, from: Date) {
    return [...this.state.doses.values()]
      .filter((d) => d.personId === personId && d.status === 'upcoming' && d.dueAt >= from)
      .map((d) => copy(d)!);
  }
  async insertCall(row: NewCall, at: Date) {
    const call: CallRow = {
      id: randomUUID(), ...row, providerCallId: null, result: null, inputKind: null, inputValue: null,
      startedAt: null, endedAt: null, createdAt: new Date(at),
    };
    this.state.calls.set(call.id, call);
    return copy(call)!;
  }
  async getCall(id: string) {
    return copy(this.state.calls.get(id)) ?? null;
  }
  async updateCall(id: string, patch: CallPatch) {
    const c = this.state.calls.get(id);
    if (!c) return;
    if (patch.providerCallId && [...this.state.calls.values()].some((o) => o.id !== id && o.providerCallId === patch.providerCallId)) {
      throw new Error('duplicate provider_call_id');
    }
    Object.assign(c, patch);
  }
  async listCallsForGroup(groupId: string) {
    return this.allCalls().filter((c) => c.callGroupId === groupId).map((c) => copy(c)!);
  }
  async listCallsForPerson(personId: string, purpose: CallRow['purpose']) {
    return this.allCalls().filter((c) => c.personId === personId && c.purpose === purpose).map((c) => copy(c)!);
  }
  async countCallsToPhoneSince(phone: string, since: Date) {
    const ids = new Set([...this.state.people.values()].filter((p) => p.phone === phone).map((p) => p.id));
    return [...this.state.calls.values()].filter(
      (c) => c.personId !== null && ids.has(c.personId) && c.createdAt >= since && countsTowardCap(c)).length;
  }
  async answeredRemindersBetween(personId: string, from: Date, to: Date, excludeGroupId: string | null) {
    const calls = [...this.state.calls.values()].filter(
      (c) => c.personId === personId && c.purpose === 'reminder' && c.startedAt !== null &&
        c.createdAt >= from && c.createdAt < to && c.callGroupId !== excludeGroupId);
    const groups = new Set(calls.map((c) => c.callGroupId));
    const medicineIds = new Set<string>();
    for (const d of this.state.doses.values()) {
      if (d.callGroupId && groups.has(d.callGroupId)) {
        const s = this.state.schedules.get(d.scheduleId);
        if (s) medicineIds.add(s.medicineId);
      }
    }
    return { answeredCalls: calls.length, medicineIds: [...medicineIds] };
  }
  async recordWebhookEvent(provider: string, eventId: string) {
    const key = `${provider}\u0000${eventId}`;
    if (this.state.webhookEvents.has(key)) return false;
    this.state.webhookEvents.add(key);
    return true;
  }
}

/** A call counts toward the daily cap unless it failed before the provider accepted it. */
export function countsTowardCap(c: Pick<CallRow, 'status' | 'providerCallId'>): boolean {
  return !(c.status === 'failed' && c.providerCallId === null);
}

function toPerson(p: PersonRow & { consentAt: Date | null }): PersonRow {
  const { consentAt: _ignored, ...rest } = p;
  return { ...rest };
}

function copy<T>(v: T | undefined): T | undefined {
  return v === undefined ? undefined : structuredClone(v);
}

function cloneState(s: State): State {
  return structuredClone(s);
}

function restoreState(target: State, snapshot: State) {
  for (const key of Object.keys(snapshot) as Array<keyof State>) {
    (target as unknown as Record<string, unknown>)[key] = snapshot[key];
  }
}
