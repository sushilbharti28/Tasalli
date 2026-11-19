import { describe, expect, it } from 'vitest';
import { world } from './helpers.js';

const lapse = (w: ReturnType<typeof world>) => {
  w.store.state.subscriptions.length = 0;
  w.store.addSubscription(w.user.id, { status: 'past_due', pastDueSince: new Date('2026-03-01T00:00:00Z') });
};
const planAll = async (w: ReturnType<typeof world>, ...ids: string[]) => {
  for (const personId of ids) await w.queue.add('schedule.replan', { personId });
  await w.settle();
};

describe('plan_lapsed alert', () => {
  it('one alert with the person and the skipped dose when a reminder is skipped for billing', async () => {
    const w = world();
    lapse(w);
    w.med('Amlodac', '09:00');
    await planAll(w, w.mom.id);
    await w.advance(60);
    expect(w.provider.callsTo(w.mom.phone)).toHaveLength(0);
    expect(w.queue.alerts).toHaveLength(1);
    const { jobId, job } = w.queue.alerts[0]!;
    expect(jobId).toBe(`plan_lapsed_${w.user.id}_2026-03-10`);
    expect(job).toMatchObject({ kind: 'plan_lapsed', personId: w.mom.id, ownerUserId: w.user.id, localDate: '2026-03-10', reason: 'plan_not_entitled' });
  });

  it('two people and several doses on one day: still one alert for the owner', async () => {
    const w = world();
    lapse(w);
    const dad = w.store.addPerson({ ownerUserId: w.user.id, phone: '+919811111111', nickname: 'Papa', consent: 'consented' });
    w.med('Amlodac', '09:00');
    w.med('Metformin', '09:10', {}, dad);
    w.med('Thyronorm', '09:20'); // same group as Amlodac
    await planAll(w, w.mom.id, dad.id);
    await w.advance(120);
    expect(w.queue.alerts.filter((a) => a.job.kind === 'plan_lapsed')).toHaveLength(1);
  });

  it('a different owner gets their own alert', async () => {
    const w = world();
    lapse(w);
    const other = w.store.addUser({ phone: '+919000000002', name: 'Anita' }); // no subscription
    const aunt = w.store.addPerson({ ownerUserId: other.id, phone: '+919822222222', nickname: 'Mausi', consent: 'consented' });
    w.med('Amlodac', '09:00');
    w.med('Metformin', '09:00', {}, aunt);
    await planAll(w, w.mom.id, aunt.id);
    await w.advance(60);
    expect(w.queue.alerts.map((a) => a.jobId).sort()).toEqual([`plan_lapsed_${w.user.id}_2026-03-10`, `plan_lapsed_${other.id}_2026-03-10`].sort());
  });

  it('the next local day sends a new alert', async () => {
    const w = world();
    lapse(w);
    w.med('Amlodac', '09:00');
    await planAll(w, w.mom.id);
    await w.advance(60 * 24);
    await planAll(w, w.mom.id);
    await w.advance(60);
    expect(w.queue.alerts.map((a) => a.jobId)).toEqual([`plan_lapsed_${w.user.id}_2026-03-10`, `plan_lapsed_${w.user.id}_2026-03-11`]);
  });

  it('the local day is the owner\'s day, not UTC: 23:30 IST and 00:30 IST are different days', async () => {
    const w = world('2026-03-10T17:59:00Z'); // 23:29 IST on the 10th
    lapse(w);
    w.med('Night', '23:30');
    w.med('Late', '00:30');
    await planAll(w, w.mom.id);
    await w.advance(120);
    expect(w.queue.alerts.map((a) => a.job.localDate)).toEqual(['2026-03-10', '2026-03-11']);
  });

  it('no alert while entitled, and the "plan renewed" case calls normally', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(w.mom.phone, { answer: 'answered', inputs: [{ key: '1' }] });
    await planAll(w, w.mom.id);
    await w.advance(5);
    expect(w.queue.alerts.filter((a) => a.job.kind === 'plan_lapsed')).toHaveLength(0);
    expect(w.provider.callsTo(w.mom.phone)).toHaveLength(1);
  });

  it('an unconsented person never triggers it (rule 3 first)', async () => {
    const w = world();
    lapse(w);
    const dad = w.store.addPerson({ ownerUserId: w.user.id, phone: '+919811111111', nickname: 'Papa', consent: 'pending' });
    w.med('Metformin', '09:00', {}, dad);
    await planAll(w, dad.id);
    await w.advance(60);
    expect(w.queue.alerts).toHaveLength(0);
  });
});
