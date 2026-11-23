import type { MedicineRow } from '../src/types.js';
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
    expect(said[0]).toMatch(/Theek hai\. Hum ek-ek karke dawai batate hain\. Aapki Pehli dawai, ek goli BP wali ki hai\./);
    expect(said[0]).not.toMatch(/Sugar wali|Pet wali/);
    expect(said[1]).toMatch(/^Theek hai\. Aapki Doosri dawai, ek goli Sugar wali ki hai\./);
    expect(said[2]).toMatch(/^Theek hai\. Aapki Teesri dawai, ek goli Pet wali ki hai\./);
    expect(said[3]).toBe('Theek hai. Bahut achha, aapne saari dawaiyan le li hain. Dhanyavaad, namaste.');
    expect(Object.values(status(w))).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(w.store.allCalls()[0]!.result).toBe('confirmed');
    expect(w.queue.alerts).toHaveLength(0);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1); // nothing left to retry or snooze
  });

  it('middle one "nahi li" (v1.6): that dose is not taken and the family is alerted; the others are confirmed; no call back', async () => {
    const w = three();
    w.provider.script(PARENT,
      { answer: 'answered', inputs: [{ key: '1' }, { say: 'nahi li' }, { key: '1' }] },
      { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(status(w)).toEqual({ 'BP wali': 'confirmed', 'Sugar wali': 'missed', 'Pet wali': 'confirmed' });
    const said = w.playedText(0);
    expect(said[2]).toMatch(/^Theek hai, hum aapke ghar walon ko bata denge\. Aapki Teesri dawai, ek goli Pet wali/);
    expect(said[3]).toBe('Theek hai. Dhanyavaad, namaste.'); // nothing promises a call back
    expect(w.store.allCalls()[0]!.result).toBe('declined');
    expect(w.queue.alerts.map((a) => [a.job.kind, a.job.reason])).toEqual([['dose_missed', 'said_not_taken']]);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it('"nahi" on one medicine and no answer on another: only the unanswered one is called back', async () => {
    const w = three();
    w.provider.script(PARENT,
      { answer: 'answered', inputs: [{ key: '2' }, { silence: true }, { silence: true }, { key: '1' }] },
      { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(status(w)).toEqual({ 'BP wali': 'missed', 'Sugar wali': 'calling', 'Pet wali': 'confirmed' });
    expect(w.playedText(0).at(-1)).toMatch(/Chinta mat kijiye, baaki dawai ke liye hum thodi der mein phir phone karenge/);
    await w.advance(11);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    expect(w.playedText(1).join(' ')).toMatch(/Sugar wali/);
    expect(w.playedText(1).join(' ')).not.toMatch(/BP wali|Pet wali/);
    expect(status(w)['Sugar wali']).toBe('confirmed');
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
    expect(said[1]).toMatch(/^Aapki Pehli dawai, ek goli BP wali ki hai\./);
    expect(said[2]).toBe(said[1]);
    expect(said[3]).toMatch(/^Theek hai\. Aapki Doosri dawai, ek goli Sugar wali/);
    expect(Object.values(status(w))).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it('unclear speech (v1.6): the same medicine and question again, by voice or key; a clear "haan" then confirms (rule 4)', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'hmm achha' }, { say: 'haan' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[1]).toMatch(/^Maaf kijiye, aapka jawab sunai nahi diya\. Hum phir se batate hain\. Aapki Pehli dawai, ek goli BP wali ki hai\..*Abhi nahi le sakte, to "nahi" boliye, ya do dabaiye\.$/);
    expect(status(w)).toEqual({ 'BP wali': 'confirmed', 'Sugar wali': 'confirmed', 'Pet wali': 'confirmed' });
  });

  it('unclear twice: never a confirmation; left open, "we will call again" while a retry is left', async () => {
    const w = three();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'hmm achha' }, { say: 'lady' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[2]).toMatch(/^Koi baat nahi\. Is dawai ke liye hum thodi der mein phir phone karenge\. Aapki Doosri dawai/);
    expect(status(w)).toEqual({ 'BP wali': 'calling', 'Sugar wali': 'confirmed', 'Pet wali': 'confirmed' });
    expect(said.at(-1)).toMatch(/Chinta mat kijiye, baaki dawai ke liye hum thodi der mein phir phone karenge/);
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
    expect(w.playedText(0).at(-1)).toBe('Koi baat nahi. Chinta mat kijiye, baaki dawai ke liye hum thodi der mein phir phone karenge. Dhanyavaad, namaste.');
    await w.advance(30);
    expect(w.provider.callsTo(PARENT)).toHaveLength(3);
    // The last retry: no call follows, so nothing promises one.
    expect(w.playedText(2).join(' ')).not.toMatch(/phir phone karenge/);
    expect(w.playedText(2).at(-1)).toMatch(/Dhanyavaad, namaste\.$/);
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
    expect(said[1]).toMatch(/Doosri dawai, ek goli Sugar wali/);
    expect(said[2]).toMatch(/Teesri dawai, ek goli Pet wali/);
    expect(status(w)).toEqual({ 'BP wali': 'confirmed', 'Sugar wali': 'missed', 'Pet wali': 'confirmed' });
    expect(w.queue.alerts).toHaveLength(1); // the "not taken" alert is sent once
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
    expect(said[0]).toMatch(/Theek hai\. Aapki dawai, ek goli BP wali ki hai\./);
    expect(said[0]).not.toMatch(/ek-ek karke|Pehli/);
    expect(said[1]).toBe('Theek hai. Bahut achha, aapne dawai le li hai. Dhanyavaad, namaste.');
  });

  it('v1.6 which medicines are described without asking: new or changed, look-alike, labelled, parent cannot read, date unknown', async () => {
    const { describeMedicineIds } = await import('../src/scripts/builder.js');
    const now = new Date('2026-03-10T04:00:00Z');
    const old = new Date('2026-01-01T00:00:00Z');
    const sched = (medicineId: string, startDate = '2026-01-01') =>
      ({ id: `s${medicineId}`, medicineId, localTime: '09:00', amountText: 'ek goli', food: 'after' as const, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate, endDate: null });
    const med = (id: string, over: Record<string, unknown> = {}) => ({ id, personId: 'p', kind: 'tablet' as const, stripName: id, strengthText: null, spokenName: id,
      colourPrimary: 'white', colourSecondary: null, shape: 'round' as const, size: 'small' as const, marking: 'plain' as const, keptIn: 'strip' as const,
      packColour: 'red', printColour: null, capColour: null, numberLabel: null, sayPrintedName: false, extraInstruction: null, active: true, updatedAt: old, ...over }) as unknown as MedicineRow; // three sizes arrive with the contracts change
    const run = (m: MedicineRow, o: { others?: MedicineRow[]; canRead?: 'yes' | 'no' | 'not_sure'; start?: string } = {}) =>
      describeMedicineIds({ items: [{ medicine: m, schedule: sched(m.id, o.start) }], allActive: [m, ...(o.others ?? [])], canReadStrip: o.canRead ?? 'yes', now, localToday: '2026-03-10' }).length === 1;
    const yellow = med('Y', { colourPrimary: 'yellow' });
    expect(run(med('A'), { others: [yellow] })).toBe(false);                                   // known, unlike the others: name only
    expect(run(med('A', { updatedAt: new Date('2026-03-05T00:00:00Z') }), { others: [yellow] })).toBe(true); // changed 5 days ago
    expect(run(med('A'), { others: [yellow], start: '2026-03-08' })).toBe(true);              // new schedule
    expect(run(med('A', { updatedAt: null }), { others: [yellow] })).toBe(true);              // change date unknown
    expect(run(med('A'), { others: [med('B', { packColour: 'blue' })] })).toBe(true);          // same pill, only the strip differs
    expect(run(med('A', { size: 'small' }), { others: [med('B', { size: 'dal' })] })).toBe(true); // old size key maps to the same size
    expect(run(med('A'), { others: [med('B', { shape: null })] })).toBe(true);                  // unknown counts as same
    expect(run(med('A'), { others: [med('B', { kind: 'capsule' })] })).toBe(false);            // a capsule is not a tablet
    expect(run(med('A'), { others: [med('B', { active: false })] })).toBe(false);              // stopped medicines do not count
    expect(run(med('A', { numberLabel: 2 }), { others: [yellow] })).toBe(true);                // family set a number
    expect(run(med('A'), { others: [yellow], canRead: 'no' })).toBe(true);                      // parent cannot read the strip
  });

  it('v1.6: a medicine added in the last 7 days is "aapki nayi dawai" and described; a changed one keeps its number', async () => {
    const w = world();
    w.store.state.people.get(w.mom.id)!.canReadStrip = 'yes';
    const old = new Date('2026-01-01T00:00:00Z');
    const look = { colourPrimary: 'white', shape: 'round', size: 'small', keptIn: 'strip' };
    w.med('BP wali', '09:00', { ...look, packColour: 'red', createdAt: old, updatedAt: old });
    w.med('Sugar wali', '09:00', { kind: 'capsule', colourPrimary: 'yellow', size: 'small', keptIn: 'strip', packColour: 'silver', createdAt: old, updatedAt: new Date('2026-03-08T00:00:00Z') });
    w.med('Pet wali', '09:00', { kind: 'syrup', keptIn: 'bottle', packColour: 'brown', capColour: 'red', createdAt: new Date('2026-03-09T00:00:00Z'), updatedAt: new Date('2026-03-09T00:00:00Z') });
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[0]).toMatch(/Aapki Pehli dawai, ek goli BP wali ki hai\. Dawai lene ke baad/); // known: name only
    expect(said[1]).toMatch(/Aapki Doosri dawai, ek goli Sugar wali ki hai\. Yeh ek chhota sa peele rang ka capsule hai\./); // changed: described, keeps its number
    expect(said[2]).toMatch(/Aapki nayi dawai, ek goli Pet wali ki hai\. Iski bottle bhoore rang ki hai\. Iska dhakkan laal rang ka hai\./); // new
    expect(said.join(' ')).not.toMatch(/Teesri/);

    // A single new medicine also says "nayi"; an unknown creation date is not "new".
    const one = world();
    one.med('Pet wali', '09:00', { kind: 'syrup', keptIn: 'bottle', packColour: 'brown', createdAt: new Date('2026-03-09T00:00:00Z') });
    one.med('Old', '21:00', {});
    one.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(one);
    await one.advance(60 * 13);
    expect(one.playedText(0)[0]).toMatch(/Aapki nayi dawai, ek goli Pet wali ki hai\./);
    expect(one.playedText(1)[0]).toMatch(/Aapki dawai, ek goli Old ki hai\./);
  });

  it('v1.6: every question offers "phir se"; on a name-only medicine it plays the full description', async () => {
    const w = world();
    w.store.state.people.get(w.mom.id)!.canReadStrip = 'yes';
    w.med('BP wali', '09:00', { colourPrimary: 'white', shape: 'round', size: 'small', keptIn: 'strip', packColour: 'blue', updatedAt: new Date('2026-01-01T00:00:00Z') });
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '0' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[0]).toMatch(/Dobara sunna ho, to "phir se" boliye, ya zero dabaiye\./);
    expect(said[0]).not.toMatch(/Iska patta/);
    expect(said[1]).toMatch(/^Aapki dawai, ek goli BP wali ki hai\. Yeh ek chhoti si safed rang ki gol aakar ki goli hai\. Iska patta neele rang ka hai\./);
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
    expect(said[0]).toMatch(/Aapki Pehli dawai, ek goli BP wali ki hai\. Yeh ek chhoti si safed rang ki gol aakar ki goli hai\. Iske beech mein ek line hai\. Iska patta laal rang ka hai\./);
    expect(said[1]).toMatch(/Aapki Doosri dawai, ek goli sugar wali ki hai\. Yeh capsule dekhne mein aadha peela aur aadha safed hai\. Iska patta chaandi ke rang ka hai\./);
    expect(said[2]).toMatch(/Aapki Teesri dawai, ek goli pet wali dawai ki hai\. Iski bottle bhoore rang ki hai\. Iska dhakkan laal rang ka hai\./);
    // Then the question ("le li" is no longer asked for). The longer pause before it is only in Twilio's SSML (twilio.test.ts).
    expect(said[2]).toMatch(/laal rang ka hai\. Dawai lene ke baad, "haan" boliye, ya ek dabaiye\. Dobara sunna ho, to "phir se" boliye, ya zero dabaiye\. Abhi nahi le sakte, to "nahi" boliye, ya do dabaiye\.$/);
    for (const x of said) expect(x).not.toMatch(/"le li"/);
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
        mode: 'full', isSunday: false, announcedTodayMedicineIds: [], localHour: hour });
    // The opening after the greeting says who is calling and why; its "haan" / 1 is the presence check.
    expect(open(3, 'after', 13).presence).toBe('Hum Tasalli app se bol rahe hain. Aapko dopahar ke khane ke baad wali teen dawaiyon ki yaad dilane ke liye phone kiya hai. Dawaiyon ke baare mein sunne ke liye, "haan" boliye, ya ek dabaiye.');
    expect(open(1, 'before', 8).presence).toMatch(/Aapko nashte se pehle wali dawai ki yaad dilane ke liye phone kiya hai\. Dawai ke baare mein sunne/);
    expect(open(1, 'before', 8).presenceRetry).toBe('Maaf kijiye, samajh nahi aaya. Dawai ke baare mein sunne ke liye, "haan" boliye, ya ek dabaiye.');
    expect(open(2, 'with', 20).presence).toMatch(/Aapko raat ke khane ke saath wali do dawaiyon/);
    expect(open(2, 'any', 17).presence).toMatch(/Aapko shaam ki wali do dawaiyon/);
    expect(open(2, 'any', 11).presence).toMatch(/Aapko dopahar ki wali/);
    expect(open(3, 'after', 13).greeting).toBe('Namaste Ramesh ji.');
    expect(open(1, 'after', 15, null).greeting).toBe('Namaste ji.'); // no full name: never the nickname ("Papa" is a relation, not a name)
    for (const x of [open(3, 'after', 13), open(1, 'before', 8)]) {
      expect(x.greeting + x.presence + x.opening).not.toMatch(/Rahul|bete|taraf se/); // reminder calls never name the child or the relation
    }
    expect(open(3, 'after', 13).opening).toMatch(/^Theek hai\. Hum ek-ek karke dawai batate hain\./);
  });
});

describe('grouping by food timing', () => {
  it('doses at the same time but different food timing go in separate calls, one after the other', async () => {
    const w = world(undefined, { presence: true });
    w.med('BP wali', '09:00', {}, w.mom);
    w.med('Sugar wali', '09:00', {}, w.mom);
    w.med('Pet wali', '09:00', {}, w.mom);
    for (const s of w.store.state.schedules.values()) s.food = 'after';
    const sugar = [...w.store.state.medicines.values()].find((m) => m.spokenName === 'Sugar wali')!;
    [...w.store.state.schedules.values()].find((s) => s.medicineId === sugar.id)!.food = 'before';
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] });
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

describe('the parent is greeted by name, never by the nickname', () => {
  it('reminder and consent calls with no full name say "Namaste ji", not "Mummy"', async () => {
    const w = world(undefined, { presence: true });
    w.store.state.people.get(w.mom.id)!.fullName = null;
    w.med('BP wali', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(w.playedText(0)[0]!.split('\n')[0]).toBe('Namaste ji.');
    expect(w.playedText(0).join(' ')).not.toMatch(/Mummy/);

    const c = world();
    c.store.state.people.get(c.mom.id)!.fullName = null;
    c.store.state.people.get(c.mom.id)!.consent = 'pending';
    c.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await c.queue.add('consent.call', { personId: c.mom.id });
    await c.settle();
    expect(c.playedText(0).join(' ')).not.toMatch(/Mummy/);
  });
});

describe('consent call names the child and the relation', () => {
  it.each([['son', /^Namaste Ramesh ji\. Yeh Tasalli app ki taraf se phone hai\. aapke bete Rohit aapko dawai ki yaad dilane/],
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
