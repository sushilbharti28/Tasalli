import { createServer } from 'node:http';
import type { TelephonyProvider } from '@tasalli/contracts';
import type { Engine } from './engine/engine.js';
import type { Logger } from './log.js';

/** POST /webhooks/<provider>/(status|input) and GET /health. The full public URL goes to the adapter in x-tasalli-url (Twilio signs the URL). */
export function createWebhookServer(engine: Engine, provider: TelephonyProvider, base: string, log: Logger) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    if (req.method === 'GET' && url.pathname === '/health') return void res.writeHead(200).end('ok');
    const m = /^\/webhooks\/([a-z]+)\/(status|input)$/.exec(url.pathname);
    if (req.method !== 'POST' || !m || m[1] !== provider.name) return void res.writeHead(404).end();
    const raw = Buffer.concat((await req.toArray()) as Buffer[]).toString('utf8');
    const ctype = String(req.headers['content-type'] ?? '');
    const body = ctype.includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    headers['x-tasalli-url'] = base + (req.url ?? '');
    const out = await engine.handleWebhook(headers, body).catch((e) => {
      log.error('webhook error', { err: String(e) });
      return { status: 500, contentType: 'text/plain', body: 'error' };
    });
    res.writeHead(out.status, { 'content-type': out.contentType }).end(out.body);
  });
}
