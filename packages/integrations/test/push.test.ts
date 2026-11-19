import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FcmPushSender, FakePushSender, fcmConfigFromEnv, createPushSenderFromEnv, type FetchFn } from '../src';

const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures/fcm', n), 'utf8'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const config = { projectId: 'tasalli-dev', clientEmail: 'push@tasalli-dev.iam.gserviceaccount.com', privateKey };

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };
function fakeFetch(sendResponses: Array<[number, unknown]>) {
  const calls: Call[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return { status: 200, json: async () => fx('token-ok.json') };
    const [status, body] = sendResponses.shift() ?? [500, {}];
    return { status, json: async () => body };
  };
  return { fn, calls };
}

const msg = { token: 'device-token-1', title: 'Papa', body: 'Not confirmed', data: { type: 'dose_missed' }, androidChannelId: 'alerts', tag: 'grp-1' };

describe('FcmPushSender', () => {
  it('mints an OAuth token with a signed JWT and sends the v1 message shape', async () => {
    const { fn, calls } = fakeFetch([[200, fx('send-ok.json')]]);
    const s = new FcmPushSender(config, fn);
    const r = await s.send(msg);
    expect(r).toEqual({ ok: true, messageId: fx('send-ok.json').name });

    const tokenCall = calls[0]!;
    const form = new URLSearchParams(tokenCall.init.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, p, sig] = form.get('assertion')!.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(claims).toMatchObject({ iss: config.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token' });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig!, 'base64url'))).toBe(true);

    const sendCall = calls[1]!;
    expect(sendCall.url).toBe('https://fcm.googleapis.com/v1/projects/tasalli-dev/messages:send');
    expect(sendCall.init.headers['authorization']).toBe('Bearer ya29.fake-access-token');
    expect(JSON.parse(sendCall.init.body)).toEqual({
      message: {
        token: 'device-token-1',
        notification: { title: 'Papa', body: 'Not confirmed' },
        data: { type: 'dose_missed' },
        android: { priority: 'HIGH', notification: { channel_id: 'alerts', tag: 'grp-1' } },
      },
    });
  });

  it('caches the access token across sends', async () => {
    const { fn, calls } = fakeFetch([[200, fx('send-ok.json')], [200, fx('send-ok.json')]]);
    const s = new FcmPushSender(config, fn);
    await s.send(msg);
    await s.send(msg);
    expect(calls.filter((c) => c.url.includes('oauth2')).length).toBe(1);
  });

  it('refreshes the token once on 401', async () => {
    const { fn, calls } = fakeFetch([[401, fx('send-unauthenticated.json')], [200, fx('send-ok.json')]]);
    const r = await new FcmPushSender(config, fn).send(msg);
    expect(r.ok).toBe(true);
    expect(calls.filter((c) => c.url.includes('oauth2')).length).toBe(2);
  });

  it.each([
    ['send-unregistered.json', 404, 'invalid_token'],
    ['send-invalid-token.json', 400, 'invalid_token'],
    ['send-invalid-payload.json', 400, 'error'],
    ['send-unavailable.json', 503, 'retryable'],
  ])('classifies %s as %s', async (file, status, reason) => {
    const { fn } = fakeFetch([[status as number, fx(file)]]);
    const r = await new FcmPushSender(config, fn).send(msg);
    expect(r).toMatchObject({ ok: false, reason });
  });

  it('treats network errors as retryable', async () => {
    const fn: FetchFn = async () => { throw new Error('ECONNRESET'); };
    expect(await new FcmPushSender(config, fn).send(msg)).toMatchObject({ ok: false, reason: 'retryable' });
  });
});

describe('FCM config from env', () => {
  it('reads the three variables, unescaping \\n in the key', () => {
    const c = fcmConfigFromEnv({ FIREBASE_PROJECT_ID: 'p', FIREBASE_CLIENT_EMAIL: 'e', FIREBASE_PRIVATE_KEY: 'a\\nb' });
    expect(c).toEqual({ projectId: 'p', clientEmail: 'e', privateKey: 'a\nb' });
  });
  it('reads the service account JSON', () => {
    const c = fcmConfigFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'p', client_email: 'e', private_key: 'k' }) });
    expect(c.projectId).toBe('p');
  });
  it('fails loudly when keys are missing', () => {
    expect(() => fcmConfigFromEnv({})).toThrow(/FIREBASE_PROJECT_ID/);
    expect(() => createPushSenderFromEnv({ NODE_ENV: 'production' })).toThrow(/FIREBASE_PROJECT_ID/);
  });
  it('defaults to the fake outside production', () => {
    expect(createPushSenderFromEnv({}).name).toBe('fake');
  });
});

describe('FakePushSender', () => {
  it('records, and simulates dead and flaky tokens', async () => {
    const f = new FakePushSender();
    f.markInvalid('dead');
    f.failNext('flaky');
    expect(await f.send({ ...msg, token: 'dead' })).toMatchObject({ ok: false, reason: 'invalid_token' });
    expect(await f.send({ ...msg, token: 'flaky' })).toMatchObject({ ok: false, reason: 'retryable' });
    expect(await f.send({ ...msg, token: 'flaky' })).toMatchObject({ ok: true });
    expect(f.sent).toHaveLength(1);
  });
});
