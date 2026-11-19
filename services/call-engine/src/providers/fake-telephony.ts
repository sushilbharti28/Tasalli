import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { CallEvent, CallStep, NextAction, PlaceCallRequest, PlaceCallResult, TelephonyProvider } from '@tasalli/contracts';
import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';

export type FakeAnswer = 'answered' | 'no_answer' | 'busy' | 'failed';

/** What the person on the fake phone does at each listening step. */
export type FakeInput =
  | { key: string }
  /**
   * Spoken reply. By default the provider delivers a transcript. asAudio: deliver only an audio URL
   * so the engine must transcribe it with the SpeechProvider; confidence applies to that transcription.
   */
  | { say: string; confidence?: number; asAudio?: boolean }
  /** Says nothing until the step times out. */
  | { silence: true }
  /** Hangs up instead of answering. */
  | { hangup: true };

export interface FakeScenario {
  answer?: FakeAnswer;
  inputs?: FakeInput[];
  /** Deliver every webhook twice with the same event id. */
  duplicateWebhooks?: boolean;
  /** Deliver the duplicate copies concurrently instead of one after the other. */
  concurrentDuplicates?: boolean;
  /** Re-send the terminal status with a new event id (some providers retry with fresh ids). */
  resendTerminalWithNewId?: boolean;
  /** placeCall throws this message (provider outage). */
  placeCallError?: string;
  /** Sign webhooks with a wrong secret (they must be rejected). */
  badSignature?: boolean;
}

export interface FakeCallRecord {
  request: PlaceCallRequest;
  providerCallId: string;
  scenario: FakeScenario;
  state: 'pending' | 'done';
  /** Audio URLs played to the person, in order (including the final hangup audio). */
  played: string[];
  events: CallEvent[];
  responses: Array<{ status: number; body: string }>;
}

export type WebhookSink = (headers: Record<string, string>, body: unknown) => Promise<{ status: number; contentType: string; body: string }>;

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
const MAX_STEPS = 12;

/**
 * Test and local-dev telephony provider. Calls do not ring anything: a scripted scenario per
 * phone number decides whether the call is answered and what the person presses or says.
 * Every event goes through the same signed-webhook path as a real provider.
 */
export class FakeProvider implements TelephonyProvider {
  readonly name = 'fake' as const;
  readonly calls: FakeCallRecord[] = [];
  private scenarios = new Map<string, FakeScenario[]>();
  private sink: WebhookSink | null = null;
  private seq = 0;
  defaultScenario: FakeScenario = { answer: 'no_answer' };

  constructor(private readonly secret: string, private readonly clock: Clock = systemClock) {
    if (!secret) throw new Error('FakeProvider needs a webhook secret');
  }

  /** Queue scenarios for the next calls to this number (one per call, in order). */
  script(to: string, ...scenarios: FakeScenario[]): this {
    this.scenarios.set(to, [...(this.scenarios.get(to) ?? []), ...scenarios]);
    return this;
  }

  connect(sink: WebhookSink): void {
    this.sink = sink;
  }

  callsTo(to: string): FakeCallRecord[] {
    return this.calls.filter((c) => c.request.to === to);
  }

  async placeCall(req: PlaceCallRequest): Promise<PlaceCallResult> {
    if (!/^\+[1-9]\d{6,14}$/.test(req.to)) throw new Error('FakeProvider: "to" must be E.164');
    if (!req.firstStep?.audioUrl) throw new Error('FakeProvider: firstStep.audioUrl required');
    const queue = this.scenarios.get(req.to) ?? [];
    const scenario = queue.shift() ?? this.defaultScenario;
    if (scenario.placeCallError) throw new Error(scenario.placeCallError);
    const providerCallId = `fake-${++this.seq}-${randomUUID().slice(0, 8)}`;
    this.calls.push({ request: structuredClone(req), providerCallId, scenario, state: 'pending', played: [], events: [], responses: [] });
    return { providerCallId };
  }

  /** Play out every placed call that has not run yet. Returns how many ran. */
  async runPending(): Promise<number> {
    let n = 0;
    for (const call of this.calls) {
      if (call.state !== 'pending') continue;
      call.state = 'done';
      await this.run(call);
      n++;
    }
    return n;
  }

  private async run(call: FakeCallRecord): Promise<void> {
    const s = call.scenario;
    const answer = s.answer ?? 'answered';
    await this.send(call, { type: 'status', status: 'ringing' });
    if (answer !== 'answered') {
      await this.terminal(call, answer);
      return;
    }
    await this.send(call, { type: 'status', status: 'answered' });
    let step: CallStep | null = call.request.firstStep;
    call.played.push(step.audioUrl);
    const inputs = [...(s.inputs ?? [])];
    for (let i = 0; step?.listen && i < MAX_STEPS; i++) {
      const input = inputs.shift() ?? { silence: true as const };
      if ('hangup' in input) break;
      let ev: Record<string, unknown>;
      if ('key' in input) ev = { type: 'input', kind: 'key', value: input.key };
      else if ('say' in input && step.listen.speech) {
        ev = input.asAudio
          ? { type: 'input', kind: 'speech', audioUrl: fakeAudioUrl(input.say, input.confidence ?? 0.95) }
          : { type: 'input', kind: 'speech', transcript: input.say };
      } else ev = { type: 'input', kind: 'speech' }; // timeout, or speech while only keys are accepted
      const res = await this.send(call, ev);
      const next = res ? (JSON.parse(res.body) as NextAction) : ({ action: 'hangup' } as NextAction);
      if (next.action === 'hangup') {
        if (next.finalAudioUrl) call.played.push(next.finalAudioUrl);
        step = null;
      } else {
        step = next.step;
        call.played.push(step.audioUrl);
      }
    }
    await this.terminal(call, 'completed');
  }

  private async terminal(call: FakeCallRecord, status: 'completed' | 'no_answer' | 'busy' | 'failed') {
    await this.send(call, { type: 'status', status });
    if (call.scenario.resendTerminalWithNewId) await this.send(call, { type: 'status', status });
  }

  private async send(call: FakeCallRecord, partial: Record<string, unknown>) {
    if (!this.sink) throw new Error('FakeProvider: not connected to a webhook sink');
    const body = {
      ...partial,
      eventId: `${call.providerCallId}-e${call.events.length + 1}`,
      callId: call.request.callId,
      providerCallId: call.providerCallId,
      at: this.clock.now().toISOString(),
    };
    const headers = { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: sign(call.scenario.badSignature ? 'wrong-secret' : this.secret, body) };
    call.events.push(body as unknown as CallEvent);
    let res;
    if (call.scenario.duplicateWebhooks && call.scenario.concurrentDuplicates) {
      const both = await Promise.all([this.sink(headers, structuredClone(body)), this.sink(headers, structuredClone(body))]);
      res = both[0];
      call.responses.push(both[0], both[1]);
    } else {
      res = await this.sink(headers, body);
      call.responses.push(res);
      if (call.scenario.duplicateWebhooks) call.responses.push(await this.sink(headers, structuredClone(body)));
    }
    return res.status === 200 ? res : null;
  }

  parseWebhook(headers: Record<string, string>, body: unknown): CallEvent {
    const sig = lowerKeys(headers)[FAKE_SIGNATURE_HEADER];
    if (!sig || !verify(this.secret, body, sig)) throw new WebhookSignatureError('invalid fake signature');
    const b = body as Record<string, unknown>;
    const str = (k: string) => {
      const v = b[k];
      if (typeof v !== 'string' || v.length === 0) throw new WebhookPayloadError(`missing ${k}`);
      return v;
    };
    const base = { eventId: str('eventId'), callId: str('callId'), providerCallId: str('providerCallId'), at: str('at') };
    if (b.type === 'status') {
      const status = str('status');
      if (!['ringing', 'answered', 'no_answer', 'busy', 'failed', 'completed'].includes(status)) throw new WebhookPayloadError('bad status');
      return { type: 'status', ...base, status: status as 'ringing' };
    }
    if (b.type === 'input' && b.kind === 'key') return { type: 'input', ...base, kind: 'key', value: str('value') };
    if (b.type === 'input' && b.kind === 'speech') {
      const ev: CallEvent = { type: 'input', ...base, kind: 'speech' };
      if (typeof b.transcript === 'string') ev.transcript = b.transcript;
      if (typeof b.audioUrl === 'string') ev.audioUrl = b.audioUrl;
      return ev;
    }
    throw new WebhookPayloadError('unknown event');
  }

  renderNextAction(next: NextAction): { contentType: string; body: string } {
    return { contentType: 'application/json', body: JSON.stringify(next) };
  }
}

export class WebhookSignatureError extends Error {}
export class WebhookPayloadError extends Error {}

/** Stable JSON (sorted keys) so the signature does not depend on key order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function sign(secret: string, body: unknown): string {
  return createHmac('sha256', secret).update(canonicalJson(body)).digest('hex');
}

function verify(secret: string, body: unknown, sig: string): boolean {
  const expected = Buffer.from(sign(secret, body), 'hex');
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}

/** Spoken audio the FakeSpeech provider can "transcribe". */
export function fakeAudioUrl(transcript: string, confidence: number): string {
  return `fake-audio:${Buffer.from(JSON.stringify({ t: transcript, c: confidence })).toString('base64url')}`;
}
