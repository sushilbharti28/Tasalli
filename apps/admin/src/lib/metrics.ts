import type { Pool } from 'pg';
import { getReadPool } from './db';

/**
 * Pilot metrics (docs/scope-v1.md, "Pilot success criteria"), read-only.
 *
 * Definitions are written next to each number on the metrics page; keep them in
 * sync with the comments here. All windows are [now - days, now). Daily buckets
 * use India time (Asia/Kolkata) since the pilot is in India.
 */

export interface Ratio {
  numerator: number;
  denominator: number;
  /** null when the denominator is 0 */
  rate: number | null;
}

export interface DailyPoint {
  day: string; // YYYY-MM-DD (IST)
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface MonthPoint {
  month: string; // YYYY-MM
  paying: number;
  retainedFromPrevious: number;
  previousPaying: number;
  rate: number | null;
}

export interface PilotMetrics {
  now: Date;
  days: number;
  setupCompletion: Ratio;
  confirmation: Ratio & { manual: number; missed: number };
  confirmationDaily: DailyPoint[];
  trialToPaid: Ratio;
  retentionMonthly: MonthPoint[];
  month3Retention: Ratio;
  failedCalls: Ratio;
  failedCallsDaily: DailyPoint[];
  callsPerDose: { calls: number; doses: number; value: number | null };
}

export const TARGETS = {
  setupCompletion: 0.6,
  confirmation: 0.8,
  trialToPaid: 0.2,
  month3Retention: 0.6,
  failedCalls: 0.02,
} as const;

function ratio(n: number, d: number): Ratio {
  return { numerator: n, denominator: d, rate: d > 0 ? n / d : null };
}

const TZ = 'Asia/Kolkata';

/**
 * A paid subscription counts as "paying at time T" when it was created before T and
 * either its current period reaches T, or it has no period end yet and is active /
 * past_due. Used by both retention measures.
 */
const PAYING_AT = (t: string) => `
  s.plan <> 'trial'
  and s.created_at <= ${t}
  and (s.current_period_end >= ${t}
       or (s.current_period_end is null and s.status in ('active','past_due')))`;

export async function getPilotMetrics(opts: { now?: Date; days?: number; db?: Pool } = {}): Promise<PilotMetrics> {
  const db = opts.db ?? getReadPool();
  const now = opts.now ?? new Date();
  const days = Math.min(Math.max(Math.round(opts.days ?? 30), 1), 365);
  const args = [now, days];

  const [setup, conf, confDaily, trial, retention, month3, failed, failedDaily, cpd] = await Promise.all([
    // Setup completion: of families (not deleted) who signed up before now, those with at
    // least one consented person who has an active medicine with a schedule.
    db.query(
      `select count(*)::int as total,
              count(*) filter (where exists (
                select 1 from people p
                  join medicines m on m.person_id = p.id and m.active
                  join schedules sc on sc.medicine_id = m.id
                 where p.owner_user_id = u.id and p.deleted_at is null and p.consent = 'consented'
              ))::int as done
         from users u
        where u.deleted_at is null and u.created_at < $1::timestamptz`,
      [now],
    ),
    // Confirmation: doses due in the window that reached a final state (confirmed or missed).
    // "By the parent" = confirmed by key or speech; manual "mark as taken" is shown apart.
    db.query(
      `select count(*) filter (where status = 'confirmed' and confirmed_via in ('key','speech'))::int as parent,
              count(*) filter (where status = 'confirmed' and confirmed_via = 'manual')::int as manual,
              count(*) filter (where status = 'missed')::int as missed,
              count(*) filter (where status in ('confirmed','missed'))::int as final
         from doses
        where due_at >= $1::timestamptz - make_interval(days => $2::int) and due_at < $1::timestamptz`,
      args,
    ),
    db.query(
      `with d as (
         select generate_series(
                  (($1::timestamptz at time zone '${TZ}')::date - ($2::int - 1)),
                  ($1::timestamptz at time zone '${TZ}')::date,
                  interval '1 day')::date as day
       )
       select to_char(d.day, 'YYYY-MM-DD') as day,
              count(x.id) filter (where x.status = 'confirmed' and x.confirmed_via in ('key','speech'))::int as n,
              count(x.id) filter (where x.status in ('confirmed','missed'))::int as d
         from d
         left join doses x on (x.due_at at time zone '${TZ}')::date = d.day and x.due_at < $1::timestamptz
        group by d.day order by d.day`,
      args,
    ),
    // Trial to paid: users whose trial has ended by now; converted = has any paid plan.
    db.query(
      `select count(*)::int as ended,
              count(*) filter (where exists (
                select 1 from subscriptions s2 where s2.user_id = t.user_id and s2.plan <> 'trial'
                  and s2.created_at <= $1::timestamptz
              ))::int as paid
         from (select distinct user_id from subscriptions
                where plan = 'trial' and trial_ends_at <= $1::timestamptz) t`,
      [now],
    ),
    // Month-over-month retention for the last 6 calendar months (IST), measured at
    // month end (or now, for the current month).
    db.query(
      `with months as (
         select generate_series(
                  date_trunc('month', $1::timestamptz at time zone '${TZ}') - interval '6 months',
                  date_trunc('month', $1::timestamptz at time zone '${TZ}'),
                  interval '1 month') as m
       ),
       checkpoints as (
         select m, least(((m + interval '1 month') at time zone '${TZ}') - interval '1 second', $1::timestamptz) as t
           from months
       ),
       paying as (
         select c.m, s.user_id
           from checkpoints c
           join subscriptions s on ${PAYING_AT('c.t')}
          group by c.m, s.user_id
       )
       select to_char(c.m, 'YYYY-MM') as month,
              (select count(*) from paying p where p.m = c.m)::int as paying,
              (select count(*) from paying p where p.m = c.m - interval '1 month')::int as prev,
              (select count(*) from paying p join paying q on q.user_id = p.user_id and q.m = c.m - interval '1 month'
                where p.m = c.m)::int as retained
         from checkpoints c
        order by c.m`,
      [now],
    ),
    // Month-3 retention (pilot target): families whose first payment was at least 2 months
    // ago; retained = still paying 2 months after the first payment (i.e. in month 3).
    db.query(
      `with firsts as (
         select user_id, min(created_at) as first_paid
           from subscriptions where plan <> 'trial' and created_at <= $1::timestamptz
          group by user_id
       )
       select count(*)::int as cohort,
              count(*) filter (where exists (
                select 1 from subscriptions s where s.user_id = f.user_id
                   and ${PAYING_AT("(f.first_paid + interval '2 months')")}
              ))::int as retained
         from firsts f
        where f.first_paid + interval '2 months' <= $1::timestamptz`,
      [now],
    ),
    // Failed calls: calls placed in the window that reached an outcome; failed = provider
    // or network failure (status 'failed'). No answer / busy are not technical failures.
    db.query(
      `select count(*) filter (where status = 'failed')::int as failed,
              count(*) filter (where status not in ('queued','ringing'))::int as total
         from calls
        where created_at >= $1::timestamptz - make_interval(days => $2::int) and created_at < $1::timestamptz`,
      args,
    ),
    db.query(
      `with d as (
         select generate_series(
                  (($1::timestamptz at time zone '${TZ}')::date - ($2::int - 1)),
                  ($1::timestamptz at time zone '${TZ}')::date,
                  interval '1 day')::date as day
       )
       select to_char(d.day, 'YYYY-MM-DD') as day,
              count(c.id) filter (where c.status = 'failed')::int as n,
              count(c.id) filter (where c.status not in ('queued','ringing'))::int as d
         from d
         left join calls c on (c.created_at at time zone '${TZ}')::date = d.day and c.created_at < $1::timestamptz
        group by d.day order by d.day`,
      args,
    ),
    // Calls per dose: reminder call attempts in the window / doses due in the window that
    // reached a final state. Grouped doses share a call, so this can be below 1.
    db.query(
      `select
         (select count(*) from calls
           where purpose = 'reminder'
             and created_at >= $1::timestamptz - make_interval(days => $2::int) and created_at < $1::timestamptz)::int as calls,
         (select count(*) from doses
           where status in ('confirmed','missed')
             and due_at >= $1::timestamptz - make_interval(days => $2::int) and due_at < $1::timestamptz)::int as doses`,
      args,
    ),
  ]);

  const c = conf.rows[0];
  const daily = (rows: Array<{ day: string; n: number; d: number }>): DailyPoint[] =>
    rows.map((r) => ({ day: r.day, numerator: r.n, denominator: r.d, rate: r.d > 0 ? r.n / r.d : null }));
  const cp = cpd.rows[0];

  // Drop the first month: it only exists to give the second one a "previous".
  const monthly: MonthPoint[] = retention.rows.slice(1).map((r) => ({
    month: r.month,
    paying: r.paying,
    previousPaying: r.prev,
    retainedFromPrevious: r.retained,
    rate: r.prev > 0 ? r.retained / r.prev : null,
  }));

  return {
    now,
    days,
    setupCompletion: ratio(setup.rows[0].done, setup.rows[0].total),
    confirmation: { ...ratio(c.parent, c.final), manual: c.manual, missed: c.missed },
    confirmationDaily: daily(confDaily.rows),
    trialToPaid: ratio(trial.rows[0].paid, trial.rows[0].ended),
    retentionMonthly: monthly,
    month3Retention: ratio(month3.rows[0].retained, month3.rows[0].cohort),
    failedCalls: ratio(failed.rows[0].failed, failed.rows[0].total),
    failedCallsDaily: daily(failedDaily.rows),
    callsPerDose: { calls: cp.calls, doses: cp.doses, value: cp.doses > 0 ? cp.calls / cp.doses : null },
  };
}
