import { createServer } from 'node:http';
import type { TelephonyProvider } from '@tasalli/contracts';
import { timingSafeEqual } from 'node:crypto';
import type { RecordingStorage } from './recordings/types.js';
import { RECORDING_URL_PREFIX } from './recordings/types.js';
import type { Engine } from './engine/engine.js';
import type { Logger } from './log.js';

/** POST /webhooks/<provider>/(status|input|recording) and GET /health. The full public URL goes to the adapter in x-tasalli-url (Twilio signs the URL). */
export interface RecordingAccess {
  storage: RecordingStorage;
  /** Shared secret (env RECORDINGS_READ_TOKEN) the admin backend sends as `Authorization: Bearer <token>`. Unset: the route is off. */
  readToken: string | undefined;
}

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createWebhookServer(engine: Engine, provider: TelephonyProvider, base: string, log: Logger, recordings?: RecordingAccess) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    if (req.method === 'GET' && url.pathname === '/health') return void res.writeHead(200).end('ok');
    // Authenticated read of a stored recording: GET /internal/recordings/<callId>/<recordingSid>.mp3 (server-to-server, from the admin backend).
    if (req.method === 'GET' && url.pathname.startsWith(RECORDING_URL_PREFIX)) {
      const token = recordings?.readToken;
      const given = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
      if (!recordings || !token || !sameSecret(given, token)) return void res.writeHead(token ? 401 : 404).end();
      const file = await recordings.storage.get(url.pathname.slice(RECORDING_URL_PREFIX.length)).catch(() => null);
      if (!file) return void res.writeHead(404).end();
      return void res.writeHead(200, { 'content-type': file.mimeType, 'content-length': file.data.length, 'cache-control': 'private, no-store' }).end(file.data);
    }
    const m = /^\/webhooks\/([a-z]+)\/(status|input|recording)$/.exec(url.pathname);
    if (req.method !== 'POST' || !m || m[1] !== provider.name) return void res.writeHead(404).end();
    const raw = Buffer.concat((await req.toArray()) as Buffer[]).toString('utf8');
    const ctype = String(req.headers['content-type'] ?? '');
    let body: unknown;
    try {
      body = ctype.includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
    } catch {
      log.warn('webhook body not parseable', { path: url.pathname });
      return void res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request');
    }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    headers['x-tasalli-url'] = base + (req.url ?? '');
    const handle = m[2] === 'recording' ? engine.handleRecordingWebhook.bind(engine) : engine.handleWebhook.bind(engine);
    const out = await handle(headers, body).catch((e) => {
      log.error('webhook error', { err: String(e) });
      return { status: 500, contentType: 'text/plain', body: 'error' };
    });
    res.writeHead(out.status, { 'content-type': out.contentType }).end(out.body);
  });
}
