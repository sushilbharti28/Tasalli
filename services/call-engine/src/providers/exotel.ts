/**
 * Exotel adapter (Indian caller ID, TRAI 1601 series). Status: built and unit-tested against Exotel's documented API;
 * not yet tried on a live Exotel account (needs KYC: see docs/exotel-onboarding.md).
 *
 * How a call works with Exotel (unlike Twilio, Exotel has no built-in speech):
 *  1. placeCall: POST /v1/Accounts/{sid}/Calls/connect with From = the parent, CallerId = our ExoPhone and Url = our
 *     Exotel call flow (App Bazaar app) whose only applet is a Voicebot applet pointing at wss://<us>/exotel/voicebot.
 *  2. When the parent answers, Exotel opens that WebSocket. ExotelVoicebotBridge plays our prompts (text to speech through
 *     SpeechProvider), listens (speech to text, keys), and feeds input events to the engine exactly like Twilio webhooks.
 *  3. Exotel posts the final call status to StatusCallback (/webhooks/exotel/status?c=<callId>&t=<secret>).
 * Exotel does not sign callbacks, so the status URL carries a secret token (EXOTEL_WEBHOOK_SECRET), checked here.
 */
import { timingSafeEqual } from 'node:crypto';
import type { CallEvent, NextAction, PlaceCallRequest, PlaceCallResult, TelephonyProvider } from '@tasalli/contracts';
import { WebhookPayloadError, WebhookSignatureError } from './fake-telephony.js';

export interface ExotelConfig {
  accountSid: string;
  apiKey: string;
  apiToken: string;
  /** API host, e.g. api.exotel.com or the India cluster your account is on (EXOTEL_SUBDOMAIN). */
  subdomain: string;
  /** App Bazaar app id of the call flow with the Voicebot applet (EXOTEL_APP_ID). */
  appId: string;
  /** Public base URL for StatusCallback, no trailing slash. */
  publicBaseUrl: string;
  /** Secret token in the status URL (EXOTEL_WEBHOOK_SECRET). */
  webhookSecret: string;
  fetch?: typeof fetch;
}

/** Exotel call statuses to ours. "in-progress" means answered. */
const STATUS: Record<string, Extract<CallEvent, { type: 'status' }>['status']> = {
  'ringing': 'ringing', 'in-progress': 'answered', 'answered': 'answered', 'completed': 'completed',
  'busy': 'busy', 'no-answer': 'no_answer', 'failed': 'failed', 'canceled': 'failed',
};

export class ExotelProvider implements TelephonyProvider {
  readonly name = 'exotel' as const;
  /** The first prompt of each call, until its stream starts (one engine instance; the bridge takes it on `start`). */
  private readonly firstSteps = new Map<string, PlaceCallRequest['firstStep']>();

  constructor(private readonly cfg: ExotelConfig) {
    for (const k of ['accountSid', 'apiKey', 'apiToken', 'subdomain', 'appId', 'publicBaseUrl', 'webhookSecret'] as const) {
      if (!cfg[k]) throw new Error(`Exotel config missing ${k}`);
    }
  }

  statusUrl(callId: string): string {
    return `${this.cfg.publicBaseUrl}/webhooks/exotel/status?c=${encodeURIComponent(callId)}&t=${encodeURIComponent(this.cfg.webhookSecret)}`;
  }

  async placeCall(req: PlaceCallRequest & { timeLimitSeconds?: number }): Promise<PlaceCallResult> {
    const body = new URLSearchParams({
      From: req.to,
      CallerId: req.callerId,
      Url: `http://my.exotel.com/${this.cfg.accountSid}/exoml/start_voice/${this.cfg.appId}`,
      CallType: 'trans', // service/transactional call (TRAI)
      TimeOut: '40',
      StatusCallback: this.statusUrl(req.callId),
      'StatusCallbackEvents[0]': 'terminal',
      'StatusCallbackEvents[1]': 'answered',
      StatusCallbackContentType: 'application/json',
      CustomField: req.callId,
    });
    if (req.timeLimitSeconds) body.set('TimeLimit', String(req.timeLimitSeconds));
    const auth = Buffer.from(`${this.cfg.apiKey}:${this.cfg.apiToken}`).toString('base64');
    const res = await (this.cfg.fetch ?? fetch)(`https://${this.cfg.subdomain}/v1/Accounts/${this.cfg.accountSid}/Calls/connect.json`, {
      method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Exotel connect failed: HTTP ${res.status}`); // body may echo the number: not logged
    const sid = (JSON.parse(text) as { Call?: { Sid?: string } }).Call?.Sid;
    if (!sid) throw new Error('Exotel connect: no Call.Sid in the response');
    this.firstSteps.set(sid, req.firstStep);
    return { providerCallId: sid };
  }

  /** The bridge takes the first prompt when the stream for this Exotel call starts. */
  takeFirstStep(providerCallId: string): PlaceCallRequest['firstStep'] | undefined {
    const s = this.firstSteps.get(providerCallId);
    this.firstSteps.delete(providerCallId);
    return s;
  }

  parseWebhook(headers: Record<string, string>, body: unknown): CallEvent {
    const url = new URL(headers['x-tasalli-url'] ?? 'http://invalid/');
    const token = url.searchParams.get('t') ?? '';
    if (!sameSecret(token, this.cfg.webhookSecret)) throw new WebhookSignatureError('bad exotel token');
    const callId = url.searchParams.get('c');
    const b = (body ?? {}) as Record<string, unknown>;
    const sid = String(b.CallSid ?? b.call_sid ?? '');
    const raw = String(b.Status ?? b.CallStatus ?? b.status ?? '').toLowerCase();
    const status = STATUS[raw];
    if (!callId || !sid || !status || !url.pathname.endsWith('/status')) throw new WebhookPayloadError('bad exotel status callback');
    const parsed = new Date(String(b.DateUpdated ?? b.EndTime ?? ''));
    const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed; // Exotel's date format is not documented: fall back to now
    return { type: 'status', eventId: `${sid}:${raw}`, callId, providerCallId: sid, status, at: at.toISOString() };
  }

  /** With Exotel the conversation runs over the Voicebot WebSocket; the bridge reads our NextAction as JSON. */
  renderNextAction(next: NextAction): { contentType: string; body: string } {
    return { contentType: 'application/json', body: JSON.stringify(next) };
  }
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
