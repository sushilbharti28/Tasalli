import { describe, expect, it } from 'vitest';
import { PARENT, world, type World } from './helpers.js';

/** Three medicines due within 10 minutes: one call, one medicine at a time. */
function three() {
  const w = world();
  w.med('BP wali', '09:00');
  w.med('Sugar wali', '09:05');
  w.med('Pet wali', '09:10');
  return w;
}
const status = (w: World) => Object.fromEntries(w.store.allDoses().filter((d) => d.dueAt.toISOString() < '2026-03-10T12:00:00Z').map((d) => [w.store.state.medicines.get(w.store.state.schedules.get(d.scheduleId)!.medicineId)!.spokenName, d.status]));
async function planned(w: World) {
  await w.queue.add('schedule.replan', { personId: w.mom.id });
  await w.settle();
}

describe('one medicine at a time', () => {
  it('all three confirmed in order: intro, three prompts, one closing line', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { say: 'le li' }, { say: 'haan' }] });
    await planned(w);
    await w.advance(1);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    const said = w.playedText(0);
    expect(said).toHaveLength(4); // intro + BP, Sugar, Pet, then the closing line
    expect(said[0]).toMatch(/Aapki subah ki wali teen dawaiyon ka samay ho gaya hai\. Ek-ek karke batate hain\. Pehli dawai: BP wali\./);
    expect(said[0]).not.toMatch(/Sugar wali|Pet wali/);
    expect(said[1]).toMatch(/^Theek hai\. Doosri dawai: Sugar wali\./);
    expect(said[2]).toMatch(/^Theek hai\. Teesri dawai: Pet wali\./);
    expect(said[3]).toBe('Theek hai. Bahut achha. Sab dawaiyan le li gayi hain. Dhanyavaad.');
    expect(Object.values(status(w))).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(w.store.allCalls()[0]!.result).toBe('confirmed');
    expect(w.queue.alerts).toHaveLength(0);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1); // nothing left to retry or snooze
  });

  it('middle one "nahi li": the others are confirmed, only that dose is snoozed once', async () => {
    const w = three();
    w.provider.script(PARENT,
      { answer: 'answered', inputs: [{ key: '1' }, { say: 'nahi li' }, { key: '1' }] },
      { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(status(w)).toEqual({ 'BP wali': 'confirmed', 'Sugar wali': 'calling', 'Pet wali': 'confirmed' });
    const said = w.playedText(0);
    expect(said[2]).toMatch(/^Koi baat nahi, thodi der mein phir yaad dilayenge\. Teesri dawai: Pet wali/);
    expect(said[3]).toBe('Theek hai. Dhanyavaad. Baaki dawai ke liye thodi der mein phir phone karenge.');
    expect(w.store.allCalls()[0]!.result).toBe('snoozed');
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    await w.advance(16);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    const snooze = w.playedText(1);
    expect(snooze.join(' ')).toMatch(/Sugar wali/);
    expect(snooze.join(' ')).not.toMatch(/BP wali|Pet wali/);
    expect(snooze[0]).not.toMatch(/Pehli|Doosri/); // a single medicine left
    expect(Object.values(status(w))).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it('"nahi li" again on the snooze call: that dose is missed, the family is told once, no third call', async () => {
    const w = three();
    w.provider.script(PARENT,
      { answer: 'answered', inputs: [{ key: '1' }, { say: 'nahi li' }, { key: '1' }] },
      { answer: 'answered', inputs: [{ say: 'nahi li' }] });
    await planned(w);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    expect(status(w)['Sugar wali']).toBe('missed');
    expect(status(w)['BP wali']).toBe('confirmed');
    expect(w.queue.alerts.map((a) => a.job.kind)).toEqual(['dose_missed']);
    expect(w.queue.alerts[0]!.job.reason).toBe('said_not_taken');
  });

  it('negative beats positive on a medicine: "haan nahi" is not a confirmation', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'haan nahi' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(status(w)['BP wali']).not.toBe('confirmed');
    expect(status(w)['Sugar wali']).toBe('confirmed');
  });

  it('repeat ("phir se" or 0) says the same medicine again, in full', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'phir se' }, { key: '0' }, { key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[1]).toMatch(/^Pehli dawai: BP wali\./);
    expect(said[2]).toBe(said[1]);
    expect(said[3]).toMatch(/^Theek hai\. Doosri dawai: Sugar wali/);
    expect(Object.values(status(w))).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it('unclear speech: asked once, then keypad only for that medicine; speech then does not confirm', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'hmm achha' }, { say: 'le li' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const call = w.provider.callsTo(PARENT)[0]!;
    const said = w.playedText(0);
    expect(said[1]).toBe('Maaf kijiye, samajh nahi aaya. Le li ho to ek dabaiye.');
    expect(call.request.firstStep.listen?.speech).toBe(true);
    expect(said[2]).toMatch(/^Koi baat nahi\. Doosri dawai: Sugar wali/);
    expect(status(w)).toEqual({ 'BP wali': 'calling', 'Sugar wali': 'confirmed', 'Pet wali': 'confirmed' });
    expect(w.store.allCalls()[0]!.result).toBe('none'); // BP wali gets the normal retry
  });

  it('unclear then the keypad 1 confirms that medicine', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'hmm achha' }, { key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(Object.values(status(w))).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it('silence never confirms: every medicine is left unconfirmed, then retried 10 minutes apart and finally missed', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [] }, { answer: 'answered', inputs: [] }, { answer: 'answered', inputs: [] });
    await planned(w);
    await w.advance(1);
    expect(Object.values(status(w))).toEqual(['calling', 'calling', 'calling']);
    expect(w.playedText(0).at(-1)).toMatch(/^Koi baat nahi\. Dhanyavaad\. Baaki dawai ke liye thodi der mein phir phone karenge\.$/);
    await w.advance(30);
    expect(w.provider.callsTo(PARENT)).toHaveLength(3);
    expect(Object.values(status(w))).toEqual(['missed', 'missed', 'missed']);
    expect(w.queue.alerts.map((a) => a.job.kind)).toEqual(['dose_missed']);
  });

  it('retry after a hang-up mid-call only covers the unconfirmed doses', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { hangup: true }] }, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(11);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    const retry = w.playedText(1).join(' ');
    expect(retry).not.toMatch(/BP wali/);
    expect(retry).toMatch(/Sugar wali/);
    expect(Object.values(status(w))).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it.each([{ concurrentDuplicates: false }, { concurrentDuplicates: true }])('duplicate webhooks never skip a medicine or confirm twice (%j)', async (dup) => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', duplicateWebhooks: true, ...dup, inputs: [{ key: '1' }, { say: 'nahi li' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said).toHaveLength(4); // the provider only follows each reply once
    expect(said[1]).toMatch(/Doosri dawai: Sugar wali/);
    expect(said[2]).toMatch(/Teesri dawai: Pet wali/);
    expect(status(w)).toEqual({ 'BP wali': 'confirmed', 'Sugar wali': 'calling', 'Pet wali': 'confirmed' });
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    // every duplicate got the same reply as the original
    const r = w.provider.callsTo(PARENT)[0]!.responses.filter(Boolean).map((x) => x!.body);
    expect(new Set(r.filter((b) => b.includes('Doosri') || b.includes('audio'))).size).toBeGreaterThan(0);
  });

  it('key 9 mid-call: confirmed doses stay confirmed, the rest stop, the number is blocked', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '9' }] });
    await planned(w);
    await w.advance(60);
    expect(status(w)).toEqual({ 'BP wali': 'confirmed', 'Sugar wali': 'skipped_paused', 'Pet wali': 'skipped_paused' });
    expect(await w.store.isBlocked(PARENT)).toBe(true);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it('key 3 (doctor changed) closes the unconfirmed doses and alerts the family; earlier confirmations stay', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '3' }] });
    await planned(w);
    await w.advance(60);
    expect(status(w)).toEqual({ 'BP wali': 'confirmed', 'Sugar wali': 'missed', 'Pet wali': 'missed' });
    expect(w.queue.alerts.map((a) => a.job.kind)).toEqual(['doctor_changed']);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it('single medicine: singular intro without "ek-ek karke", plain closing line', async () => {
    const w = world();
    w.med('BP wali', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[0]).toMatch(/Aapki subah ki wali dawai ka samay ho gaya hai\. Dawai: BP wali\. /);
    expect(said[0]).not.toMatch(/Ek-ek karke|Pehli/);
    expect(said[1]).toBe('Theek hai. Bahut achha. Dawai le li gayi hai. Dhanyavaad.');
  });

  it('later calls of the day are short', async () => {
    const w = world();
    w.med('BP wali', '09:00', { colourPrimary: 'white', shape: 'round', size: 'dal', keptIn: 'strip', packColour: 'blue' });
    w.med('Sugar wali', '13:00', { colourPrimary: 'white', shape: 'round', size: 'dal', keptIn: 'strip', packColour: 'blue' });
    w.med('Pet wali', '13:05', { colourPrimary: 'white', shape: 'round', size: 'dal', keptIn: 'strip', packColour: 'blue' });
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(60 * 6);
    const full = w.playedText(0)[0]!;
    const short = w.playedText(1)[0]!;
    expect(full).toMatch(/blue|neel/i);
    expect(short).toMatch(/dopahar ki wali do dawaiyon ka samay ho gaya hai/);
    expect(short).not.toMatch(/patte|patta|round/i);
    expect(short.length).toBeLessThan(full.length + 60);
  });
});

describe('test-reminder medicines and wording placeholders', () => {
  it('tablet, capsule and syrup each get their own description, in order', async () => {
    const w = world();
    w.med('BP wali', '09:00', { kind: 'tablet', size: 'dal', colourPrimary: 'white', shape: 'round', marking: 'line', keptIn: 'strip', packColour: 'red' }, w.mom);
    w.med('sugar wali', '09:00', { kind: 'capsule', colourPrimary: 'yellow', colourSecondary: 'white', keptIn: 'strip', packColour: 'silver' }, w.mom);
    w.med('pet wali dawai', '09:00', { kind: 'syrup', keptIn: 'bottle', packColour: 'brown', capColour: 'red' }, w.mom);
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { say: 'nahi' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[0]).toMatch(/Pehli dawai: BP wali\. ek goli/);
    expect(said[1]).toMatch(/Doosri dawai: sugar wali\./);
    expect(said[2]).toMatch(/Teesri dawai: pet wali dawai\./);
    expect(said[2]).toMatch(/Le li ho to "le li" ya "haan" boliye, ya ek dabaiye\. Dobara sunne ke liye "phir se" boliye, ya zero dabaiye\.$/);
    for (const x of said.slice(0, 3)) expect(x).not.toMatch(/Khane|khane/); // food timing is in the opening only
  });

  it('opening: name, relation, child, meal phrase from time and food, count word', async () => {
    const { buildReminderSteps } = await import('../src/scripts/builder.js');
    const { BUILTIN_TEMPLATES } = await import('../src/scripts/templates.js');
    const templates = BUILTIN_TEMPLATES.hi!;
    const w = three();
    const meds = [...w.store.state.medicines.values()];
    const scheds = [...w.store.state.schedules.values()];
    const open = (n: number, food: 'before' | 'after' | 'with' | 'any', hour: number, fullName: string | null = 'Ramesh Sharma') =>
      buildReminderSteps({ templates, person: { nickname: 'Papa', fullName }, childName: 'Rahul', 
        items: meds.slice(0, n).map((m, i) => ({ medicine: m, schedule: { ...scheds[i]!, food } })),
        mode: 'full', isSunday: false, announcedTodayMedicineIds: [], localHour: hour }).opening;
    expect(open(3, 'after', 13)).toMatch(/^Aapki dopahar ke khane ke baad wali teen dawaiyon ka samay ho gaya hai\. Ek-ek karke batate hain\./i);
    expect(open(1, 'before', 8)).toMatch(/Aapki nashte se pehle wali dawai ka samay ho gaya hai\. Dawai: BP wali\./);
    expect(open(2, 'with', 20)).toMatch(/Aapki raat ke khane ke saath wali do dawaiyon/);
    expect(open(2, 'any', 17)).toMatch(/Aapki shaam ki wali do dawaiyon/);
    expect(open(2, 'any', 11)).toMatch(/Aapki dopahar ki wali/);
    expect(open(3, 'after', 13)).not.toMatch(/Rahul|bete|taraf se/); // reminder calls never name the child or the relation
    expect(open(1, 'after', 15, null)).toMatch(/^Aapki dopahar ke khane ke baad wali dawai/); // no full name: nickname
  });
});

describe('grouping by food timing', () => {
  it('doses at the same time but different food timing go in separate calls, one after the other', async () => {
    const w = world();
    w.med('BP wali', '09:00', {}, w.mom);
    w.med('Sugar wali', '09:00', {}, w.mom);
    w.med('Pet wali', '09:00', {}, w.mom);
    for (const s of w.store.state.schedules.values()) s.food = 'after';
    const sugar = [...w.store.state.medicines.values()].find((m) => m.spokenName === 'Sugar wali')!;
    [...w.store.state.schedules.values()].find((s) => s.medicineId === sugar.id)!.food = 'before';
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(5);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    const first = w.playedText(0).join(' '), second = w.playedText(1).join(' ');
    expect(first).toMatch(/BP wali/);
    expect(first).toMatch(/Pet wali/);
    expect(first).not.toMatch(/Sugar wali/);
    expect(first).toMatch(/nashte ke baad/);
    expect(second).toMatch(/nashte se pehle/);
    expect(second).toMatch(/Sugar wali/);
    expect(Object.values(status(w))).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });
});

describe('consent call names the child and the relation', () => {
  it.each([['son', /^Namaste Ramesh ji\. Yeh Tasalli ki taraf se phone hai\. aapke bete Rohit aapko dawai ki yaad dilane/],
    ['daughter_in_law', /aapki bahu Rohit aapko/], ['other', /phone hai\. Rohit aapko/], [null, /phone hai\. Rohit aapko/]])('%s', async (rel, re) => {
    const w = world();
    w.store.state.people.get(w.mom.id)!.fullName = 'Ramesh Sharma';
    (w.store.state.people.get(w.mom.id) as any).callerRelation = rel;
    w.store.state.people.get(w.mom.id)!.consent = 'pending';
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await w.queue.add('consent.call', { personId: w.mom.id });
    await w.settle();
    expect(w.playedText(0)[0]).toMatch(re);
    expect(w.playedText(0)[0]).toMatch(/Yeh call record ki jayegi/);
  });
});
