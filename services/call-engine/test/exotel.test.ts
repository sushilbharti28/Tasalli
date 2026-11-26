import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { CallLanguage, SpeechProvider } from '@tasalli/contracts';
import { FakeClock } from '../src/clock.js';
import { Engine } from '../src/engine/engine.js';
import { defaultConfig } from '../src/engine/deps.js';
import { MemorySessionStore } from '../src/flows/session.js';
import { silentLogger } from '../src/log.js';
import { ExotelProvider } from '../src/providers/exotel.js';
import { attachExotelVoicebot } from '../src/providers/exotel-server.js';
import { CHUNK_BYTES, VoicebotSession, rms, toPcm8k, wav8k } from '../src/providers/exotel-voicebot.js';
import { SayUrls } from '../src/providers/twilio.js';
import { MemoryQueue } from '../src/queue/memory.js';
import { ScriptLibrary } from '../src/scripts/loader.js';
import { MemoryStore } from '../src/store/memory.js';

const PARENT = '+919876543210';
const CFG = { accountSid: 'acme1', apiKey: 'key', apiToken: 'tok', subdomain: 'api.exotel.test', appId: '4242',
  publicBaseUrl: 'https://ce.example', webhookSecret: 's3cret-token' };

function fakeFetch(sid = 'exo-sid-1') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ Call: { Sid: sid, Status: 'in-progress' } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('ExotelProvider', () => {
  it('placeCall: connect API to our call flow, transactional, status callback with our call id and secret', async () => {
    const { f, calls } = fakeFetch();
    const p = new ExotelProvider({ ...CFG, fetch: f });
    const step = { audioUrl: 'say:hi:x', listen: { keys: ['1'], speech: true, timeoutSeconds: 8 } };
    const out = await p.placeCall({ callId: 'call-1', to: PARENT, callerId: '08012345678', language: 'hi', purpose: 'reminder',
      firstStep: step, statusWebhookUrl: '', inputWebhookUrl: '', timeLimitSeconds: 210 } as never);
    expect(out.providerCallId).toBe('exo-sid-1');
    expect(calls[0]!.url).toBe('https://api.exotel.test/v1/Accounts/acme1/Calls/connect.json');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('key:tok').toString('base64')}`);
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(Object.fromEntries(body)).toMatchObject({
      From: PARENT, CallerId: '08012345678', Url: 'http://my.exotel.com/acme1/exoml/start_voice/4242', CallType: 'trans',
      StatusCallback: 'https://ce.example/webhooks/exotel/status?c=call-1&t=s3cret-token', TimeLimit: '210', CustomField: 'call-1',
    });
    expect(p.takeFirstStep('exo-sid-1')).toEqual(step);
    expect(p.takeFirstStep('exo-sid-1')).toBeUndefined(); // handed over once
  });

  it('parseWebhook: secret token checked; Exotel statuses mapped; bad payloads refused', () => {
    const p = new ExotelProvider(CFG);
    const h = (t: string) => ({ 'x-tasalli-url': `https://ce.example/webhooks/exotel/status?c=call-1&t=${t}` });
    expect(p.parseWebhook(h('s3cret-token'), { CallSid: 'exo-1', Status: 'completed' })).toMatchObject({ type: 'status', callId: 'call-1', status: 'completed' });
    expect(p.parseWebhook(h('s3cret-token'), { CallSid: 'exo-1', Status: 'no-answer' })).toMatchObject({ status: 'no_answer' });
    expect(p.parseWebhook(h('s3cret-token'), { CallSid: 'exo-1', Status: 'in-progress' })).toMatchObject({ status: 'answered' });
    expect(() => p.parseWebhook(h('wrong'), { CallSid: 'exo-1', Status: 'completed' })).toThrow(/token/);
    expect(() => p.parseWebhook(h('s3cret-token'), { CallSid: 'exo-1', Status: 'weird' })).toThrow();
  });
});

describe('audio helpers', () => {
  it('WAV round trip and loudness', () => {
    const loud = Buffer.alloc(CHUNK_BYTES);
    for (let i = 0; i < loud.length / 2; i++) loud.writeInt16LE(i % 2 ? 4000 : -4000, i * 2);
    expect(rms(loud)).toBeGreaterThan(3000);
    expect(rms(Buffer.alloc(CHUNK_BYTES))).toBe(0);
    expect(toPcm8k(wav8k(loud), 'audio/wav', '')).toEqual(loud);
    expect(() => toPcm8k(Buffer.alloc(10), 'audio/mpeg', '')).toThrow(/unsupported/);
  });
});

// ---- a whole call over a fake socket, against the real engine -----------------------------------------------

class FakeSocket {
  sent: Array<{ event: string; media?: { payload: string }; mark?: { name: string } }> = [];
  closed = false;
  private handlers: Record<string, (d?: unknown) => void> = {};
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; }
  on(e: string, fn: (d?: unknown) => void) { this.handlers[e] = fn; }
  push(msg: unknown) { this.handlers.message!(JSON.stringify(msg)); }
  lastMark() { return [...this.sent].reverse().find((m) => m.event === 'mark')?.mark?.name; }
}

const tick = () => new Promise((r) => setTimeout(r, 5));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

/** Speech: synthesize returns 100 ms of PCM per word; transcribe returns what the test queued. */
class ScriptedSpeech implements SpeechProvider {
  readonly name = 'fake' as const;
  heard: string[] = [];
  async synthesize(text: string, _l: CallLanguage) { return { audio: Buffer.alloc(CHUNK_BYTES * Math.max(1, text.split(' ').length)), mimeType: 'audio/l16;rate=8000' }; }
  async transcribe(_a: Buffer, _l: CallLanguage) { return { transcript: this.heard.shift() ?? '', confidence: 0.9 }; }
}

async function exotelWorld() {
  const clock = new FakeClock('2026-03-10T03:29:00Z');
  const store = new MemoryStore();
  const queue = new MemoryQueue(clock);
  const { f } = fakeFetch('exo-call-9');
  const provider = new ExotelProvider({ ...CFG, fetch: f });
  const speech = new ScriptedSpeech();
  const scripts = new ScriptLibrary(null);
  for (const l of ['hi', 'en'] as const) { const r = scripts.get(l).templates.reminder; r.step_presence = r.step_reminder_presence = r.step_reminder_presence_one = undefined; }
  const engine = new Engine({ store, queue, provider, audio: new SayUrls(), speech, sessions: new MemorySessionStore(), clock, scripts,
    log: silentLogger, config: defaultConfig() });
  queue.setHandler((n, data) => engine.handleJob(n, data));
  const user = store.addUser({ phone: '+919000000001', name: 'Rohit' });
  store.addSubscription(user.id);
  const mom = store.addPerson({ ownerUserId: user.id, phone: PARENT, nickname: 'Mummy', fullName: 'Kamla Devi', consent: 'consented' });
  const m = store.addMedicine({ personId: mom.id, spokenName: 'BP wali' });
  store.addSchedule({ medicineId: m.id, localTime: '09:00', amountText: 'ek goli' });
  await queue.add('schedule.replan', { personId: mom.id });
  await queue.runDue();
  clock.set('2026-03-10T03:30:00Z');
  await queue.runDue(); // dose.due: placeCall to Exotel
  const timers: Array<() => void> = [];
  const ws = new FakeSocket();
  new VoicebotSession(ws as never, {
    handleEvent: (ev) => engine.handleEvent(ev), findCall: (sid) => store.getCallByProviderCallId(sid),
    takeFirstStep: (sid) => provider.takeFirstStep(sid), speech, log: silentLogger,
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => undefined,
  });
  return { store, ws, speech, timers };
}

const loud = () => { const b = Buffer.alloc(CHUNK_BYTES); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(i % 2 ? 5000 : -5000, i * 2); return b; };
const quiet = () => Buffer.alloc(CHUNK_BYTES);
const media = (b: Buffer) => ({ event: 'media', stream_sid: 'st1', media: { payload: b.toString('base64') } });

describe('Exotel Voicebot bridge with the engine', () => {
  it('plays the prompt as 100 ms chunks, then a mark; a key pressed during the prompt is ignored; key 1 after it confirms', async () => {
    const w = await exotelWorld();
    expect(w.store.allCalls()[0]!.providerCallId).toBe('exo-call-9');
    w.ws.push({ event: 'start', stream_sid: 'st1', start: { call_sid: 'exo-call-9', stream_sid: 'st1' } });
    await settle();
    const chunks = w.ws.sent.filter((m) => m.event === 'media');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(Buffer.from(c.media!.payload, 'base64').length).toBe(CHUNK_BYTES);
    expect(w.ws.lastMark()).toMatch(/^listen-/);
    w.ws.push({ event: 'dtmf', stream_sid: 'st1', dtmf: { digit: '1' } }); // before the prompt finished: ignored
    await settle();
    expect(w.store.allDoses()[0]!.status).toBe('calling');
    w.ws.push({ event: 'mark', stream_sid: 'st1', mark: { name: w.ws.lastMark() } }); // prompt played in full
    w.ws.push({ event: 'dtmf', stream_sid: 'st1', dtmf: { digit: '1' } });
    await settle();
    expect(w.store.allDoses()[0]!.status).toBe('confirmed');
    expect(w.ws.lastMark()).toMatch(/^end-/); // goodbye queued; the stream closes once it has played
    w.ws.push({ event: 'mark', stream_sid: 'st1', mark: { name: w.ws.lastMark() } });
    await settle();
    expect(w.ws.closed).toBe(true);
  });

  it('speech: loud frames then 1 s of quiet are transcribed; "haan" confirms', async () => {
    const w = await exotelWorld();
    w.ws.push({ event: 'start', stream_sid: 'st1', start: { call_sid: 'exo-call-9', stream_sid: 'st1' } });
    await settle();
    w.ws.push({ event: 'mark', stream_sid: 'st1', mark: { name: w.ws.lastMark() } });
    await settle();
    w.speech.heard.push('haan');
    for (let i = 0; i < 4; i++) w.ws.push(media(loud()));
    for (let i = 0; i < 11; i++) w.ws.push(media(quiet()));
    await settle();
    expect(w.store.allDoses()[0]!.status).toBe('confirmed');
    expect(w.store.allDoses()[0]!.confirmedVia).toBe('speech');
  });

  it('nothing said within the listen time: a silence event (the engine replays the medicine), never a confirmation', async () => {
    const w = await exotelWorld();
    w.ws.push({ event: 'start', stream_sid: 'st1', start: { call_sid: 'exo-call-9', stream_sid: 'st1' } });
    await settle();
    w.ws.push({ event: 'mark', stream_sid: 'st1', mark: { name: w.ws.lastMark() } });
    await settle();
    const before = w.ws.sent.length;
    w.timers.at(-1)!(); // the listen time runs out
    await settle();
    expect(w.ws.sent.length).toBeGreaterThan(before); // the replay is being played
    expect(w.store.allDoses()[0]!.status).toBe('calling');
  });

  it('a stream for an unknown call is closed', async () => {
    const w = await exotelWorld();
    w.ws.push({ event: 'start', stream_sid: 'st1', start: { call_sid: 'someone-else', stream_sid: 'st1' } });
    await settle();
    expect(w.ws.closed).toBe(true);
  });
});

describe('Voicebot WebSocket endpoint', () => {
  it('refuses a connection without the secret; accepts it with ?t=<secret>', async () => {
    const server = createServer();
    attachExotelVoicebot(server, { engine: {} as never, provider: {} as never, store: {} as never, speech: new ScriptedSpeech(), log: silentLogger, secret: 'sek' });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const open = (q: string) => new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/exotel/voicebot${q}`);
      ws.on('open', () => { ws.close(); resolve('open'); });
      ws.on('error', () => resolve('refused'));
      ws.on('unexpected-response', () => resolve('refused'));
    });
    expect(await open('')).toBe('refused');
    expect(await open('?t=wrong')).toBe('refused');
    expect(await open('?t=sek')).toBe('open');
    await new Promise((r) => server.close(r));
  });
});
