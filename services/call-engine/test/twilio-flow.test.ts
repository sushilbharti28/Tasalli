import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/clock.js';
import { defaultConfig } from '../src/engine/deps.js';
import { Engine } from '../src/engine/engine.js';
import { MemorySessionStore } from '../src/flows/session.js';
import { silentLogger } from '../src/log.js';
import { FakeSpeech } from '../src/providers/fake-speech.js';
import { SayUrls, TwilioProvider, twilioSignature } from '../src/providers/twilio.js';
import { MemoryQueue } from '../src/queue/memory.js';
import { ScriptLibrary } from '../src/scripts/loader.js';
import { MemoryStore } from '../src/store/memory.js';
import { SID, gatherDigits, gatherSpeech, status } from './fixtures/twilio.js';

const BASE = 'https://t.example';
const TOKEN = 'tok';
const PHONE = '+919876543210';

function rig() {
  const clock = new FakeClock('2026-03-10T03:00:00Z');
  const store = new MemoryStore();
  const queue = new MemoryQueue(clock);
  const placed: URLSearchParams[] = [];
  const f = (async (_u: string, init: RequestInit) => { placed.push(new URLSearchParams(init.body as string)); return new Response(JSON.stringify({ sid: SID }), { status: 201 }); }) as unknown as typeof fetch;
  const provider = new TwilioProvider({ accountSid: 'AC1', authToken: TOKEN, publicBaseUrl: BASE, fetch: f });
  const engine = new Engine({ store, queue, provider, audio: new SayUrls(), speech: new FakeSpeech(), sessions: new MemorySessionStore(), clock,
    scripts: new ScriptLibrary(null), log: silentLogger, config: defaultConfig({ publicBaseUrl: BASE, callerId: '+15005550006' }) });
  queue.setHandler((n, d) => engine.handleJob(n, d));
  const user = store.addUser({ phone: PHONE, name: 'Rohit' });
  const mom = store.addPerson({ ownerUserId: user.id, phone: PHONE, nickname: 'Mummy', consent: 'pending' });
  const hit = (kind: 'status' | 'input', query: string, params: Record<string, string>, sig = true) => {
    const url = `${BASE}/webhooks/twilio/${kind}?${query}`;
    return engine.handleWebhook({ 'x-tasalli-url': url, 'x-twilio-signature': twilioSignature(sig ? TOKEN : 'bad', url, params) }, params);
  };
  const start = async () => {
    await queue.add('consent.call', { personId: mom.id });
    await queue.runDue();
    const callId = new URL(placed[0]!.get('StatusCallback')!).searchParams.get('c')!;
    return callId;
  };
  return { store, queue, engine, mom, hit, start, placed };
}

describe('consent call through the Twilio adapter', () => {
  it('places the call with a Hindi Gather, then key 1 consents; a retried callback gets the same TwiML and no second consent', async () => {
    const r = rig();
    const callId = await start_(r);
    expect(r.placed[0]!.get('Twiml')).toContain('language="hi-IN"');
    expect((await r.hit('status', `c=${callId}`, status('in-progress'))).status).toBe(200);
    const a = await r.hit('input', `c=${callId}&n=n1`, gatherDigits('1'));
    const b = await r.hit('input', `c=${callId}&n=n1`, gatherDigits('1')); // Twilio retry of the same request
    expect(a.body).toContain('<Hangup/>');
    expect(b.body).toBe(a.body);
    expect(r.mom.consent).toBe('consented');
    expect(r.store.consentEvents()).toHaveLength(1);
    await r.hit('status', `c=${callId}`, status('completed'));
    await r.queue.runDue();
    expect(r.placed).toHaveLength(1);
  });

  it('speech "nahi" does not consent', async () => {
    const r = rig();
    const callId = await start_(r);
    await r.hit('status', `c=${callId}`, status('in-progress'));
    await r.hit('input', `c=${callId}&n=n1`, gatherSpeech('haan nahi'));
    expect(r.mom.consent).not.toBe('consented');
  });

  it('key 9 blocks the number', async () => {
    const r = rig();
    const callId = await start_(r);
    await r.hit('input', `c=${callId}&n=n1`, gatherDigits('9'));
    expect(await r.store.isBlocked(PHONE)).toBe(true);
  });

  it('bad signature: 401 and nothing changes', async () => {
    const r = rig();
    const callId = await start_(r);
    expect((await r.hit('input', `c=${callId}&n=n1`, gatherDigits('1'), false)).status).toBe(401);
    expect(r.mom.consent).toBe('pending');
  });

  it('silent call: unclear, then keypad-only TwiML, never consent', async () => {
    const r = rig();
    const callId = await start_(r);
    const first = await r.hit('input', `c=${callId}&n=n1`, status('in-progress'));
    expect(first.body).toContain('input="dtmf speech"');
    const second = await r.hit('input', `c=${callId}&n=n2`, status('in-progress'));
    expect(second.body).toContain('input="dtmf"');
    expect(second.body).not.toContain('speech');
    expect(r.mom.consent).toBe('pending');
  });
});

const start_ = (r: ReturnType<typeof rig>) => r.start();
