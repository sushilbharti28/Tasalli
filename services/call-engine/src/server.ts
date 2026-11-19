import { createServer } from 'node:http';
import type { TelephonyProvider } from '@tasalli/contracts';
import type { Engine } from './engine/engine.js';
import type { Logger } from './log.js';

/** POST /webhooks/<provider>/(status|input|recording) and GET /health. The full public URL goes to the adapter in x-tasalli-url (Twilio signs the URL). */
export function createWebhookServer(engine: Engine, provider: TelephonyProvider, base: string, log: Logger) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    if (req.method === 'GET' && url.pathname === '/health') return void res.writeHead(200).end('ok');
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
