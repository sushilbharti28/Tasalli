import { describe, expect, it } from 'vitest';
import { PARENT, world } from './helpers.js';

function pendingWorld() {
  const w = world();
  w.mom.consent = 'pending';
  w.med('Amlodac', '09:00');
  return w;
}
const consentCall = async (w: ReturnType<typeof world>) => {
  await w.queue.add('consent.call', { personId: w.mom.id });
  await w.settle();
};

describe('consent call', () => {
  it('key 1 consents, then reminders get scheduled', async () => {
    const w = pendingWorld();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await consentCall(w);
    expect(w.mom.consent).toBe('consented');
    expect(w.store.consentEvents().map((e) => e.result)).toEqual(['consented']);
    expect(w.queue.alerts.map((a) => a.job.kind)).toEqual(['consent_given']);
    await w.advance(2);
    expect(w.store.allDoses().length).toBeGreaterThan(0);
    expect(w.provider.callsTo(PARENT).some((c) => c.request.purpose === 'reminder')).toBe(true);
  });

  it('spoken "haan" consents', async () => {
    const w = pendingWorld();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'haan' }] });
    await consentCall(w);
    expect(w.mom.consent).toBe('consented');
  });

  it('"nahi" declines and schedules nothing; "haan nahi" is not consent', async () => {
    for (const say of ['nahi', 'haan nahi', 'nahi chahiye']) {
      const w = pendingWorld();
      w.provider.script(PARENT, { answer: 'answered', inputs: [{ say }] });
      await consentCall(w);
      expect(w.mom.consent).not.toBe('consented');
      await w.advance(120);
      expect(w.provider.callsTo(PARENT).filter((c) => c.request.purpose === 'reminder')).toHaveLength(0);
    }
  });

  it('key 9 blocks the number and opts out', async () => {
    const w = pendingWorld();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '9' }] });
    await consentCall(w);
    expect(w.mom.consent).toBe('opted_out');
    expect(await w.store.isBlocked(PARENT)).toBe(true);
  });

  it('unclear then keypad; silence never consents', async () => {
    const w = pendingWorld();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'kya' }, { silence: true }, { silence: true }] });
    await consentCall(w);
    expect(w.mom.consent).toBe('pending');
  });

  it('no answer: 2 retries 10 minutes apart, then a consent_no_answer alert', async () => {
    const w = pendingWorld();
    await consentCall(w);
    await w.advance(9);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    await w.advance(2);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    await w.advance(10);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(3);
    expect(w.queue.alerts.map((a) => a.job.kind)).toEqual(['consent_no_answer']);
    expect(w.mom.consent).toBe('pending');
  });

  it('no consent call to a blocked number', async () => {
    const w = pendingWorld();
    await w.store.blockNumber(PARENT, 'admin');
    await consentCall(w);
    expect(w.provider.callsTo(PARENT)).toHaveLength(0);
  });
});

describe('key 9 / stop phrase (rule 3)', () => {
  it('during a reminder blocks the number across all accounts and cancels pending doses', async () => {
    const w = world();
    const other = w.store.addUser({ phone: '+919000000002', name: 'Neha' });
    const mom2 = w.store.addPerson({ ownerUserId: other.id, phone: PARENT, nickname: 'Maa', consent: 'consented' });
    w.med('Amlodac', '09:00');
    w.med('Metformin', '14:00', {}, mom2);
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '9' }] });
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.queue.add('schedule.replan', { personId: mom2.id });
    await w.settle();
    await w.advance(60 * 8);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    expect(w.mom.consent).toBe('opted_out');
    expect(mom2.consent).toBe('opted_out');
    expect(await w.store.isBlocked(PARENT)).toBe(true);
    expect(w.store.allDoses().every((d) => d.status === 'skipped_paused')).toBe(true);
    expect(w.queue.alerts.filter((a) => a.job.kind === 'opted_out')).toHaveLength(2);
    // Re-planning or a new consent call cannot revive it.
    await w.queue.add('consent.call', { personId: mom2.id });
    await w.queue.add('schedule.replan', { personId: mom2.id }, { jobId: 'again' });
    await w.advance(24 * 60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it.each(['phone band karo', 'stop calling me', 'haan phone mat karo'])('stop phrase "%s" blocks', async (say) => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say }] });
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.advance(5);
    expect(await w.store.isBlocked(PARENT)).toBe(true);
  });

  it('opt-out of one number leaves other numbers alone', async () => {
    const w = world();
    const dad = w.store.addPerson({ ownerUserId: w.user.id, phone: '+919111111111', nickname: 'Papa', consent: 'consented' });
    await w.store.blockNumber(PARENT, 'key_9');
    expect(await w.store.isBlocked(dad.phone)).toBe(false);
  });
});

describe('caps (rule 5)', () => {
  it('at most 6 calls per number per day across accounts; the 7th is dropped with a daily_cap alert', async () => {
    const w = world();
    const other = w.store.addUser({ phone: '+919000000002' });
    w.store.addSubscription(other.id);
    const mom2 = w.store.addPerson({ ownerUserId: other.id, phone: PARENT, nickname: 'Maa', consent: 'consented' });
    w.med('A', '09:00');
    w.med('B', '10:00', {}, mom2);
    w.med('C', '11:00');
    for (const p of [w.mom, mom2]) await w.queue.add('schedule.replan', { personId: p.id });
    await w.settle();
    await w.advance(60 * 6);
    const todays = w.provider.callsTo(PARENT).filter((c) => c.request.firstStep.audioUrl);
    expect(todays).toHaveLength(6);
    expect(w.queue.alerts.some((a) => a.job.reason === 'daily_cap')).toBe(true);
  });

  it('the cap day is the parent local day, not UTC', async () => {
    const w = world('2026-03-10T18:00:00Z'); // 23:30 IST on the 10th
    w.med('A', '23:45');
    w.med('B', '00:15');
    for (let i = 0; i < 6; i++) await w.store.insertCall({ personId: w.mom.id, purpose: 'reminder', callGroupId: null, attempt: 0, provider: 'fake', status: 'completed' }, new Date('2026-03-10T10:00:00Z'));
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.advance(30);
    expect(w.provider.callsTo(PARENT)).toHaveLength(0); // capped for the 10th (local)
    await w.advance(60 * 24);
    expect(w.provider.callsTo(PARENT).length).toBeGreaterThan(0); // next local day is free
  });
});
