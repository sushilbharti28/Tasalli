import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetPools } from '@/lib/db';
import { getPilotMetrics } from '@/lib/metrics';
import { NOW } from './fixtures';
import { reseed } from './db-helpers';

beforeAll(reseed);
afterAll(resetPools);

describe('getPilotMetrics (30 days to 2026-11-15 12:00 UTC)', () => {
  it('computes the pilot measures from fixture data', async () => {
    const m = await getPilotMetrics({ now: NOW, days: 30 });

    // 4 live accounts (deleted one excluded); u1 and u4 have a consented person with a scheduled medicine.
    expect(m.setupCompletion).toEqual({ numerator: 2, denominator: 4, rate: 0.5 });

    // 5 final doses in window: 2 key/speech + 1 key (p4) by parent, 1 manual, 1 missed.
    expect(m.confirmation).toMatchObject({ numerator: 3, denominator: 5, rate: 0.6, manual: 1, missed: 1 });

    // Trials ended: u1, u2, u4. Paid: u1, u4. u5's trial is still running.
    expect(m.trialToPaid.numerator).toBe(2);
    expect(m.trialToPaid.denominator).toBe(3);

    // Only u1's first payment is 2+ months old, and u1 still pays.
    expect(m.month3Retention).toEqual({ numerator: 1, denominator: 1, rate: 1 });

    // Calls with an outcome in window: c1 c2 c3 c4 c5 c7 (c8 queued). One failed.
    expect(m.failedCalls.numerator).toBe(1);
    expect(m.failedCalls.denominator).toBe(6);

    // 7 reminder attempts (incl. retries and the queued one) over 5 final doses.
    expect(m.callsPerDose).toEqual({ calls: 7, doses: 5, value: 1.4 });
  });

  it('builds daily series in IST with one point per day', async () => {
    const m = await getPilotMetrics({ now: NOW, days: 7 });
    expect(m.confirmationDaily.map((p) => p.day)).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
    const byDay = Object.fromEntries(m.confirmationDaily.map((p) => [p.day, p]));
    expect(byDay['2026-11-14']).toMatchObject({ numerator: 2, denominator: 2, rate: 1 });
    expect(byDay['2026-11-13']).toMatchObject({ numerator: 0, denominator: 2, rate: 0 });
    expect(byDay['2026-11-12'].rate).toBeNull();
    // 2026-11-10 14:30 UTC is 20:00 IST the same day.
    expect(byDay['2026-11-10']).toMatchObject({ numerator: 1, denominator: 1 });

    const failed = Object.fromEntries(m.failedCallsDaily.map((p) => [p.day, p]));
    expect(failed['2026-11-13']).toMatchObject({ numerator: 1, denominator: 3 });
  });

  it('computes month-over-month retention of paying families', async () => {
    const m = await getPilotMetrics({ now: NOW, days: 30 });
    expect(m.retentionMonthly.map((p) => [p.month, p.paying, p.previousPaying, p.retainedFromPrevious, p.rate])).toEqual([
      ['2026-06', 1, 0, 0, null],
      ['2026-07', 1, 1, 1, 1],
      ['2026-08', 1, 1, 1, 1],
      ['2026-09', 1, 1, 1, 1],
      ['2026-10', 2, 1, 1, 1],
      ['2026-11', 1, 2, 1, 0.5],
    ]);
  });

  it('returns null rates, not NaN, on an empty window', async () => {
    const m = await getPilotMetrics({ now: new Date('2026-01-01T00:00:00Z'), days: 7 });
    expect(m.confirmation.rate).toBeNull();
    expect(m.failedCalls.rate).toBeNull();
    expect(m.callsPerDose.value).toBeNull();
    expect(m.setupCompletion.denominator).toBe(0);
  });
});
