import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetPools } from '@/lib/db';
import { getOpsMetrics } from '@/lib/ops-metrics';
import { reseed, testDbUrl } from './db-helpers';

// Own data in January 2027, far from the shared fixtures (November 2026), so the window holds only these rows.
const NOW = new Date('2027-01-10T12:00:00Z');

beforeAll(async () => {
  await reseed();
  const c = new Client({ connectionString: testDbUrl() });
  await c.connect();
  try {
    const one = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0].id as string;
    const user = await one(`insert into users (phone_e164) values ('+919999977701') returning id`);
    const person = await one(`insert into people (owner_user_id, is_self, nickname, full_name, phone_e164, language, time_zone, consent)
      values ($1, false, 'Papa', 'Ramesh Sharma', '+919999977702', 'hi', 'Asia/Kolkata', 'consented') returning id`, [user]);
    const med = await one(`insert into medicines (person_id, created_by_user_id, kind, strip_name, spoken_name) values ($1, $2, 'tablet', 'X', 'x') returning id`, [person, user]);
    const sched = await one(`insert into schedules (medicine_id, local_time, amount_text, food, start_date) values ($1, '09:00', '1', 'after', '2026-12-01') returning id`, [med]);
    const g1 = '11111111-0000-0000-0000-000000000001';
    const g2 = '11111111-0000-0000-0000-000000000002';
    const dose = (due: string, status: string, group: string | null) =>
      c.query(`insert into doses (schedule_id, person_id, due_at, status, call_group_id) values ($1, $2, $3, $4, $5)`, [sched, person, due, status, group]);
    // Day 1: dose 09:00 IST confirmed, first call 1 minute late. Day 2: missed after a call 3 minutes late (+2 retries).
    // Day 3: missed without any call (engine down).
    await dose('2027-01-08T03:30:00Z', 'confirmed', g1);
    await dose('2027-01-09T03:30:00Z', 'missed', g2);
    await dose('2027-01-10T03:30:00Z', 'missed', null);
    const call = (at: string, group: string, attempt: number, ended: string | null) =>
      c.query(`insert into calls (person_id, purpose, call_group_id, attempt, provider, status, created_at, ended_at, provider_call_id)
        values ($1, 'reminder', $2, $3, 'twilio', 'completed', $4, $5, gen_random_uuid()::text)`, [person, group, attempt, at, ended]);
    await call('2027-01-08T03:31:00Z', g1, 0, '2027-01-08T03:33:00Z');
    await call('2027-01-09T03:33:00Z', g2, 0, '2027-01-09T03:35:00Z');
    await call('2027-01-09T03:43:00Z', g2, 1, '2027-01-09T03:45:00Z');
    await call('2027-01-09T03:53:00Z', g2, 2, null); // no final status: stuck
    // A number that hit the cap: 6 calls on 2027-01-09 IST (the 3 above + 3 more).
    for (const m of ['05', '15', '25']) await call(`2027-01-09T06:${m}:00Z`, g2, 2, `2027-01-09T06:${m}:30Z`);
  } finally {
    await c.end();
  }
});
afterAll(resetPools);

describe('getOpsMetrics (call operations, scaling triggers)', () => {
  it('dial lag, unanswered, missed without a call, cap, stuck calls and calls per parent', async () => {
    const m = await getOpsMetrics({ now: NOW, days: 7 });
    expect(m.dialLagMinutes.calls).toBe(2); // first calls only
    expect(m.dialLagMinutes.p50).toBe(2); // 1 and 3 minutes
    expect(m.dialLagMinutes.p95).toBe(2.9);
    expect(m.unansweredAfterRetries).toEqual({ missed: 1, ended: 3, rate: 1 / 3 });
    expect(m.missedWithoutCall).toBe(1);
    expect(m.numbersAtDailyCap).toBe(1);
    // "Stuck now" is not windowed: every call still open 15+ minutes after dialling counts (the shared fixtures have some too).
    const c = new Client({ connectionString: testDbUrl() });
    await c.connect();
    const open = (await c.query(`select count(*)::int as n from calls where ended_at is null and created_at < $1::timestamptz - interval '15 minutes'`, [NOW])).rows[0].n;
    await c.end();
    expect(m.stuckCallsNow).toBe(open);
    expect(open).toBeGreaterThanOrEqual(1);
    expect(m.busiestFiveMinutes).toBe(1);
    expect(m.callsPerParentPerDay).toBe(1); // 7 calls / 1 parent / 7 days
  });
});
