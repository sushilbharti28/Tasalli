import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CallEvent, CallLanguage, CallStep, NextAction, PlaceCallRequest, PlaceCallResult, TelephonyProvider } from '@tasalli/contracts';
import type { AudioSource } from '../engine/deps.js';
import { WebhookPayloadError, WebhookSignatureError } from './fake-telephony.js';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** Public base URL, no trailing slash. Webhooks are <base>/webhooks/twilio/(status|input). */
  publicBaseUrl: string;
  fetch?: typeof fetch;
  /** Overrides, e.g. { hi: 'Polly.Aditi' }. */
  voices?: Partial<Record<CallLanguage, string>>;
  /** Record consent and reminder calls (mono). Default true; TWILIO_RECORD=false turns it off. */
  record?: boolean;
}

/** What the recording-status webhook tells us. Twilio sends RecordingStatus in-progress | completed | absent | failed. */
export interface RecordingEvent {
  callId: string;
  providerCallId: string;
  recordingSid: string;
  status: string;
  recordingUrl: string | null;
}

/** <Say> voice and language. v1.1 is Hindi only: Polly.Aditi (hi-IN), also for English text. Every other language falls back to Hindi. */
// TWILIO_VOICE picks the Hindi voice without a code change, e.g. Google.hi-IN-Chirp3-HD-Aoede or Polly.Kajal-Neural.
// Read at call time, not import time: .env is loaded after modules are imported.
const hindi = () => ({ voice: process.env.TWILIO_VOICE || 'Google.hi-IN-Chirp3-HD-Aoede', language: 'hi-IN' });
// Hindi only for now: every language, English included, uses the Hindi voice so accents don't mix within a call.
const voiceFor = (_language: CallLanguage) => hindi();
const HINTS = 'le li,le liya,haan,ho gaya,nahi,nahi li,baad mein,phir se,band karo';

/** "Audio" for Twilio is the text itself: <Say> speaks it. Format: say:<lang>:<base64url text>. */
export class SayUrls implements AudioSource {
  async urlFor(text: string, language: CallLanguage): Promise<string> {
    return `say:${language}:${Buffer.from(text, 'utf8').toString('base64url')}`;
  }
}

export function decodeSay(url: string): { language: CallLanguage; text: string } {
  const m = /^say:([a-z]{2}):([A-Za-z0-9_-]*)$/.exec(url);
  if (!m) throw new Error('not a say: URL');
  return { language: m[1] as CallLanguage, text: Buffer.from(m[2]!, 'base64url').toString('utf8') };
}

export const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted(key+value))). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

const STATUS: Record<string, Extract<CallEvent, { type: 'status' }>['status']> = {
  queued: 'ringing', initiated: 'ringing', ringing: 'ringing', 'in-progress': 'answered', answered: 'answered',
  completed: 'completed', busy: 'busy', 'no-answer': 'no_answer', failed: 'failed', canceled: 'failed',
};

export class TwilioProvider implements TelephonyProvider {
  // The contract's name union does not list 'twilio' yet (contract change requested in the PR).
  readonly name = 'twilio' as unknown as TelephonyProvider['name'];
  private readonly f: typeof fetch;

  constructor(private readonly cfg: TwilioConfig) {
    if (!cfg.accountSid || !cfg.authToken) throw new Error('Twilio needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    this.f = cfg.fetch ?? fetch;
  }

  private url(kind: 'status' | 'input' | 'recording', callId: string, nonce?: string): string {
    const q = new URLSearchParams({ c: callId, ...(nonce ? { n: nonce } : {}) });
    return `${this.cfg.publicBaseUrl}/webhooks/twilio/${kind}?${q}`;
  }

  async placeCall(req: PlaceCallRequest): Promise<PlaceCallResult> {
    const form = new URLSearchParams();
    form.set('To', req.to);
    form.set('From', req.callerId);
    form.set('Twiml', this.twiml(req.firstStep, req.callId));
    form.set('StatusCallback', this.url('status', req.callId));
    form.set('StatusCallbackMethod', 'POST');
    for (const e of ['ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', e);
    if ((this.cfg.record ?? true) && req.purpose !== 'test') { // the test call has no recording notice, so it is not recorded
      form.set('Record', 'true');
      form.set('RecordingChannels', 'mono');
      form.set('RecordingStatusCallback', this.url('recording', req.callId));
      form.set('RecordingStatusCallbackMethod', 'POST');
      form.set('RecordingStatusCallbackEvent', 'completed');
    }
    const res = await this.f(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Calls.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok || !json.sid) throw new Error(`Twilio placeCall failed: ${res.status} ${json.code ?? ''} ${json.message ?? ''}`.trim());
    return { providerCallId: json.sid };
  }

  private say(audioUrl: string): string {
    const { language, text } = decodeSay(audioUrl);
    const v = voiceFor(language);
    const voice = this.cfg.voices?.[language] ?? v.voice;
    return `<Say voice="${xmlEscape(voice)}" language="${v.language}">${xmlEscape(text)}</Say>`;
  }

  private twiml(step: CallStep, callId: string): string {
    const action = xmlEscape(this.url('input', callId, randomBytes(8).toString('hex')));
    if (!step.listen) return `<Response>${this.say(step.audioUrl)}<Hangup/></Response>`;
    const lang = voiceFor(decodeSay(step.audioUrl).language);
    const attrs = step.listen.speech
      ? `input="dtmf speech" language="${lang.language}" speechTimeout="auto" hints="${HINTS}"`
      : 'input="dtmf"';
    // No input: Gather falls through to the Redirect, which posts an empty input (a timeout) to the engine.
    return `<Response><Gather ${attrs} numDigits="1" timeout="${step.listen.timeoutSeconds}" action="${action}" method="POST">`
      + `${this.say(step.audioUrl)}</Gather><Redirect method="POST">${action}</Redirect></Response>`;
  }

  renderNextAction(next: NextAction, ctx?: { callId: string }): { contentType: string; body: string } {
    const callId = ctx?.callId ?? '';
    const body = next.action === 'hangup'
      ? `<Response>${next.finalAudioUrl ? this.say(next.finalAudioUrl) : ''}<Hangup/></Response>`
      : this.twiml(next.step, callId);
    return { contentType: 'text/xml', body: `<?xml version="1.0" encoding="UTF-8"?>${body}` };
  }

  /** Signed recording-status webhook (<base>/webhooks/twilio/recording). Not a CallEvent: the contract has no recording event yet. */
  parseRecordingWebhook(headers: Record<string, string>, body: unknown): RecordingEvent {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const params = (body ?? {}) as Record<string, string>;
    this.verify(h, params);
    const callId = new URL(h['x-tasalli-url']!).searchParams.get('c');
    if (!callId || !params.CallSid || !params.RecordingSid) throw new WebhookPayloadError('missing call or recording id');
    return { callId, providerCallId: params.CallSid, recordingSid: params.RecordingSid, status: params.RecordingStatus ?? '', recordingUrl: params.RecordingUrl || null };
  }

  private verify(h: Record<string, string>, params: Record<string, string>): void {
    const given = Buffer.from(h['x-twilio-signature'] ?? '', 'base64');
    const expected = Buffer.from(twilioSignature(this.cfg.authToken, h['x-tasalli-url'] ?? '', params), 'base64');
    if (given.length === 0 || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new WebhookSignatureError('invalid Twilio signature');
  }

  /**
   * Headers must include x-twilio-signature and x-tasalli-url (the full public URL Twilio called,
   * added by the server). Body is the parsed form fields.
   */
  parseWebhook(headers: Record<string, string>, body: unknown): CallEvent {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const params = (body ?? {}) as Record<string, string>;
    this.verify(h, params);

    const url = new URL(h['x-tasalli-url']!);
    const callId = url.searchParams.get('c');
    const sid = params.CallSid;
    if (!callId || !sid) throw new WebhookPayloadError('missing call id');
    const base = { callId, providerCallId: sid, at: new Date().toISOString() };

    if (url.pathname.endsWith('/status')) {
      const status = STATUS[params.CallStatus ?? ''];
      if (!status) throw new WebhookPayloadError('bad CallStatus');
      // SequenceNumber makes eventId unique per callback, so a retried callback is the same event.
      return { type: 'status', eventId: `${sid}:${params.CallStatus}:${params.SequenceNumber ?? ''}`, status, ...base };
    }
    const eventId = `${sid}:in:${url.searchParams.get('n') ?? h['i-twilio-idempotency-token'] ?? ''}`;
    if (params.Digits) return { type: 'input', eventId, kind: 'key', value: params.Digits.replace(/[^0-9*#]/g, '').slice(0, 1), ...base };
    const ev: CallEvent & { confidence?: number } = { type: 'input', eventId, kind: 'speech', ...base };
    if (params.SpeechResult) {
      ev.transcript = params.SpeechResult;
      if (params.Confidence !== undefined) ev.confidence = Number(params.Confidence);
    }
    return ev;
  }
}
