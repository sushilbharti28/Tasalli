/**
 * PgStore against real Postgres (v1.7 queries). Uses a throwaway schema built from packages/contracts/schema.sql.
 * Runs when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgStore } from '../src/store/postgres.js';

const url = process.env.TEST_DATABASE_URL;
const schemaSql = readFileSync(fileURLToPath(new URL('../../../packages/contracts/schema.sql', import.meta.url)), 'utf8');
const SCHEMA = `ce_store_${process.pid}`;

describe.skipIf(!url)('PgStore (Postgres)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let store: PgStore;
  const id: Record<string, string> = {};
  const T = (iso: string) => new Date(iso);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`);
    await admin.query(`set search_path to ${SCHEMA}, public`);
    await admin.query(schemaSql);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${SCHEMA},public` });
    store = new PgStore(pool);
    const one = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0].id as string;
    id.user = await one(`insert into users (phone_e164) values ('+919999966601') returning id`, []);
    // Two parents sharing one landline (the cap and the reserve are per number).
    id.mom = await one(`insert into people (owner_user_id, is_self, nickname, full_name, phone_e164, language, time_zone, consent)
      values ($1, false, 'Mummy', 'Kamla Devi', '+919999966602', 'hi', 'Asia/Kolkata', 'consented') returning id`, [id.user]);
    id.dad = await one(`insert into people (owner_user_id, is_self, nickname, full_name, phone_e164, language, time_zone, consent)
      values ($1, false, 'Papa', 'Ramesh Sharma', '+919999966602', 'hi', 'Asia/Kolkata', 'consented') returning id`, [id.user]);
    const med = (p: string) => one(`insert into medicines (person_id, created_by_user_id, kind, strip_name, spoken_name) values ($1, $2, 'tablet', 'X', 'x') returning id`, [p, id.user]);
    const sched = (m: string, food: string) => one(`insert into schedules (medicine_id, local_time, amount_text, food, start_date) values ($1, '09:00', '1', $2, '2026-01-01') returning id`, [m, food]);
    id.sMomAfter = await sched(await med(id.mom), 'after');
    id.sMomBefore = await sched(await med(id.mom), 'before');
    id.sDad = await sched(await med(id.dad), 'after');
    const dose = (s: string, p: string, at: string, status = 'upcoming', group: string | null = null) =>
      one(`insert into doses (schedule_id, person_id, due_at, status, call_group_id) values ($1, $2, $3, $4, $5) returning id`, [s, p, at, status, group]);
    // Mom: 13:00 after + 13:10 after (same 30-minute window and food: one slot), 13:05 before (another slot), 20:00 after.
    await dose(id.sMomAfter, id.mom, '2026-03-10T07:30:00Z');
    await dose(id.sMomAfter, id.mom, '2026-03-10T07:40:00Z');
    await dose(id.sMomBefore, id.mom, '2026-03-10T07:35:00Z');
    await dose(id.sMomAfter, id.mom, '2026-03-10T14:30:00Z');
    // Dad, same number: 20:00 (own slot). A grouped dose and a confirmed one never count.
    await dose(id.sDad, id.dad, '2026-03-10T14:30:00Z');
    id.grouped = await dose(id.sDad, id.dad, '2026-03-10T03:30:00Z', 'calling', '11111111-1111-1111-1111-111111111111');
    await dose(id.sDad, id.dad, '2026-03-10T16:00:00Z', 'confirmed');
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => undefined);
    await admin?.end();
  });

  it('countUpcomingSlotsForPhone: distinct 30-minute windows and food timings, across people on the number', async () => {
    // mom 13:00 after (2 doses, 1 slot) + mom 13:05 before + mom 20:00 + dad 20:00 = 4
    expect(await store.countUpcomingSlotsForPhone('+919999966602', T('2026-03-10T06:00:00Z'), T('2026-03-10T18:30:00Z'))).toBe(4);
    expect(await store.countUpcomingSlotsForPhone('+919999966602', T('2026-03-10T08:00:00Z'), T('2026-03-10T18:30:00Z'))).toBe(2);
    expect(await store.countUpcomingSlotsForPhone('+910000000000', T('2026-03-10T00:00:00Z'), T('2026-03-11T00:00:00Z'))).toBe(0);
  });

  it('live, stale and time-bounded calls; orphan groups', async () => {
    const live = await store.insertCall({ personId: id.dad!, purpose: 'reminder', callGroupId: '11111111-1111-1111-1111-111111111111', attempt: 0, provider: 'fake', status: 'queued' }, T('2026-03-10T03:30:00Z'));
    const ended = await store.insertCall({ personId: id.dad!, purpose: 'reminder', callGroupId: null, attempt: 0, provider: 'fake', status: 'queued' }, T('2026-03-10T03:31:00Z'));
    await store.updateCall(ended.id, { status: 'completed', endedAt: T('2026-03-10T03:33:00Z') });
    expect(await store.countLiveCalls(T('2026-03-10T03:20:00Z'))).toBe(1);
    expect(await store.countLiveCalls(T('2026-03-10T03:40:00Z'))).toBe(0);
    expect((await store.listStaleCalls(T('2026-03-10T03:45:00Z'))).map((c) => c.id)).toEqual([live.id]);
    expect((await store.listCallsForPerson(id.dad!, 'reminder', T('2026-03-10T03:30:30Z'))).map((c) => c.id)).toEqual([ended.id]);
    expect(await store.listCallsForPerson(id.dad!, 'reminder')).toHaveLength(2);
    // The grouped dose has a call, so it is not an orphan; a calling dose of a group without calls is.
    expect(await store.listOrphanGroups(T('2026-03-10T04:00:00Z'))).toEqual([]);
    await pool.query(`update doses set call_group_id = '22222222-2222-2222-2222-222222222222' where id = $1`, [id.grouped]);
    expect(await store.listOrphanGroups(T('2026-03-10T04:00:00Z'))).toEqual(['22222222-2222-2222-2222-222222222222']);
  });
});
