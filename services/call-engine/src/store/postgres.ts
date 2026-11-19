import pg from 'pg';
import type {
  CallRow, ConsentState, DoseDetail, DoseRow, DoseStatus, MedicineRow, PersonRow, ScheduleRow, UserRow,
} from '../types.js';
import type { BlockReason, CallPatch, ConsentEventResult, ConsentEventVia, NewCall, Store } from './store.js';

type Queryable = pg.Pool | pg.PoolClient;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Postgres Store against packages/contracts/schema.sql. */
export class PgStore implements Store {
  constructor(private readonly db: Queryable, private readonly inTx = false) {}

  static fromUrl(url: string): { store: PgStore; pool: pg.Pool } {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    return { store: new PgStore(pool), pool };
  }

  private async q(sql: string, params: unknown[] = []): Promise<Row[]> {
    const res = await this.db.query(sql, params);
    return res.rows;
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    const client = await (this.db as pg.Pool).connect();
    try {
      await client.query('begin');
      const out = await fn(new PgStore(client, true));
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async lockPhone(phone: string) {
    await this.q(`select pg_advisory_xact_lock(hashtext('phone:' || $1))`, [phone]);
  }
  async lockPerson(personId: string) {
    await this.q(`select pg_advisory_xact_lock(hashtext('person:' || $1))`, [personId]);
  }

  async getUser(id: string): Promise<UserRow | null> {
    const [r] = await this.q(`select * from users where id = $1`, [id]);
    return r ? { id: r.id, phone: r.phone_e164, name: r.name, timeZone: r.time_zone, locale: r.locale, deleted: r.deleted_at !== null } : null;
  }
  async getPerson(id: string) {
    const [r] = await this.q(`select * from people where id = $1`, [id]);
    return r ? mapPerson(r) : null;
  }
  async listPeopleByPhone(phone: string) {
    return (await this.q(`select * from people where phone_e164 = $1 and deleted_at is null`, [phone])).map(mapPerson);
  }
  async listSchedulablePeople() {
    return (await this.q(
      `select p.* from people p
        where p.consent = 'consented' and not p.paused and p.deleted_at is null
          and not exists (select 1 from blocked_numbers b where b.phone_e164 = p.phone_e164)`)).map(mapPerson);
  }
  async setPersonConsent(personId: string, state: ConsentState, at: Date) {
    await this.q(
      `update people set consent = $2, consent_at = case when $2 = 'consented' then $3::timestamptz else consent_at end where id = $1`,
      [personId, state, at]);
  }
  async insertConsentEvent(e: { personId: string; result: ConsentEventResult; via: ConsentEventVia; callId: string | null }) {
    await this.q(`insert into consent_events (person_id, result, via, call_id) values ($1, $2, $3, $4)`,
      [e.personId, e.result, e.via, e.callId]);
  }
  async isBlocked(phone: string) {
    return (await this.q(`select 1 from blocked_numbers where phone_e164 = $1`, [phone])).length > 0;
  }
  async blockNumber(phone: string, reason: BlockReason) {
    const rows = await this.q(
      `insert into blocked_numbers (phone_e164, reason) values ($1, $2) on conflict do nothing returning phone_e164`,
      [phone, reason]);
    return rows.length > 0;
  }
  async listActiveSchedules(personId: string) {
    const rows = await this.q(
      `select s.id as s_id, s.medicine_id as s_medicine_id, to_char(s.local_time, 'HH24:MI:SS') as s_local_time,
              s.amount_text as s_amount_text, s.food as s_food, s.days_of_week as s_days_of_week,
              to_char(s.start_date, 'YYYY-MM-DD') as s_start_date, to_char(s.end_date, 'YYYY-MM-DD') as s_end_date, m.*
         from schedules s join medicines m on m.id = s.medicine_id
        where m.person_id = $1 and m.active`, [personId]);
    return rows.map((r) => ({ schedule: mapSchedulePrefixed(r), medicine: mapMedicine(r) }));
  }
  async getSchedule(id: string) {
    const [r] = await this.q(
      `select id as s_id, medicine_id as s_medicine_id, to_char(local_time, 'HH24:MI:SS') as s_local_time,
              amount_text as s_amount_text, food as s_food, days_of_week as s_days_of_week,
              to_char(start_date, 'YYYY-MM-DD') as s_start_date, to_char(end_date, 'YYYY-MM-DD') as s_end_date
         from schedules where id = $1`, [id]);
    return r ? mapSchedulePrefixed(r) : null;
  }
  async getMedicine(id: string) {
    const [r] = await this.q(`select * from medicines where id = $1`, [id]);
    return r ? mapMedicine(r) : null;
  }
  async insertDoses(rows: Array<{ scheduleId: string; personId: string; dueAt: Date }>) {
    if (rows.length === 0) return;
    await this.q(
      `insert into doses (schedule_id, person_id, due_at)
       select * from unnest($1::uuid[], $2::uuid[], $3::timestamptz[])
       on conflict (schedule_id, due_at) do nothing`,
      [rows.map((r) => r.scheduleId), rows.map((r) => r.personId), rows.map((r) => r.dueAt)]);
  }
  async listDoses(personId: string, from: Date, to: Date) {
    return (await this.q(
      `select * from doses where person_id = $1 and due_at between $2 and $3 order by due_at`, [personId, from, to])).map(mapDose);
  }
  async getDose(id: string) {
    const [r] = await this.q(`select * from doses where id = $1`, [id]);
    return r ? mapDose(r) : null;
  }
  async setDoseStatus(ids: string[], from: DoseStatus[], to: DoseStatus) {
    if (ids.length === 0) return 0;
    const rows = await this.q(
      `update doses set status = $3 where id = any($1::uuid[]) and status = any($2::dose_status[]) returning id`, [ids, from, to]);
    return rows.length;
  }
  async assignGroup(doseIds: string[], groupId: string) {
    if (doseIds.length === 0) return [];
    const rows = await this.q(
      `update doses set status = 'calling', call_group_id = $2
        where id = any($1::uuid[]) and status = 'upcoming' and call_group_id is null returning id`, [doseIds, groupId]);
    return rows.map((r) => r.id as string);
  }
  async getGroupDetails(groupId: string): Promise<DoseDetail[]> {
    const rows = await this.q(
      `select d.id as d_id, d.schedule_id as d_schedule_id, d.person_id as d_person_id, d.due_at as d_due_at,
              d.status as d_status, d.confirmed_at as d_confirmed_at, d.confirmed_via as d_confirmed_via,
              d.call_group_id as d_call_group_id,
              s.id as s_id, s.medicine_id as s_medicine_id, to_char(s.local_time, 'HH24:MI:SS') as s_local_time,
              s.amount_text as s_amount_text, s.food as s_food, s.days_of_week as s_days_of_week,
              to_char(s.start_date, 'YYYY-MM-DD') as s_start_date, to_char(s.end_date, 'YYYY-MM-DD') as s_end_date, m.*
         from doses d join schedules s on s.id = d.schedule_id join medicines m on m.id = s.medicine_id
        where d.call_group_id = $1 order by d.due_at, m.created_at`, [groupId]);
    return rows.map((r) => ({
      dose: mapDose({
        id: r.d_id, schedule_id: r.d_schedule_id, person_id: r.d_person_id, due_at: r.d_due_at, status: r.d_status,
        confirmed_at: r.d_confirmed_at, confirmed_via: r.d_confirmed_via, call_group_id: r.d_call_group_id,
      }),
      schedule: mapSchedulePrefixed(r),
      medicine: mapMedicine(r),
    }));
  }
  async confirmGroup(groupId: string, via: 'key' | 'speech', at: Date) {
    const rows = await this.q(
      `update doses set status = 'confirmed', confirmed_at = $3, confirmed_via = $2
        where call_group_id = $1 and status in ('upcoming', 'calling') returning id`, [groupId, via, at]);
    return rows.length;
  }
  async closeGroup(groupId: string, to: 'missed' | 'skipped_paused') {
    const rows = await this.q(
      `update doses set status = $2 where call_group_id = $1 and status in ('upcoming', 'calling') returning id`, [groupId, to]);
    return rows.length;
  }
  async listUpcomingDoses(personId: string, from: Date) {
    return (await this.q(
      `select * from doses where person_id = $1 and status = 'upcoming' and due_at >= $2 order by due_at`, [personId, from])).map(mapDose);
  }
  async insertCall(row: NewCall, at: Date) {
    const [r] = await this.q(
      `insert into calls (person_id, purpose, call_group_id, attempt, provider, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [row.personId, row.purpose, row.callGroupId, row.attempt, row.provider, row.status, at]);
    return mapCall(r!);
  }
  async getCall(id: string) {
    const [r] = await this.q(`select * from calls where id = $1 ${this.inTx ? 'for update' : ''}`, [id]);
    return r ? mapCall(r) : null;
  }
  async updateCall(id: string, patch: CallPatch) {
    const cols: Record<keyof CallPatch, string> = {
      providerCallId: 'provider_call_id', status: 'status', result: 'result', inputKind: 'input_kind',
      inputValue: 'input_value', startedAt: 'started_at', endedAt: 'ended_at',
    };
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${cols[k as keyof CallPatch]} = $${params.length}`);
    }
    if (sets.length === 0) return;
    await this.q(`update calls set ${sets.join(', ')} where id = $1`, params);
  }
  async listCallsForGroup(groupId: string) {
    return (await this.q(`select * from calls where call_group_id = $1 order by created_at, attempt`, [groupId])).map(mapCall);
  }
  async listCallsForPerson(personId: string, purpose: CallRow['purpose']) {
    return (await this.q(`select * from calls where person_id = $1 and purpose = $2 order by created_at`, [personId, purpose])).map(mapCall);
  }
  async countCallsToPhoneSince(phone: string, since: Date) {
    const [r] = await this.q(
      `select count(*)::int as n from calls c join people p on p.id = c.person_id
        where p.phone_e164 = $1 and c.created_at >= $2
          and not (c.status = 'failed' and c.provider_call_id is null)`, [phone, since]);
    return r!.n as number;
  }
  async answeredRemindersBetween(personId: string, from: Date, to: Date, excludeGroupId: string | null) {
    const calls = await this.q(
      `select distinct call_group_id from calls
        where person_id = $1 and purpose = 'reminder' and started_at is not null
          and created_at >= $2 and created_at < $3 and call_group_id is distinct from $4`,
      [personId, from, to, excludeGroupId]);
    const [count] = await this.q(
      `select count(*)::int as n from calls
        where person_id = $1 and purpose = 'reminder' and started_at is not null
          and created_at >= $2 and created_at < $3 and call_group_id is distinct from $4`,
      [personId, from, to, excludeGroupId]);
    const groups = calls.map((r) => r.call_group_id).filter(Boolean);
    const meds = groups.length === 0 ? [] : await this.q(
      `select distinct s.medicine_id from doses d join schedules s on s.id = d.schedule_id where d.call_group_id = any($1::uuid[])`,
      [groups]);
    return { answeredCalls: count!.n as number, medicineIds: meds.map((r) => r.medicine_id as string) };
  }
  async recordWebhookEvent(provider: string, eventId: string, at: Date) {
    const rows = await this.q(
      `insert into webhook_events (provider, event_id, received_at) values ($1, $2, $3) on conflict do nothing returning event_id`,
      [provider, eventId, at]);
    return rows.length > 0;
  }
}

function mapPerson(r: Row): PersonRow {
  return {
    id: r.id, ownerUserId: r.owner_user_id, isSelf: r.is_self, nickname: r.nickname, fullName: r.full_name,
    phone: r.phone_e164, language: r.language, timeZone: r.time_zone, canReadStrip: r.can_read_strip,
    consent: r.consent, paused: r.paused, deleted: r.deleted_at !== null,
  };
}

function mapMedicine(r: Row): MedicineRow {
  return {
    id: r.id, personId: r.person_id, kind: r.kind, stripName: r.strip_name, strengthText: r.strength_text,
    spokenName: r.spoken_name, colourPrimary: r.colour_primary, colourSecondary: r.colour_secondary, shape: r.shape,
    size: r.size, marking: r.marking, keptIn: r.kept_in, packColour: r.pack_colour, printColour: r.print_colour,
    capColour: r.cap_colour, numberLabel: r.number_label, sayPrintedName: r.say_printed_name,
    extraInstruction: r.extra_instruction, active: r.active,
  };
}

function mapSchedulePrefixed(r: Row): ScheduleRow {
  return {
    id: r.s_id, medicineId: r.s_medicine_id, localTime: r.s_local_time, amountText: r.s_amount_text, food: r.s_food,
    daysOfWeek: (r.s_days_of_week as number[]).map(Number), startDate: r.s_start_date, endDate: r.s_end_date,
  };
}

function mapDose(r: Row): DoseRow {
  return {
    id: r.id, scheduleId: r.schedule_id, personId: r.person_id, dueAt: new Date(r.due_at), status: r.status,
    confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : null, confirmedVia: r.confirmed_via, callGroupId: r.call_group_id,
  };
}

function mapCall(r: Row): CallRow {
  return {
    id: r.id, personId: r.person_id, purpose: r.purpose, callGroupId: r.call_group_id, attempt: r.attempt,
    provider: r.provider, providerCallId: r.provider_call_id, status: r.status, result: r.result,
    inputKind: r.input_kind, inputValue: r.input_value, startedAt: r.started_at ? new Date(r.started_at) : null,
    endedAt: r.ended_at ? new Date(r.ended_at) : null, createdAt: new Date(r.created_at),
  };
}
