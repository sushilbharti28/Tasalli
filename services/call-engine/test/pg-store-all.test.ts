/**
 * Every PgStore method once, against real Postgres, in the order a real day uses them.
 * Added after a live consent call failed: setPersonConsent compared an enum parameter with text
 * ("inconsistent types deduced for parameter $2"), which the in-memory store used by the other tests cannot catch.
 * Runs when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgStore } from '../src/store/postgres.js';

const url = process.env.TEST_DATABASE_URL;
const schemaSql = readFileSync(fileURLToPath(new URL('../../../packages/contracts/schema.sql', import.meta.url)), 'utf8');
const SCHEMA = `ce_all_${process.pid}`;
const PHONE = '+919999988801';

describe.skipIf(!url)('PgStore: every method against Postgres', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let store: PgStore;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`);
    await admin.query(`set search_path to ${SCHEMA}, public`);
    await admin.query(schemaSql);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${SCHEMA},public` });
    store = new PgStore(pool);
    const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0].id as string;
    id.user = await one(`insert into users (phone_e164, name) values ('+919999988800', 'Rahul') returning id`);
    await pool.query(`insert into subscriptions (user_id, plan, status) values ($1, 'trial', 'trialing')`, [id.user]).catch(() => undefined);
    id.person = await one(`insert into people (owner_user_id, is_self, nickname, full_name, phone_e164, language, time_zone)
      values ($1, false, 'Papa', 'Ramesh Sharma', $2, 'hi', 'Asia/Kolkata') returning id`, [id.user, PHONE]);
    id.med = await one(`insert into medicines (person_id, created_by_user_id, kind, strip_name, spoken_name) values ($1, $2, 'tablet', 'Telma 40', 'BP wali') returning id`, [id.person, id.user]);
    id.sched = await one(`insert into schedules (medicine_id, local_time, amount_text, food, start_date) values ($1, '09:00', '1 goli', 'after', '2026-01-01') returning id`, [id.med]);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => undefined);
    await admin?.end();
  });

  it('consent: every state, events and the global block', async () => {
    for (const state of ['declined', 'pending', 'consented'] as const) {
      await store.setPersonConsent(id.person!, state, new Date('2026-03-10T03:00:00Z'));
      expect((await store.getPerson(id.person!))!.consent).toBe(state);
    }
    for (const result of ['consented', 'declined', 'no_answer', 'opted_out'] as const) {
      await store.insertConsentEvent({ personId: id.person!, result, via: 'key', callId: null });
    }
    expect((await pool.query(`select count(*)::int as n from consent_events`)).rows[0].n).toBe(4);
    expect(await store.getUser(id.user!)).toMatchObject({ name: 'Rahul' });
    await store.listSubscriptions(id.user!);
    expect((await store.listPeopleByPhone(PHONE)).map((p) => p.id)).toEqual([id.person]);
    expect((await store.listSchedulablePeople()).map((p) => p.id)).toEqual([id.person]);
    expect(await store.isBlocked(PHONE)).toBe(false);
  });

  it('schedules, doses, grouping, confirming and closing', async () => {
    expect((await store.listActiveSchedules(id.person!))[0]!.medicine.spokenName).toBe('BP wali');
    expect((await store.getSchedule(id.sched!))!.food).toBe('after');
    expect((await store.getMedicine(id.med!))!.stripName).toBe('Telma 40');
    const at = (iso: string) => new Date(iso);
    await store.insertDoses([1, 2, 3, 4, 5].map((d) => ({ scheduleId: id.sched!, personId: id.person!, dueAt: at(`2026-03-1${d}T03:30:00Z`) })));
    await store.insertDoses([{ scheduleId: id.sched!, personId: id.person!, dueAt: at('2026-03-11T03:30:00Z') }]); // duplicate ignored
    const doses = await store.listDoses(id.person!, at('2026-03-10T00:00:00Z'), at('2026-03-20T00:00:00Z'));
    expect(doses).toHaveLength(5);
    const [d1, d2, d3, d4, d5] = doses.map((d) => d.id);
    expect((await store.getDose(d1!))!.status).toBe('upcoming');
    expect(await store.listUpcomingDoses(id.person!, at('2026-03-10T00:00:00Z'))).toHaveLength(5);
    const g = '33333333-3333-3333-3333-333333333333';
    await store.transaction(async (tx) => { await tx.lockPhone(PHONE); await tx.lockPerson(id.person!); await tx.assignGroup([d1!, d2!], g); });
    expect((await store.getGroupDetails(g)).map((x) => x.medicine.spokenName)).toEqual(['BP wali', 'BP wali']);
    expect(await store.confirmDoses([d1!], 'speech', at('2026-03-11T03:31:00Z'))).toBe(1);
    expect(await store.confirmGroup(g, 'key', at('2026-03-11T03:32:00Z'))).toBe(1);
    expect(await store.setDoseStatus([d3!], ['upcoming'], 'missed')).toBe(1);
    expect(await store.regroupDose(d3!, '44444444-4444-4444-4444-444444444444')).toBe(true);
    expect(await store.closeGroup('44444444-4444-4444-4444-444444444444', 'missed')).toBe(1);
    expect(await store.closeDoses([d4!], 'skipped_paused')).toBe(1);
    expect((await store.getDose(d5!))!.status).toBe('upcoming');
  });

  it('calls: insert, every patch field, lookups, counts, answered reminders, webhook dedupe', async () => {
    const g = '33333333-3333-3333-3333-333333333333';
    const t0 = new Date('2026-03-11T03:30:00Z');
    const call = await store.insertCall({ personId: id.person!, purpose: 'reminder', callGroupId: g, attempt: 0, provider: 'twilio', status: 'queued' }, t0);
    await store.updateCall(call.id, { providerCallId: 'CA123', status: 'completed', result: 'confirmed', inputKind: 'key', inputValue: '1',
      startedAt: new Date('2026-03-11T03:30:10Z'), endedAt: new Date('2026-03-11T03:31:00Z'), recordingUrl: 'local://x.mp3' });
    expect(await store.getCall(call.id)).toMatchObject({ providerCallId: 'CA123', status: 'completed', result: 'confirmed', inputKind: 'key' });
    expect((await store.getCallByProviderCallId('CA123'))!.id).toBe(call.id);
    expect(await store.listCallsForGroup(g)).toHaveLength(1);
    expect(await store.listCallsForPerson(id.person!, 'reminder')).toHaveLength(1);
    expect(await store.countCallsToPhoneSince(PHONE, new Date('2026-03-10T18:30:00Z'))).toBe(1);
    const answered = await store.answeredRemindersBetween(id.person!, new Date('2026-03-10T18:30:00Z'), new Date('2026-03-11T18:30:00Z'), null);
    expect(answered.answeredCalls).toBe(1);
    expect(await store.recordWebhookEvent('twilio', 'ev-1', t0)).toBe(true);
    expect(await store.recordWebhookEvent('twilio', 'ev-1', t0)).toBe(false); // rule 6
    for (const reason of ['key_9', 'stop_phrase', 'declined', 'admin'] as const) {
      await store.blockNumber(`+91999998880${['key_9', 'stop_phrase', 'declined', 'admin'].indexOf(reason) + 2}`, reason);
    }
    expect(await store.blockNumber(PHONE, 'key_9')).toBe(true);
    expect(await store.blockNumber(PHONE, 'key_9')).toBe(false);
    expect(await store.isBlocked(PHONE)).toBe(true);
  });
});
