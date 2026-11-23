import { describe, expect, it } from 'vitest';
import { PARENT, world } from './helpers.js';

const doses = (w: ReturnType<typeof world>) => w.store.allDoses();

async function planned(w: ReturnType<typeof world>) {
  await w.queue.add('schedule.replan', { personId: w.mom.id });
  await w.settle();
}

describe('reminder flow', () => {
  it('confirms with key 1 and makes exactly one call', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    expect(doses(w).filter((x) => x.status === 'confirmed')).toHaveLength(1);
    expect(w.queue.alerts).toHaveLength(0);
  });

  it('confirms with "le li" spoken', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'le li' }] });
    await planned(w);
    await w.advance(31);
    expect(doses(w)[0]!.status).toBe('confirmed');
    expect(doses(w)[0]!.confirmedVia).toBe('speech');
  });

  it('"nahi li" never confirms: snoozes once, second "nahi li" is missed with an alert', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'nahi li' }] }, { answer: 'answered', inputs: [{ say: 'nahi li' }] });
    await planned(w);
    await w.advance(16);
    expect(doses(w)[0]!.status).not.toBe('confirmed');
    expect(w.provider.callsTo(PARENT)).toHaveLength(2); // original + snooze call 15 min later
    expect(doses(w)[0]!.status).toBe('missed');
    expect(w.queue.alerts.map((a) => a.job.kind)).toEqual(['dose_missed']);
    expect(w.queue.alerts[0]!.job.reason).toBe('said_not_taken');
  });

  it.each(['nahi', 'abhi nahi li', 'nahi li haan thodi der mein', 'haan nahi'])('negative beats positive: "%s"', async (say) => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say }] });
    await planned(w);
    await w.advance(1);
    expect(doses(w)[0]!.status).not.toBe('confirmed');
  });

  it('key 2 snoozes once; the second snooze request says take it now', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '2' }] }, { answer: 'answered', inputs: [{ key: '2' }] });
    await planned(w);
    await w.advance(16);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    expect(w.playedText(0)[1]).toMatch(/Koi baat nahi, thodi der mein phir yaad dilayenge/);
    expect(doses(w)[0]!.status).toBe('missed'); // second "not now": no second snooze
    expect(w.queue.alerts.map((a) => a.job.reason)).toEqual(['said_not_taken']);
  });

  it('key 0 repeats the full description', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '0' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const played = w.playedText(0);
    expect(played[0]).toContain(played[1]!); // the repeat is the full description of the same medicine
    expect(doses(w)[0]!.status).toBe('confirmed');
  });

  it('key 3 alerts the child that the doctor changed the medicine and does not confirm', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '3' }] });
    await planned(w);
    await w.advance(1);
    expect(w.queue.alerts.map((a) => a.job.kind)).toEqual(['doctor_changed']);
    expect(doses(w)[0]!.status).not.toBe('confirmed');
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it('unclear speech asks once, then keypad only, and never confirms', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'hmm achha' }, { say: 'achha achha' }, { say: 'le li' }] });
    await planned(w);
    await w.advance(1);
    const call = w.provider.callsTo(PARENT)[0]!;
    expect(call.played).toHaveLength(3); // main, unclear (keypad only), goodbye
    expect(doses(w)[0]!.status).not.toBe('confirmed');
  });

  it('silence never confirms', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [] });
    await planned(w);
    await w.advance(1);
    expect(doses(w)[0]!.status).not.toBe('confirmed');
  });

  it('low-confidence audio is unclear', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'le li', confidence: 0.3, asAudio: true }] });
    await planned(w);
    await w.advance(1);
    expect(doses(w)[0]!.status).not.toBe('confirmed');
  });

  it('retries twice, 10 minutes apart, then marks missed and alerts once', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    await planned(w);
    await w.advance(5);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    await w.advance(10);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    await w.advance(10);
    expect(w.provider.callsTo(PARENT)).toHaveLength(3);
    await w.advance(120);
    expect(w.provider.callsTo(PARENT)).toHaveLength(3);
    expect(doses(w)[0]!.status).toBe('missed');
    expect(w.queue.alerts).toHaveLength(1);
    expect(w.queue.alerts[0]!.job.reason).toBe('retries_exhausted');
  });

  it('a retry that is answered stops further retries', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'no_answer' }, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    expect(doses(w)[0]!.status).toBe('confirmed');
  });

  it('hanging up without confirming counts as unconfirmed and retries', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ hangup: true }] });
    await planned(w);
    await w.advance(11);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
  });

  it('a dose confirmed in the app before a retry means no retry call', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    await planned(w);
    await w.advance(5);
    const d = doses(w)[0]!;
    await w.store.confirmGroup(d.callGroupId!, 'key', w.clock.now());
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it('groups doses due within 30 minutes into one call; later doses get their own', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.med('Metformin', '09:20');
    w.med('Ecosprin', '10:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(120);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    const first = w.playedText(0).join(' ');
    expect(first).toMatch(/Amlodac/);
    expect(first).toMatch(/Metformin/);
    expect(first).not.toMatch(/Ecosprin/);
    expect(doses(w).filter((x) => x.dueAt.toISOString() < '2026-03-10T18:30:00Z').every((x) => x.status === 'confirmed')).toBe(true);
  });

  it('full description on the first call of the day, short afterwards', async () => {
    const w = world();
    w.med('Amlodac', '09:00', { colourPrimary: 'white', shape: 'round', size: 'dal', keptIn: 'strip', packColour: 'blue' });
    w.med('Ecosprin', '13:00', { colourPrimary: 'white', shape: 'round', size: 'dal', keptIn: 'strip', packColour: 'blue' });
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(60 * 6);
    const [a, b] = [w.playedText(0)[0]!, w.playedText(1)[0]!];
    expect(a).toMatch(/safed/);
    expect(a.length).toBeGreaterThan(b.length);
    expect(b).not.toMatch(/safed/);
  });

  it('uses the number or printed name to tell look-alike medicines apart', async () => {
    const w = world();
    w.med('Amlodac', '09:00', { numberLabel: 2 });
    w.med('Telma', '09:05', { sayPrintedName: true, stripName: 'Telma 40' });
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0).join(' ');
    expect(said).toMatch(/Iske patte par do number likha hai\./);
    expect(said).toMatch(/Iske patte par T-E-L-M-A chaar-zero likha hai\./);
  });

  it('stores times in the parent time zone: 09:00 in New York is 13:00Z in March (EDT)', async () => {
    const w = world('2026-03-10T00:00:00Z');
    const ny = w.store.addPerson({ ownerUserId: w.user.id, phone: '+12025550123', nickname: 'Dad', consent: 'consented', timeZone: 'America/New_York', language: 'en' });
    w.med('Aspirin', '09:00', {}, ny);
    await w.queue.add('schedule.replan', { personId: ny.id });
    await w.settle();
    expect(w.store.allDoses().map((x) => x.dueAt.toISOString())).toContain('2026-03-10T13:00:00.000Z');
  });

  it('does nothing for unconsented, paused or blocked people', async () => {
    for (const mode of ['pending', 'paused', 'blocked'] as const) {
      const w = world();
      w.med('Amlodac', '09:00');
      if (mode === 'pending') w.mom.consent = 'pending';
      if (mode === 'paused') w.mom.paused = true;
      if (mode === 'blocked') await w.store.blockNumber(PARENT, 'admin');
      await planned(w);
      await w.advance(60);
      expect(w.provider.callsTo(PARENT)).toHaveLength(0);
      expect(w.store.allDoses().every((x) => x.status !== 'calling' && x.status !== 'confirmed')).toBe(true);
    }
  });

  it('pausing after planning skips the doses and places no call', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    await planned(w);
    w.mom.paused = true;
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(0);
    expect(doses(w)[0]!.status).toBe('skipped_paused');
  });

  it('a dose edited after planning is not spoken', async () => {
    const w = world();
    const { s } = w.med('Amlodac', '09:00');
    await planned(w);
    s.localTime = '21:00';
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(0);
  });

  it('a dose far past due (service down) is missed with a too_late alert, not called', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    await planned(w);
    w.clock.set('2026-03-10T05:30:00Z'); // 11:00 IST
    await w.settle();
    expect(w.provider.callsTo(PARENT)).toHaveLength(0);
    expect(w.queue.alerts[0]!.job.reason).toBe('too_late');
  });

  it('provider outage on placeCall is retried like an unanswered call', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { placeCallError: 'boom' });
    await planned(w);
    await w.advance(11);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    expect(w.store.allCalls().map((c) => c.status)).toContain('failed');
    expect(w.store.allCalls()).toHaveLength(2);
  });
});
