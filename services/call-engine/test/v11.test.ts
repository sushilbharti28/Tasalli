import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/clock.js';
import { defaultConfig } from '../src/engine/deps.js';
import { Engine } from '../src/engine/engine.js';
import { isEntitled } from '../src/engine/billing.js';
import { MemorySessionStore } from '../src/flows/session.js';
import { silentLogger, type Logger } from '../src/log.js';
import { FakeSpeech } from '../src/providers/fake-speech.js';
import { SayUrls, TwilioProvider, twilioSignature } from '../src/providers/twilio.js';
import { MemoryQueue } from '../src/queue/memory.js';
import { DEFAULT_SCRIPTS_DIR, ScriptLibrary } from '../src/scripts/loader.js';
import { MemoryStore } from '../src/store/memory.js';
import { SID, status } from './fixtures/twilio.js';
import { PARENT, world } from './helpers.js';

const hindi = () => new ScriptLibrary(DEFAULT_SCRIPTS_DIR);
const planned = async (w: ReturnType<typeof world>) => { await w.queue.add('schedule.replan', { personId: w.mom.id }); await w.settle(); };

describe('scripts from packages/scripts/engine', () => {
  it('loads the generated Hindi file by default', () => {
    const pack = hindi().get('hi');
    expect(pack.source).toBe('builtin+file');
    expect(pack.warnings).toEqual([]);
    expect(pack.templates.reminder.full_intro_one).toContain('एक दवाई');
    expect(pack.templates.words_gendered?.colours?.yellow?.f).toBe('पीली');
  });

  it('one medicine uses full_intro_one; two use the count', async () => {
    const w = world(undefined, { scripts: hindi() });
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(5);
    expect(w.playedText(0)[0]).toContain('अभी एक दवाई लेनी है');

    const w2 = world(undefined, { scripts: hindi() });
    w2.med('Amlodac', '09:00');
    w2.med('Metolar', '09:10');
    w2.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w2);
    await w2.advance(40);
    expect(w2.provider.callsTo(PARENT)).toHaveLength(1); // grouped
    expect(w2.playedText(0)[0]).toContain('अभी 2 दवाइयाँ लेनी हैं');
  });

  it('Hindi colour words agree with the noun: tablet feminine, capsule masculine, strip oblique, bottle feminine', async () => {
    const w = world(undefined, { scripts: hindi() });
    w.med('Amlodac', '09:00', { kind: 'tablet', colourPrimary: 'yellow', shape: 'long', keptIn: 'strip', packColour: 'green' });
    w.med('Vitcap', '09:05', { kind: 'capsule', colourPrimary: 'yellow', keptIn: 'bottle', packColour: 'blue', capColour: 'black' });
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(40);
    const said = w.playedText(0)[0]!;
    expect(said).toContain('पीली लंबी गोली');
    expect(said).toContain('हरे पत्ते वाली');
    expect(said).toContain('पीला कैप्सूल');
    expect(said).toContain('नीली बोतल वाली');
  });

  it('second call of the day is short_single', async () => {
    const w = world(undefined, { scripts: hindi() });
    w.med('Amlodac', '09:00');
    w.med('Metolar', '21:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] }, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(60 * 13);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    expect(w.playedText(0)[0]).toContain('अभी एक दवाई लेनी है');
    expect(w.playedText(1)[0]).toBe('Mummy जी, Metolar का समय। ek goli। ले ली, तो "ले ली" बोलिए, या 1 दबाइए।');
  });

  it('"nahi li" first time: not_taken_ack, listens again, never confirms; key 2 then snoozes', async () => {
    const w = world(undefined, { scripts: hindi() });
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ say: 'nahi li' }, { key: '2' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[1]).toBe(hindi().get('hi').templates.reminder.not_taken_ack);
    expect(w.store.allDoses()[0]!.status).not.toBe('confirmed');
    expect(w.store.allCalls()[0]!.result).toBe('snoozed');
    expect(w.queue.alerts).toHaveLength(0);
  });

  it('test call: any key ends it', async () => {
    const w = world(undefined, { scripts: hindi() });
    w.provider.script(w.user.phone, { answer: 'answered', inputs: [{ key: '7' }] });
    await w.queue.add('test.call', { userId: w.user.id });
    await w.settle();
    const call = w.store.allCalls()[0]!;
    expect(call.purpose).toBe('test');
    expect(call.result).toBe('confirmed');
    expect(w.provider.callsTo(w.user.phone)[0]!.request.firstStep.listen?.keys).toContain('7');
  });

  it('a person whose language is not hi or en is called in Hindi, and it is logged', async () => {
    const logs: string[] = [];
    const log: Logger = { ...silentLogger, warn: (m, f) => logs.push(`${m} ${JSON.stringify(f)}`) };
    const w = world(undefined, { scripts: hindi(), log });
    w.mom.language = 'ta';
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(5);
    expect(w.provider.callsTo(PARENT)[0]!.request.language).toBe('hi');
    expect(w.playedText(0)[0]).toContain('नमस्ते');
    expect(logs.some((l) => l.includes('language not supported yet'))).toBe(true);
  });

  it('consent scripts carry the recording line', () => {
    expect(hindi().get('hi').templates.consent.prompt).toContain('रिकॉर्ड किया जा सकता है');
    expect(hindi().get('en').templates.consent.prompt).toContain('This call may be recorded to improve the service.');
  });
});

describe('billing gate', () => {
  const now = new Date('2026-03-10T00:00:00Z');
  const day = 86_400_000;
  const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);
  it.each([
    ['trialing', null, true],
    ['active', null, true],
    ['past_due', -2.9, true],
    ['past_due', -3.1, false],
    ['past_due', null, false],
    ['cancelled', 1, true],
    ['cancelled', -1, false],
    ['cancelled', null, false],
  ] as const)('%s, period end %s days from now: entitled=%s', (st, off, want) => {
    expect(isEntitled({ status: st, currentPeriodEnd: off === null ? null : at(off), trialEndsAt: null }, now)).toBe(want);
  });

  it('no reminder call when the owner is not entitled (every attempt), and no missed alert', async () => {
    const w = world();
    w.store.state.subscriptions.length = 0;
    w.store.addSubscription(w.user.id, { status: 'past_due', currentPeriodEnd: new Date('2026-03-01T00:00:00Z') });
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(0);
    expect(w.store.allDoses()[0]!.status).toBe('skipped_paused');
    expect(w.queue.alerts).toHaveLength(0);
  });

  it('no subscription at all: no reminder call', async () => {
    const w = world();
    w.store.state.subscriptions.length = 0;
    w.med('Amlodac', '09:00');
    await planned(w);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(0);
  });

  it('past_due inside the 3 days still gets calls', async () => {
    const w = world();
    w.store.state.subscriptions.length = 0;
    w.store.addSubscription(w.user.id, { status: 'past_due', currentPeriodEnd: new Date('2026-03-08T12:00:00Z') });
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await planned(w);
    await w.advance(5);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });

  it('consent calls are not gated', async () => {
    const w = world();
    w.store.state.subscriptions.length = 0;
    const dad = w.store.addPerson({ ownerUserId: w.user.id, phone: '+919811111111', nickname: 'Papa', consent: 'pending' });
    w.provider.script(dad.phone, { answer: 'answered', inputs: [{ key: '1' }] });
    await w.queue.add('consent.call', { personId: dad.id });
    await w.settle();
    expect(w.provider.callsTo(dad.phone)).toHaveLength(1);
    expect(w.store.state.people.get(dad.id)!.consent).toBe('consented');
  });
});

describe('evening summary', () => {
  it('one evening_summary per person at 20:00 in the parent zone, with localDate; replans do not duplicate it', async () => {
    const w = world('2026-03-10T03:29:00Z'); // 08:59 IST
    await planned(w);
    await planned(w);
    await w.advance(60 * 11 - 1); // 19:58 IST
    expect(w.queue.alerts).toHaveLength(0);
    await w.advance(3); // 20:01 IST
    await planned(w);
    expect(w.queue.alerts).toHaveLength(1);
    const a = w.queue.alerts[0]!;
    expect(a.job).toMatchObject({ kind: 'evening_summary', personId: w.mom.id, ownerUserId: w.user.id, callGroupId: null, doseIds: [], localDate: '2026-03-10' });
    expect(a.jobId).toBe(`evening_summary_${w.mom.id}_2026-03-10`);
    await w.advance(60 * 24);
    expect(w.queue.alerts.map((x) => x.job.localDate)).toEqual(['2026-03-10', '2026-03-11']);
  });

  it('uses the parent time zone (America/New_York 20:00, not IST)', async () => {
    const w = world('2026-03-10T10:00:00Z');
    w.mom.timeZone = 'America/New_York'; // 06:00 EDT... DST began 8 March: UTC-4
    w.store.state.people.get(w.mom.id)!.timeZone = 'America/New_York';
    await planned(w);
    await w.advance(60 * 13 + 30); // 23:30Z = 19:30 EDT
    expect(w.queue.alerts).toHaveLength(0);
    await w.advance(60); // 00:30Z = 20:30 EDT
    expect(w.queue.alerts.map((x) => x.job.localDate)).toEqual(['2026-03-10']);
  });

  it('not emitted for a paused or not-entitled person', async () => {
    const w = world();
    w.store.state.subscriptions.length = 0;
    await planned(w);
    await w.advance(60 * 13);
    expect(w.queue.alerts).toHaveLength(0);
  });
});

describe('Twilio recording', () => {
  const BASE = 'https://t.example';
  const TOKEN = 'tok';
  const PHONE = '+919876543210';
  function rig(record?: boolean) {
    const clock = new FakeClock('2026-03-10T03:00:00Z');
    const store = new MemoryStore();
    const queue = new MemoryQueue(clock);
    const placed: URLSearchParams[] = [];
    const f = (async (_u: string, init: RequestInit) => { placed.push(new URLSearchParams(init.body as string)); return new Response(JSON.stringify({ sid: SID }), { status: 201 }); }) as unknown as typeof fetch;
    const provider = new TwilioProvider({ accountSid: 'AC1', authToken: TOKEN, publicBaseUrl: BASE, fetch: f, record });
    const engine = new Engine({ store, queue, provider, audio: new SayUrls(), speech: new FakeSpeech(), sessions: new MemorySessionStore(), clock,
      scripts: hindi(), log: silentLogger, config: defaultConfig({ publicBaseUrl: BASE, callerId: '+15005550006' }) });
    queue.setHandler((n, d) => engine.handleJob(n, d));
    const user = store.addUser({ phone: PHONE, name: 'Rohit' });
    const mom = store.addPerson({ ownerUserId: user.id, phone: PHONE, nickname: 'Mummy', consent: 'pending' });
    const rec = (callId: string, params: Record<string, string>, token = TOKEN) => {
      const url = `${BASE}/webhooks/twilio/recording?c=${callId}`;
      return engine.handleRecordingWebhook({ 'x-tasalli-url': url, 'x-twilio-signature': twilioSignature(token, url, params) }, params);
    };
    const start = async () => {
      await queue.add('consent.call', { personId: mom.id });
      await queue.runDue();
      return new URL(placed[0]!.get('StatusCallback')!).searchParams.get('c')!;
    };
    return { store, queue, placed, rec, start, user };
  }
  const recParams = (over: Record<string, string> = {}) => ({ ...status('completed'), RecordingSid: 'RE1', RecordingStatus: 'completed', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1', RecordingChannels: '1', ...over });

  it('creates the call with Record, mono, and a recording status callback to the signed path', async () => {
    const r = rig();
    const callId = await r.start();
    const p = r.placed[0]!;
    expect(p.get('Record')).toBe('true');
    expect(p.get('RecordingChannels')).toBe('mono');
    expect(p.get('RecordingStatusCallback')).toBe(`${BASE}/webhooks/twilio/recording?c=${callId}`);
    expect(p.get('RecordingStatusCallbackEvent')).toBe('completed');
  });

  it('record=false and test calls are not recorded', async () => {
    const off = rig(false);
    await off.start();
    expect(off.placed[0]!.get('Record')).toBeNull();
    const on = rig();
    await on.queue.add('test.call', { userId: on.user.id });
    await on.queue.runDue();
    expect(on.placed[0]!.get('Record')).toBeNull();
  });

  it('completed stores recording_url; a duplicate is a no-op 200', async () => {
    const r = rig();
    const callId = await r.start();
    expect((await r.rec(callId, recParams())).status).toBe(200);
    expect(r.store.allCalls()[0]!.recordingUrl).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1');
    r.store.state.calls.get(callId)!.recordingUrl = 'changed-by-test';
    expect((await r.rec(callId, recParams())).status).toBe(200); // Twilio retry: same RecordingSid
    expect(r.store.allCalls()[0]!.recordingUrl).toBe('changed-by-test'); // not written twice
  });

  it('in-progress, bad signature and unknown call', async () => {
    const r = rig();
    const callId = await r.start();
    expect((await r.rec(callId, recParams({ RecordingStatus: 'in-progress' }))).status).toBe(200);
    expect(r.store.allCalls()[0]!.recordingUrl).toBeNull();
    expect((await r.rec(callId, recParams(), 'wrong')).status).toBe(401);
    expect(r.store.allCalls()[0]!.recordingUrl).toBeNull();
    expect((await r.rec('00000000-0000-0000-0000-000000000000', recParams())).status).toBe(200);
  });
});

describe('Hindi punctuation cleanup', () => {
  it('drops a danda left behind by an empty field', async () => {
    const { render } = await import('../src/scripts/render.js');
    expect(render('{a}, {b}। {c}', { a: 'x', b: '', c: 'y' })).toBe('x। y');
  });
});

describe('dose.remind (one more reminder from the API)', () => {
  const setup = async (over: { subscription?: boolean } = {}) => {
    const w = world();
    if (over.subscription === false) w.store.state.subscriptions.length = 0;
    w.med('Amlodac', '09:00');
    await planned(w);
    return w;
  };
  const remind = async (w: ReturnType<typeof world>) => { await w.queue.add('dose.remind', { doseId: w.store.allDoses()[0]!.id }); await w.settle(); };

  it('places exactly one call for a missed dose, even when the job is delivered twice', async () => {
    const w = await setup();
    await w.advance(60 * 3); // nobody answers: 3 calls, then missed
    expect(w.store.allDoses()[0]!.status).toBe('missed');
    const before = w.provider.callsTo(PARENT).length;
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await remind(w);
    await w.engine.handleJob('dose.remind', { doseId: w.store.allDoses()[0]!.id });
    await w.settle();
    expect(w.provider.callsTo(PARENT)).toHaveLength(before + 1);
    expect(w.store.allDoses()[0]!.status).toBe('confirmed');
  });

  it('unanswered: one call only, no retries', async () => {
    const w = await setup();
    await w.advance(60 * 3);
    const before = w.provider.callsTo(PARENT).length;
    await remind(w);
    await w.advance(60);
    expect(w.provider.callsTo(PARENT)).toHaveLength(before + 1);
  });

  it('does nothing for a confirmed dose', async () => {
    const w = await setup();
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await w.advance(5);
    const before = w.provider.callsTo(PARENT).length;
    await remind(w);
    expect(w.provider.callsTo(PARENT)).toHaveLength(before);
  });

  it('re-checks consent, block list, billing and the daily cap', async () => {
    for (const block of ['consent', 'blocked', 'billing', 'cap'] as const) {
      const w = await setup();
      await w.advance(60 * 3);
      const before = w.provider.callsTo(PARENT).length;
      if (block === 'consent') w.store.state.people.get(w.mom.id)!.consent = 'declined';
      if (block === 'blocked') await w.store.blockNumber(PARENT, 'key_9');
      if (block === 'billing') w.store.state.subscriptions.length = 0;
      if (block === 'cap') for (let i = 0; i < 6; i++) await w.store.insertCall({ personId: w.mom.id, purpose: 'reminder', callGroupId: null, attempt: 0, provider: 'fake', status: 'completed' }, w.clock.now());
      w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
      await remind(w);
      expect(w.provider.callsTo(PARENT), block).toHaveLength(before);
      expect(w.store.allDoses()[0]!.status, block).not.toBe('confirmed');
    }
  });
});
