import { describe, expect, it } from 'vitest';
import { PARENT, world, type World } from './helpers.js';
import { buildReminderSteps } from '../src/scripts/builder.js';
import { BUILTIN_TEMPLATES } from '../src/scripts/templates.js';
import { TwilioProvider } from '../src/providers/twilio.js';
import { SayUrls } from '../src/providers/twilio.js';
import { MemoryStore } from '../src/store/memory.js';

const planned = async (w: World) => { await w.queue.add('schedule.replan', { personId: w.mom.id }); await w.settle(); };
const doses = (w: World) => w.store.allDoses().filter((d) => d.dueAt.toISOString() < '2026-03-10T12:00:00Z').map((d) => d.status);

describe('v1.5 medicine line: printed name and strength, then what the family calls it', () => {
  const t = BUILTIN_TEMPLATES.hi!;
  const build = (over: Record<string, unknown>, o: { mode?: 'full' | 'short'; count?: number } = {}) => {
    const s = new MemoryStore();
    const mk = (i: number) => {
      const m = s.addMedicine({ personId: 'p', spokenName: 'sugar wali', stripName: 'Glycomet', strengthText: '500 mg', kind: 'capsule', ...over });
      const sc = s.addSchedule({ medicineId: m.id, localTime: '09:00', amountText: '1 capsule', food: 'after' });
      return { medicine: { ...m, id: `${m.id}${i}` }, schedule: sc };
    };
    const items = Array.from({ length: o.count ?? 2 }, (_, i) => mk(i));
    const steps = buildReminderSteps({ templates: t, person: { nickname: 'Papa', fullName: 'Ramesh Sharma' }, childName: 'Rahul', items,
      mode: o.mode ?? 'full', isSunday: false, announcedTodayMedicineIds: [], localHour: 9 });
    return { steps, items };
  };

  it('strip name and strength, then "Jise aap ... kehte hain", then amount; numbers are words', () => {
    const { steps } = build({});
    expect(steps.items[0]!.full).toMatch(/^Pehli dawai: Glycomet paanch sau milligram\. Jise aap sugar wali kehte hain\. ek capsule/);
    expect(steps.items[0]!.full).not.toMatch(/\d/);
  });
  it('single medicine: "Dawai: ..." with no ordinal', () => {
    const { steps } = build({}, { count: 1 });
    expect(steps.items[0]!.full).toMatch(/^Dawai: Glycomet paanch sau milligram\. Jise aap sugar wali kehte hain\./);
    expect(steps.items[0]!.full).not.toMatch(/Pehli/);
  });
  it('empty strength is left out', () => {
    const { steps } = build({ strengthText: null });
    expect(steps.items[0]!.full).toMatch(/^Pehli dawai: Glycomet\. Jise aap sugar wali kehte hain\./);
    expect(build({ strengthText: '  ' }).steps.items[0]!.full).toMatch(/^Pehli dawai: Glycomet\. Jise/);
  });
  it('spoken name equal to the strip name (any case) leaves out the "Jise aap" sentence', () => {
    const { steps } = build({ spokenName: 'GLYCOMET' });
    expect(steps.items[0]!.full).toMatch(/^Pehli dawai: Glycomet paanch sau milligram\. ek capsule/);
    expect(steps.items[0]!.full).not.toMatch(/Jise aap/);
  });
  it('the short (later in the day) form shows the strip name too', () => {
    const { steps } = build({}, { mode: 'short' });
    expect(steps.items[0]!.first).toMatch(/^Pehli dawai: Glycomet paanch sau milligram\. Jise aap sugar wali kehte hain\. ek capsule/);
    expect(steps.items[0]!.first).not.toMatch(/goli, |capsule,/); // no appearance in the short form
    expect(steps.items[0]!.full).not.toBe(steps.items[0]!.first);
  });
  it('speech only: the stored amount, strength and names are never changed', () => {
    const { items } = build({});
    expect(items[0]!.schedule.amountText).toBe('1 capsule');
    expect(items[0]!.medicine.strengthText).toBe('500 mg');
    expect(items[0]!.medicine.stripName).toBe('Glycomet');
  });
  it('end to end: Telma 40 with BP wali, then the store still has the digits', async () => {
    const w = world();
    w.med('BP wali tablet', '09:00', { stripName: 'Telma 40', strengthText: '40 mg' });
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0).join(' ');
    expect(said).toMatch(/Dawai: Telma chaalees chaalees milligram\. Jise aap BP wali tablet kehte hain\. ek goli/);
    expect(said).not.toMatch(/\d/);
    const med = [...w.store.state.medicines.values()][0]!;
    expect(med.stripName).toBe('Telma 40');
    expect(med.strengthText).toBe('40 mg');
    expect([...w.store.state.schedules.values()][0]!.amountText).toBe('ek goli');
  });
});

describe('v1.5 greeting, silence and listen time', () => {
  it('the greeting is its own <Say>, then a 1 s pause, then the rest (Twilio TwiML)', async () => {
    const p = new TwilioProvider({ accountSid: 'AC1', authToken: 't', publicBaseUrl: 'https://x.example' });
    const url = await new SayUrls().urlFor('Namaste Mummy ji.\nAapki dawai ka samay ho gaya hai.', 'hi');
    const { body } = p.renderNextAction({ action: 'play', step: { audioUrl: url, listen: { keys: ['1'], speech: true, timeoutSeconds: 8 } } }, { callId: 'c1' });
    const says = body.match(/<Say /g) ?? [];
    expect(says).toHaveLength(2);
    expect(body).toMatch(/<\/Say><Pause length="1"\/><Say /);
    expect(body.indexOf('Namaste')).toBeLessThan(body.indexOf('<Pause'));
    expect(body.indexOf('Aapki')).toBeGreaterThan(body.indexOf('<Pause'));
    expect(body).toContain('timeout="8"');
  });

  it('the first prompt is the short greeting then the first medicine; Gather timeout 8 s for the first medicine, 6 s after', async () => {
    const w = world();
    w.med('BP wali', '09:00');
    w.med('Sugar wali', '09:05');
    const timeouts: number[] = [];
    const render = w.provider.renderNextAction.bind(w.provider);
    w.provider.renderNextAction = ((n: Parameters<typeof render>[0]) => { if (n.action === 'play') timeouts.push(n.step.listen?.timeoutSeconds ?? 0); return render(n); }) as typeof render;
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const call = w.provider.callsTo(PARENT)[0]!;
    expect(call.request.firstStep.listen?.timeoutSeconds).toBe(8);
    expect(w.playedText(0)[0]!.split('\n')[0]).toBe('Namaste Mummy ji.');
    expect(timeouts).toEqual([6]); // the second medicine
  });

  it('silence on a medicine plays it once more, never confirms; then the normal unclear path', async () => {
    const w = world();
    w.med('BP wali', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ silence: true }, { silence: true }, { silence: true }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[1]).toMatch(/^Dawai: BP wali\./); // same medicine again, in full
    expect(said[1]).toBe(w.provider.callsTo(PARENT)[0]!.played.map((u) => w.text(u))[1]);
    expect(said[2]).toMatch(/Maaf kijiye/); // second silence: asked once, keypad
    expect(doses(w)).toEqual(['calling']); // never confirmed
    expect(w.store.allCalls()[0]!.result).toBe('none');
  });

  it('the silence repeat counts toward the repeat limit of 2', async () => {
    const w = world();
    w.med('BP wali', '09:00');
    w.med('Sugar wali', '09:05');
    // silence (repeat 1), key 0 (repeat 2), key 0 (limit: moves on), key 1 confirms the second medicine
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ silence: true }, { key: '0' }, { key: '0' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[3]).toMatch(/^Koi baat nahi, aage badhte hain\./);
    expect(said[3]).toMatch(/Doosri dawai: Sugar wali/);
    expect(doses(w)).toEqual(['calling', 'confirmed']);
  });

  it('silence after a spoken answer is not repeated twice for the same medicine', async () => {
    const w = world();
    w.med('BP wali', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ silence: true }, { silence: true }, { silence: true }, { silence: true }] });
    await planned(w);
    await w.advance(1);
    expect(w.playedText(0).filter((t) => /Dawai: BP wali/.test(t))).toHaveLength(2); // opening + exactly one replay
  });
});

describe('v1.5 presence check ("can you hear me?")', () => {
  function two(...scenarios: Parameters<World['provider']['script']>[1][]) {
    const w = world(undefined, { presence: true });
    w.med('BP wali', '09:00');
    w.med('Sugar wali', '09:05');
    w.provider.script(PARENT, ...scenarios);
    return w;
  }
  const ok = { answer: 'answered' as const };

  it('greeting + question come first, no medicine yet; a key continues; the presence reply never confirms a dose', async () => {
    const w = two({ ...ok, inputs: [{ key: '1' }, { hangup: true }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[0]).toBe('Namaste Mummy ji.\nKya aapko awaaz aa rahi hai? "Haan" boliye, ya ek dabaiye.');
    expect(said[0]).not.toMatch(/BP wali/);
    expect(said[1]).toMatch(/Aapki subah ki wali do dawaiyon.*Pehli dawai: BP wali/);
    expect(doses(w)).toEqual(['calling', 'calling']); // key 1 on "can you hear me" confirmed nothing
  });

  it.each(['haan', 'haan ji', 'ji', 'han', 'aa rahi hai', 'sun raha hoon', 'sun rahi hoon', 'हाँ', 'हाँ जी', 'jee haan awaaz aa rahi hai'])('"%s" continues to the medicines', async (say) => {
    const w = two({ ...ok, inputs: [{ say }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(w.playedText(0)[1]).toMatch(/Pehli dawai: BP wali/);
    expect(doses(w)).toEqual(['confirmed', 'confirmed']);
  });

  it('any key except 9 continues', async () => {
    const w = two({ ...ok, inputs: [{ key: '5' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(doses(w)).toEqual(['confirmed', 'confirmed']);
  });

  it('"nahi" / "nahi aa rahi" / "haan nahi" do not continue (no medicine is said)', async () => {
    for (const say of ['nahi', 'nahi aa rahi', 'haan nahi', 'awaaz nahi aa rahi hai']) {
      const w = two({ ...ok, inputs: [{ say }, { say }] }, { ...ok, inputs: [{ say }, { say }] }, { ...ok, inputs: [{ say }, { say }] });
      await planned(w);
      await w.advance(1);
      expect(w.playedText(0).join(' ')).not.toMatch(/BP wali/);
      expect(doses(w)).toEqual(['calling', 'calling']);
    }
  });

  it('unclear once: asked again, then continues', async () => {
    const w = two({ ...ok, inputs: [{ say: 'hmm' }, { key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[1]).toMatch(/^Kya aapko awaaz aa rahi hai/);
    expect(said[2]).toMatch(/Pehli dawai: BP wali/);
    expect(doses(w)).toEqual(['confirmed', 'confirmed']);
  });

  it('silence twice: hangs up, no medicine marked, all doses unanswered and retried 10 minutes later, then missed', async () => {
    const w = two({ ...ok, inputs: [] }, { ...ok, inputs: [] }, { ...ok, inputs: [] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said).toHaveLength(3); // question, question again, goodbye
    expect(said.join(' ')).not.toMatch(/BP wali|Sugar wali/);
    expect(w.store.allCalls()[0]!.result).toBe('none');
    expect(doses(w)).toEqual(['calling', 'calling']);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    await w.advance(10);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2); // retry after 10 minutes, same two doses
    await w.advance(30);
    expect(w.provider.callsTo(PARENT)).toHaveLength(3); // 2 retries only
    expect(doses(w)).toEqual(['missed', 'missed']);
  });

  it('the presence step counts toward the call time (limit counted from answer)', async () => {
    const w = two({ ...ok, secondsPerStep: 100, inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    // 100 s presence + 100 s first medicine: the 180 s soft limit passes before the second medicine starts
    expect(doses(w)).toEqual(['confirmed', 'calling']);
    expect(w.playedText(0).join(' ')).toMatch(/Samay poora ho gaya/);
  });

  it('key 9 at the presence question opts out and blocks the number', async () => {
    const w = two({ ...ok, inputs: [{ key: '9' }] });
    await planned(w);
    await w.advance(1);
    expect(await w.store.isBlocked(PARENT)).toBe(true);
    expect(w.mom.consent).toBe('opted_out');
    expect(w.playedText(0).join(' ')).not.toMatch(/BP wali/);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it('a stop phrase at the presence question opts out', async () => {
    const w = two({ ...ok, inputs: [{ say: 'band karo' }] });
    await planned(w);
    await w.advance(1);
    expect(await w.store.isBlocked(PARENT)).toBe(true);
  });

  it.each([{ concurrentDuplicates: false }, { concurrentDuplicates: true }])('duplicate webhooks never skip the presence check or a medicine (%j)', async (dup) => {
    const w = two({ ...ok, duplicateWebhooks: true, ...dup, inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[1]).toMatch(/Pehli dawai: BP wali/);
    expect(said[2]).toMatch(/Doosri dawai: Sugar wali/);
    expect(doses(w)).toEqual(['confirmed', 'confirmed']);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it('a drop after medicine 1: it stays confirmed, the rest is retried in 10 minutes (and only the rest is said)', async () => {
    const w = world(undefined, { presence: true });
    w.med('BP wali', '09:00');
    w.med('Sugar wali', '09:05');
    w.med('Pet wali', '09:10');
    w.provider.script(PARENT, { ...ok, inputs: [{ key: '1' }, { key: '1' }, { hangup: true }] }, { ...ok, inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(doses(w)).toEqual(['confirmed', 'calling', 'calling']);
    expect(w.store.allCalls()[0]!.result).not.toBe('confirmed');
    await w.advance(10);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    const retry = w.playedText(1).join(' ');
    expect(retry).not.toMatch(/BP wali/);
    expect(retry).toMatch(/Sugar wali/);
    expect(retry).toMatch(/Pet wali/);
    expect(doses(w)).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it('a call that fails (provider status) after medicine 1 behaves the same: confirmed stays, the rest is retried', async () => {
    const w = world(undefined, { presence: true });
    w.med('BP wali', '09:00');
    w.med('Sugar wali', '09:05');
    w.provider.script(PARENT, { ...ok, inputs: [{ key: '1' }, { key: '1' }, { hangup: true }] }, { answer: 'failed' }, { ...ok, inputs: [{ key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(doses(w)).toEqual(['confirmed', 'calling']);
    await w.advance(25);
    expect(doses(w)).toEqual(['confirmed', 'confirmed']);
    expect(w.provider.callsTo(PARENT)).toHaveLength(3);
  });

  it('consent calls get the same check: question first, consent only after it', async () => {
    const w = world(undefined, { presence: true });
    w.mom.consent = 'pending';
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { ...ok, inputs: [{ key: '1' }, { key: '1' }] });
    await w.queue.add('consent.call', { personId: w.mom.id });
    await w.settle();
    const said = w.playedText(0);
    expect(said[0]).toMatch(/^Namaste Mummy ji\.\nKya aapko awaaz aa rahi hai/);
    expect(said[1]).toMatch(/Tasalli/);
    expect(said[1]).not.toMatch(/^Namaste/); // the greeting is not said twice
    expect(w.mom.consent).toBe('consented');
    expect(w.store.consentEvents()).toHaveLength(1);
  });

  it('consent: the presence "yes" alone is not consent; silence twice hangs up and retries', async () => {
    const w = world(undefined, { presence: true });
    w.mom.consent = 'pending';
    w.provider.script(PARENT, { ...ok, inputs: [{ key: '1' }, { hangup: true }] }, { ...ok, inputs: [] });
    await w.queue.add('consent.call', { personId: w.mom.id });
    await w.settle();
    expect(w.mom.consent).toBe('pending');
    expect(w.store.consentEvents().map((e) => e.result)).not.toContain('consented');
    await w.advance(11);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    expect(w.mom.consent).not.toBe('consented');
  });

  it('consent: key 9 at the presence question opts out', async () => {
    const w = world(undefined, { presence: true });
    w.mom.consent = 'pending';
    w.provider.script(PARENT, { ...ok, inputs: [{ key: '9' }] });
    await w.queue.add('consent.call', { personId: w.mom.id });
    await w.settle();
    expect(await w.store.isBlocked(PARENT)).toBe(true);
    expect(w.mom.consent).toBe('opted_out');
  });
});
