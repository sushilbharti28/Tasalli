import { describe, expect, it } from 'vitest';
import { PARENT, world, type World } from './helpers.js';
import { acquireDialSlot, sweep } from '../src/engine/dispatch.js';
import { defaultConfig, type Deps } from '../src/engine/deps.js';
import { FakeClock, MINUTE } from '../src/clock.js';

const planned = async (w: World) => { await w.queue.add('schedule.replan', { personId: w.mom.id }); await w.settle(); };
const statuses = (w: World) => w.store.allDoses().sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()).map((d) => d.status);
const noAnswer = { answer: 'no_answer' as const };

describe('v1.7 A: the 6/day cap protects first calls (founder decision 25 Nov 2026)', () => {
  it('a parent who never answers: morning and afternoon retries are cut so the evening dose is still called', async () => {
    const w = world('2026-03-10T03:29:00Z'); // 08:59 IST
    w.med('Morning', '09:00');
    w.med('Afternoon', '13:00');
    w.med('Evening', '20:00');
    w.provider.script(PARENT, ...Array.from({ length: 10 }, () => noAnswer));
    await planned(w);
    await w.advance(12 * 60); // to 20:59
    const calls = w.store.allCalls().filter((c) => c.purpose === 'reminder').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(calls).toHaveLength(6); // never more than the cap
    const ist = (d: Date) => new Date(d.getTime() + 330 * MINUTE).toISOString().slice(11, 16);
    // 09:00 + 2 retries, 13:00 + 1 retry (the second would leave no call for 20:00), 20:00.
    expect(calls.map((c) => ist(c.createdAt))).toEqual(['09:00', '09:10', '09:20', '13:00', '13:10', '20:00']);
    expect(w.queue.alerts.map((a) => a.job.reason)).toContain('daily_cap'); // the afternoon dose: retries cut, family told
  });

  it('first calls are never reserved against: a normal day is unchanged', async () => {
    const w = world('2026-03-10T03:29:00Z');
    w.med('Morning', '09:00');
    w.med('Evening', '20:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(12 * 60);
    expect(statuses(w).slice(0, 2)).toEqual(['confirmed', 'confirmed']);
  });
});

describe('v1.7 B and F: late doses (engine down vs busy) and one outage alert', () => {
  it('engine down at the dose time: doses are missed, the family gets ONE alert listing them (service_outage)', async () => {
    const w = world('2026-03-10T03:29:00Z');
    w.med('Amlodac', '09:00');
    w.med('Telma', '09:05');
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.queue.runDue();
    w.clock.set('2026-03-10T05:30:00Z'); // 11:00 IST; no heartbeat was recorded: the engine was down
    await w.settle();
    await w.advance(3);
    expect(w.provider.callsTo(PARENT)).toHaveLength(0);
    expect(statuses(w).slice(0, 2)).toEqual(['missed', 'missed']);
    const outage = w.queue.alerts.filter((a) => a.job.reason === 'service_outage');
    expect(outage).toHaveLength(1);
    expect(outage[0]!.job.doseIds).toHaveLength(2);
  });

  it('engine up but busy (heartbeat at the dose time): the late dose is still called, up to 90 minutes late', async () => {
    const w = world('2026-03-10T03:29:00Z');
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.queue.runDue();
    w.clock.set('2026-03-10T03:30:30Z');
    await w.engine.heartbeat(); // alive at 09:00
    w.clock.set('2026-03-10T04:15:00Z'); // 09:45 IST: 45 minutes late
    await w.settle();
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    expect(statuses(w)[0]).toBe('confirmed');
  });

  it('busy for longer than 90 minutes: treated as missed after all', async () => {
    const w = world('2026-03-10T03:29:00Z');
    w.med('Amlodac', '09:00');
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.queue.runDue();
    w.clock.set('2026-03-10T03:30:30Z');
    await w.engine.heartbeat();
    w.clock.set('2026-03-10T05:15:00Z'); // 10:45 IST: 105 minutes late
    await w.settle();
    expect(w.provider.callsTo(PARENT)).toHaveLength(0);
    expect(statuses(w)[0]).toBe('missed');
  });
});

describe('v1.7 C: dial limiter', () => {
  const fake = (live: number[]) => {
    const clock = new FakeClock('2026-03-10T03:30:00Z');
    let i = 0;
    const d = {
      clock, log: { info() {}, warn() {}, error() {} },
      store: { countLiveCalls: async () => live[Math.min(i++, live.length - 1)]! },
      sleep: async (ms: number) => { clock.advance(ms); },
      config: defaultConfig({ maxCallsPerSecond: 2, maxConcurrentCalls: 3, dialWaitMaxMs: 60_000 }),
    } as unknown as Deps;
    return d;
  };
  it('at most maxCallsPerSecond dials in any second', async () => {
    const d = fake([0]);
    expect((await acquireDialSlot(d)).waitedMs).toBe(0);
    expect((await acquireDialSlot(d)).waitedMs).toBe(0);
    expect((await acquireDialSlot(d)).waitedMs).toBeGreaterThanOrEqual(1000); // third call waits for the next second
  });
  it('waits while maxConcurrentCalls calls are live, then dials', async () => {
    const d = fake([3, 3, 2]);
    expect((await acquireDialSlot(d)).waitedMs).toBe(2000);
  });
  it('never drops a call: after dialWaitMaxMs it dials anyway', async () => {
    const d = fake([99]);
    expect((await acquireDialSlot(d)).waitedMs).toBeGreaterThan(60_000);
  });
  it('the engine default is unlimited (tests and scripts); production reads MAX_CALLS_PER_SECOND / MAX_CONCURRENT_CALLS', () => {
    expect(defaultConfig().maxCallsPerSecond).toBeGreaterThan(1000);
  });
});

describe('v1.7 D: a retry takes along doses that have just come due', () => {
  it('08:00 unanswered; the 08:20 retry also covers the 08:32 dose: 3 calls, not 4', async () => {
    const w = world('2026-03-10T02:29:00Z'); // 07:59 IST
    w.med('First', '08:00');
    w.med('Second', '08:32');
    for (const s of w.store.state.schedules.values()) s.food = 'after';
    w.provider.script(PARENT, noAnswer, noAnswer, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(60);
    const calls = w.store.allCalls().filter((c) => c.purpose === 'reminder');
    expect(calls).toHaveLength(3);
    expect(w.playedText(2).join(' ')).toMatch(/Second/);
    expect(statuses(w).slice(0, 2)).toEqual(['confirmed', 'confirmed']);
  });
  it('a dose with a different food timing is not taken along', async () => {
    const w = world('2026-03-10T02:29:00Z');
    w.med('First', '08:00');
    w.med('Second', '08:32');
    const [a, b] = [...w.store.state.schedules.values()];
    a!.food = 'after';
    b!.food = 'before';
    w.provider.script(PARENT, noAnswer, noAnswer, { answer: 'answered', inputs: [{ key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(60);
    expect(w.playedText(2).join(' ')).not.toMatch(/Second/);
  });
});

describe('v1.7 E: sweeper', () => {
  it('a call with no final status after 15 minutes is closed and retried like an unanswered call', async () => {
    const w = world('2026-03-10T03:29:00Z');
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.queue.runDue();
    w.clock.set('2026-03-10T03:30:00Z');
    await w.queue.runDue(); // dose.due: call placed, but the provider never runs it (lost webhooks)
    expect(w.store.allCalls()).toHaveLength(1);
    w.clock.set('2026-03-10T03:46:00Z');
    expect(await sweep(w.engine.d)).toEqual({ staleCalls: 1, orphanGroups: 0 });
    expect(w.store.allCalls()[0]!.endedAt).not.toBeNull();
    expect(w.queue.pendingJobs().some((j) => j.name === 'reminder.retry')).toBe(true);
  });
  it('a group that was never dialled is retried', async () => {
    const w = world('2026-03-10T03:29:00Z');
    const { m } = w.med('Amlodac', '09:00');
    void m;
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.queue.runDue();
    const dose = w.store.allDoses()[0]!;
    await w.store.assignGroup([dose.id], 'g-orphan'); // grouped, then the process died before dialling
    w.clock.set('2026-03-10T03:46:00Z');
    expect(await sweep(w.engine.d)).toEqual({ staleCalls: 0, orphanGroups: 1 });
    expect(w.queue.pendingJobs().some((j) => j.name === 'reminder.retry')).toBe(true);
  });
});

describe('v1.7 G: evening summary after the last dose', () => {
  it('last dose 21:30: the summary goes at 22:30, not 20:00', async () => {
    const w = world('2026-03-10T03:29:00Z');
    w.med('Night', '21:30');
    await planned(w);
    const job = w.queue.pendingJobs().filter((j) => j.name === 'summary.evening').at(-1)!;
    const at = new Date((job.data as { at: string }).at);
    expect(new Date(at.getTime() + 330 * MINUTE).toISOString().slice(11, 16)).toBe('22:30');
  });
  it('no late doses: still 20:00; never after 23:30', async () => {
    const w = world('2026-03-10T03:29:00Z');
    w.med('Morning', '09:00');
    await planned(w);
    const job = w.queue.pendingJobs().filter((j) => j.name === 'summary.evening').at(-1)!;
    expect(new Date(new Date((job.data as { at: string }).at).getTime() + 330 * MINUTE).toISOString().slice(11, 16)).toBe('20:00');
    const late = world('2026-03-10T03:29:00Z');
    late.med('Very late', '23:15');
    await planned(late);
    const j2 = late.queue.pendingJobs().filter((j) => j.name === 'summary.evening').at(-1)!;
    expect(new Date(new Date((j2.data as { at: string }).at).getTime() + 330 * MINUTE).toISOString().slice(11, 16)).toBe('23:30');
  });
});
