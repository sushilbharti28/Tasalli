import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../src/clock.js';
import { defaultConfig } from '../src/engine/deps.js';
import { Engine } from '../src/engine/engine.js';
import { MemorySessionStore } from '../src/flows/session.js';
import { silentLogger } from '../src/log.js';
import { FakeSpeech } from '../src/providers/fake-speech.js';
import { SayUrls, TwilioProvider, twilioSignature } from '../src/providers/twilio.js';
import { MemoryQueue } from '../src/queue/memory.js';
import { LocalFsRecordingStorage, MemoryRecordingStorage } from '../src/recordings/storage.js';
import { TwilioRecordingClient } from '../src/recordings/twilio-client.js';
import { RECORDING_URL_PREFIX, type RecordingClient, type RecordingStorage } from '../src/recordings/types.js';
import { DEFAULT_SCRIPTS_DIR, ScriptLibrary } from '../src/scripts/loader.js';
import { createWebhookServer } from '../src/server.js';
import { MemoryStore } from '../src/store/memory.js';
import { SID, status } from './fixtures/twilio.js';

const BASE = 'https://t.example';
const TOKEN = 'tok';
const RSID = 'RE0123456789abcdef0123456789abcdef';
const RURL = `https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/${RSID}`;
const AUDIO = Buffer.from('ID3-pretend-mp3-bytes');

class FakeRecordingClient implements RecordingClient {
  downloads = 0;
  removed: string[] = [];
  failDownload = 0;
  failRemove = 0;
  shortBy = 0; // Content-Length says more than we got
  events: string[] = [];
  constructor(private readonly data = AUDIO) {}
  async download(url: string) {
    this.downloads++;
    this.events.push('download');
    if (this.failDownload-- > 0) throw new Error('network down');
    return { data: this.data, expectedSize: this.data.length + this.shortBy };
  }
  async remove(sid: string) {
    this.events.push('remove');
    if (this.failRemove-- > 0) throw new Error('twilio 500');
    this.removed.push(sid);
  }
}

function rig(storage: RecordingStorage = new MemoryRecordingStorage(), client = new FakeRecordingClient()) {
  const clock = new FakeClock('2026-03-10T03:00:00Z');
  const store = new MemoryStore();
  const queue = new MemoryQueue(clock);
  const placed: URLSearchParams[] = [];
  const f = (async (_u: string, init: RequestInit) => { placed.push(new URLSearchParams(init.body as string)); return new Response(JSON.stringify({ sid: SID }), { status: 201 }); }) as unknown as typeof fetch;
  const provider = new TwilioProvider({ accountSid: 'ACtest', authToken: TOKEN, publicBaseUrl: BASE, fetch: f });
  const engine = new Engine({ store, queue, provider, audio: new SayUrls(), speech: new FakeSpeech(), sessions: new MemorySessionStore(), clock,
    scripts: new ScriptLibrary(DEFAULT_SCRIPTS_DIR), log: silentLogger, config: defaultConfig({ publicBaseUrl: BASE, callerId: '+15005550006' }),
    recordings: { storage, client } });
  const errors: unknown[] = [];
  // Like BullMQ: a throwing job is retried (here: re-run by hand) rather than lost.
  queue.setHandler((n, d) => engine.handleJob(n, d));
  const user = store.addUser({ phone: '+919876543210', name: 'Rohit' });
  const mom = store.addPerson({ ownerUserId: user.id, phone: '+919876543210', nickname: 'Mummy', consent: 'pending' });
  const rec = (callId: string, params: Record<string, string>, token = TOKEN) => {
    const url = `${BASE}/webhooks/twilio/recording?c=${callId}`;
    return engine.handleRecordingWebhook({ 'x-tasalli-url': url, 'x-twilio-signature': twilioSignature(token, url, params) }, params);
  };
  const start = async () => {
    await queue.add('consent.call', { personId: mom.id });
    await queue.runDue();
    return new URL(placed[0]!.get('StatusCallback')!).searchParams.get('c')!;
  };
  /** Run the queued job; returns the error it threw, if any (BullMQ would retry). */
  const runJob = async (): Promise<string | null> => {
    try { await queue.runDue(); return null; } catch (e) { errors.push(e); return (e as Error).message; }
  };
  return { store, queue, engine, storage, client, rec, start, runJob, user, mom };
}
const params = (over: Record<string, string> = {}) => ({ ...status('completed'), RecordingSid: RSID, RecordingStatus: 'completed', RecordingUrl: RURL, RecordingChannels: '1', ...over });

describe('recording moves to India storage', () => {
  it('saves locally, sets our path in calls.recording_url, then deletes at Twilio (in that order)', async () => {
    const r = rig();
    const callId = await r.start();
    expect((await r.rec(callId, params())).status).toBe(200);
    expect(r.store.allCalls()[0]!.recordingUrl).toBeNull(); // nothing is stored until the copy is verified
    expect(await r.runJob()).toBeNull();
    const url = r.store.allCalls()[0]!.recordingUrl!;
    expect(url).toBe(`${RECORDING_URL_PREFIX}${callId}/${RSID}.mp3`);
    expect(url).not.toContain('twilio');
    expect((r.storage as MemoryRecordingStorage).files.get(`${callId}/${RSID}.mp3`)).toEqual(AUDIO);
    expect(r.client.removed).toEqual([RSID]);
    expect(r.client.events).toEqual(['download', 'remove']);
  });

  it('duplicate webhooks (Twilio retries) download and delete once', async () => {
    const r = rig();
    const callId = await r.start();
    for (let i = 0; i < 3; i++) expect((await r.rec(callId, params())).status).toBe(200);
    await r.runJob();
    expect((await r.rec(callId, params())).status).toBe(200); // after completion
    await r.runJob();
    expect(r.client.downloads).toBe(1);
    expect(r.client.removed).toEqual([RSID]);
  });

  it('download fails: nothing saved, nothing deleted at Twilio, retry succeeds', async () => {
    const r = rig();
    r.client.failDownload = 1;
    const callId = await r.start();
    await r.rec(callId, params());
    // The memory queue drops a failed job, so re-run the handler as BullMQ's retry would.
    await r.engine.handleJob('recording.fetch', { callId, recordingSid: RSID, recordingUrl: RURL }).catch(() => undefined);
    expect(r.client.removed).toEqual([]);
    expect(r.store.allCalls()[0]!.recordingUrl).toBeNull();
    await r.engine.handleJob('recording.fetch', { callId, recordingSid: RSID, recordingUrl: RURL });
    expect(r.client.removed).toEqual([RSID]);
    expect(r.store.allCalls()[0]!.recordingUrl).toContain(RSID);
  });

  it('delete fails: local copy is kept, the retry only deletes (no second download)', async () => {
    const r = rig();
    r.client.failRemove = 1;
    const callId = await r.start();
    const job = { callId, recordingSid: RSID, recordingUrl: RURL };
    await expect(r.engine.handleJob('recording.fetch', job)).rejects.toThrow('twilio 500');
    expect(r.store.allCalls()[0]!.recordingUrl).toContain(RSID); // already ours
    await r.engine.handleJob('recording.fetch', job);
    expect(r.client.downloads).toBe(1);
    expect(r.client.removed).toEqual([RSID]);
  });

  it('truncated download (Content-Length mismatch) is never saved or deleted', async () => {
    const r = rig();
    r.client.shortBy = 5;
    const callId = await r.start();
    await expect(r.engine.handleJob('recording.fetch', { callId, recordingSid: RSID, recordingUrl: RURL })).rejects.toThrow('truncated');
    expect((r.storage as MemoryRecordingStorage).files.size).toBe(0);
    expect(r.client.removed).toEqual([]);
    expect(r.store.allCalls()[0]!.recordingUrl).toBeNull();
  });

  it('empty download and a storage that loses the bytes both block the delete', async () => {
    const empty = rig(undefined, new FakeRecordingClient(Buffer.alloc(0)));
    const c1 = await empty.start();
    await expect(empty.engine.handleJob('recording.fetch', { callId: c1, recordingSid: RSID, recordingUrl: RURL })).rejects.toThrow('empty');
    expect(empty.client.removed).toEqual([]);

    const lossy: RecordingStorage = { put: async (_k, d) => ({ size: d.length }), size: async () => null, get: async () => null };
    const bad = rig(lossy);
    const c2 = await bad.start();
    await expect(bad.engine.handleJob('recording.fetch', { callId: c2, recordingSid: RSID, recordingUrl: RURL })).rejects.toThrow('mismatch');
    expect(bad.client.removed).toEqual([]);
    expect(bad.store.allCalls()[0]!.recordingUrl).toBeNull();
  });

  it('in-progress, bad signature and unknown call enqueue nothing', async () => {
    const r = rig();
    const callId = await r.start();
    expect((await r.rec(callId, params({ RecordingStatus: 'in-progress' }))).status).toBe(200);
    expect((await r.rec(callId, params(), 'wrong')).status).toBe(401);
    expect((await r.rec('00000000-0000-0000-0000-000000000000', params())).status).toBe(200);
    expect(r.queue.pendingJobs().filter((j) => j.name === 'recording.fetch')).toHaveLength(0);
  });

  it('webhook enqueues one job per RecordingSid', async () => {
    const r = rig();
    const callId = await r.start();
    await r.rec(callId, params());
    expect(r.queue.pendingJobs().some((j) => j.id === `recording_${RSID}`)).toBe(true);
  });
});

describe('TwilioRecordingClient', () => {
  it('GETs <RecordingUrl>.mp3 with basic auth and DELETEs the recording; 404 on delete is success', async () => {
    const calls: Array<{ url: string; method: string; auth: string }> = [];
    let deleteStatus = 204;
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', auth: (init.headers as Record<string, string>).authorization! });
      return init.method === 'DELETE' ? new Response(null, { status: deleteStatus }) : new Response(AUDIO, { status: 200, headers: { 'content-length': String(AUDIO.length) } });
    }) as unknown as typeof fetch;
    const c = new TwilioRecordingClient('ACtest', 'secret', f);
    const got = await c.download(RURL);
    expect(got.data).toEqual(AUDIO);
    expect(got.expectedSize).toBe(AUDIO.length);
    await c.remove(RSID);
    deleteStatus = 404;
    await c.remove(RSID);
    deleteStatus = 500;
    await expect(c.remove(RSID)).rejects.toThrow('500');
    expect(calls[0]).toMatchObject({ url: `${RURL}.mp3`, method: 'GET', auth: `Basic ${Buffer.from('ACtest:secret').toString('base64')}` });
    expect(calls[1]).toMatchObject({ url: `https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/${RSID}.json`, method: 'DELETE' });
  });

  it('never sends credentials to another host', async () => {
    const c = new TwilioRecordingClient('ACtest', 'secret', (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch);
    await expect(c.download('https://evil.example/Recordings/RE1')).rejects.toThrow('api.twilio.com');
    await expect(c.download('http://api.twilio.com/Recordings/RE1')).rejects.toThrow('api.twilio.com');
  });
});

describe('LocalFsRecordingStorage and the authenticated read route', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

  it('writes under RECORDINGS_DIR, reports size, rejects path tricks', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-'));
    const s = new LocalFsRecordingStorage(dir);
    expect(await s.size(`abc/${RSID}.mp3`)).toBeNull();
    expect(await s.put(`abc/${RSID}.mp3`, AUDIO, 'audio/mpeg')).toEqual({ size: AUDIO.length });
    expect(await readFile(join(dir, 'abc', `${RSID}.mp3`))).toEqual(AUDIO);
    expect(await readdir(join(dir, 'abc'))).toEqual([`${RSID}.mp3`]); // no .part left over
    await expect(s.put('../evil.mp3', AUDIO, 'audio/mpeg')).rejects.toThrow('bad recording key');
    await expect(s.get('abc/../../x.mp3')).rejects.toThrow('bad recording key');
  });

  it('serves a recording only with the bearer token; off when no token is configured', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-'));
    const storage = new LocalFsRecordingStorage(dir);
    await storage.put(`abc/${RSID}.mp3`, AUDIO, 'audio/mpeg');
    const r = rig(storage);
    const get = (port: number, path: string, auth?: string) => new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      request({ port, path, headers: auth ? { authorization: auth } : {} }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
    const path = `${RECORDING_URL_PREFIX}abc/${RSID}.mp3`;
    const on = createWebhookServer(r.engine, r.engine.d.provider, BASE, silentLogger, { storage, readToken: 's3cret' }).listen(0);
    const off = createWebhookServer(r.engine, r.engine.d.provider, BASE, silentLogger, { storage, readToken: undefined }).listen(0);
    try {
      const p = (on.address() as AddressInfo).port;
      expect((await get(p, path)).status).toBe(401);
      expect((await get(p, path, 'Bearer wrong!')).status).toBe(401);
      const ok = await get(p, path, 'Bearer s3cret');
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual(AUDIO);
      expect((await get(p, `${RECORDING_URL_PREFIX}abc/${'RE' + 'f'.repeat(32)}.mp3`, 'Bearer s3cret')).status).toBe(404);
      expect((await get((off.address() as AddressInfo).port, path, 'Bearer s3cret')).status).toBe(404);
    } finally {
      on.close(); off.close();
    }
  });
});
