import type { Pool } from 'pg';
import { getReadPool } from './db';

/**
 * Call operations: the numbers that say when to scale (docs/architecture.md, section 3 and 4.0).
 * Each has a threshold; crossing it triggers the mitigation already planned for it.
 */
export interface OpsMetrics {
  now: Date;
  days: number;
  /** Minutes from the dose time to dialling the first call of its group (median, 95th percentile). */
  dialLagMinutes: { p50: number | null; p95: number | null; calls: number };
  /** Most reminder calls started in any 5-minute window (a proxy for peak concurrent calls). */
  busiestFiveMinutes: number;
  /** Doses that ended missed after being called (no "haan" through all retries), over doses that ended. */
  unansweredAfterRetries: { missed: number; ended: number; rate: number | null };
  /** Doses missed without any call (engine down, or retries cut by the daily cap). */
  missedWithoutCall: number;
  /** Phone numbers that reached 6 calls on an IST day. */
  numbersAtDailyCap: number;
  /** Calls with no final status 15+ minutes after dialling, right now (the sweeper should leave none). */
  stuckCallsNow: number;
  /** Reminder calls per parent per day (parents with doses in the window). */
  callsPerParentPerDay: number | null;
}

export const OPS_THRESHOLDS = {
  dialLagP95Minutes: 2,
  unansweredRate: 0.1,
  missedWithoutCall: 0,
  numbersAtDailyCap: 0,
  stuckCallsNow: 0,
};

const TZ = 'Asia/Kolkata';

export async function getOpsMetrics(opts: { now?: Date; days?: number; db?: Pool } = {}): Promise<OpsMetrics> {
  const db = opts.db ?? getReadPool();
  const now = opts.now ?? new Date();
  const days = Math.min(Math.max(Math.round(opts.days ?? 30), 1), 365);
  const args = [now, days];
  const inWindow = (col: string) => `${col} >= $1::timestamptz - make_interval(days => $2::int) and ${col} < $1::timestamptz`;

  const [lag, busiest, doses, cap, stuck, perParent] = await Promise.all([
    // First call of each group (attempt 0 = cycle 0, first try) against the earliest dose time in the group.
    db.query<{ p50: number | null; p95: number | null; n: number }>(
      `with g as (
         select c.created_at, min(d.due_at) as due
           from calls c join doses d on d.call_group_id = c.call_group_id
          where c.purpose = 'reminder' and c.attempt = 0 and ${inWindow('c.created_at')}
          group by c.id, c.created_at)
       select percentile_cont(0.5) within group (order by extract(epoch from (created_at - due)) / 60) as p50,
              percentile_cont(0.95) within group (order by extract(epoch from (created_at - due)) / 60) as p95,
              count(*)::int as n
         from g`,
      args,
    ),
    db.query<{ n: number }>(
      `select coalesce(max(n), 0)::int as n from (
         select count(*) as n from calls
          where purpose = 'reminder' and ${inWindow('created_at')}
          group by floor(extract(epoch from created_at) / 300)) x`,
      args,
    ),
    db.query<{ missed_called: number; missed_uncalled: number; ended: number }>(
      `select count(*) filter (where status = 'missed' and call_group_id is not null)::int as missed_called,
              count(*) filter (where status = 'missed' and call_group_id is null)::int as missed_uncalled,
              count(*) filter (where status in ('confirmed', 'missed'))::int as ended
         from doses where ${inWindow('due_at')}`,
      args,
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from (
         select p.phone_e164, (c.created_at at time zone '${TZ}')::date as day
           from calls c join people p on p.id = c.person_id
          where c.purpose <> 'test' and ${inWindow('c.created_at')}
            and not (c.status = 'failed' and c.provider_call_id is null)
          group by 1, 2 having count(*) >= 6) x`,
      args,
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from calls where ended_at is null and created_at < $1::timestamptz - interval '15 minutes'`,
      [now],
    ),
    db.query<{ calls: number; parents: number }>(
      `select (select count(*) from calls where purpose = 'reminder' and ${inWindow('created_at')})::int as calls,
              (select count(distinct person_id) from doses where ${inWindow('due_at')})::int as parents`,
      args,
    ),
  ]);

  const round1 = (v: number | null) => (v === null ? null : Math.round(Number(v) * 10) / 10);
  const d = doses.rows[0]!;
  const pp = perParent.rows[0]!;
  return {
    now,
    days,
    dialLagMinutes: { p50: round1(lag.rows[0]!.p50), p95: round1(lag.rows[0]!.p95), calls: lag.rows[0]!.n },
    busiestFiveMinutes: busiest.rows[0]!.n,
    unansweredAfterRetries: { missed: d.missed_called, ended: d.ended, rate: d.ended > 0 ? d.missed_called / d.ended : null },
    missedWithoutCall: d.missed_uncalled,
    numbersAtDailyCap: cap.rows[0]!.n,
    stuckCallsNow: stuck.rows[0]!.n,
    callsPerParentPerDay: pp.parents > 0 ? Math.round((pp.calls / pp.parents / days) * 100) / 100 : null,
  };
}
