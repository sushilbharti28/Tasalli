import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CallEvent, NextAction, PlaceCallRequest, PlaceCallResult, TelephonyProvider,
} from '@tasalli/contracts';
import type { TestClock } from './clock';

/** Header carrying the HMAC-SHA256 of the raw JSON body, hex encoded. */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

export class WebhookSignatureError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export interface PlacedCall extends PlaceCallRequest {
  providerCallId: string;
  placedAt: string;
}

export type CallStatus = Extract<CallEvent, { type: 'status' }>['status'];

/**
 * In-memory TelephonyProvider for the scenario suites.
 *
 * - `placeCall` records the request and returns a provider call id.
 * - Webhooks are `{ event: CallEvent }` JSON bodies signed with HMAC-SHA256
 *   in the `x-fake-signature` header. `parseWebhook` throws
 *   WebhookSignatureError when the signature is missing or wrong.
 * - Test helpers (`signed`, `unsigned`, `tampered`, event builders) produce
 *   raw webhooks the way a real provider would deliver them.
 */
export class FakeTelephonyProvider implements TelephonyProvider {
  readonly name = 'fake' as const;
  readonly placed: PlacedCall[] = [];
  private failures = 0;
  private seq = 0;

  constructor(private readonly clock: TestClock, private readonly secret = 'test-only-webhook-secret') {}

  /** Make the next `n` placeCall calls throw (provider outage). */
  failNextPlaceCalls(n: number): void {
    this.failures += n;
  }

  async placeCall(req: PlaceCallRequest): Promise<PlaceCallResult> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('FakeProvider: simulated placeCall failure (HTTP 503)');
    }
    const providerCallId = `fake-${++this.seq}`;
    this.placed.push({ ...structuredClone(req), providerCallId, placedAt: this.clock.nowIso() });
    return { providerCallId };
  }

  parseWebhook(headers: Record<string, string>, body: unknown): CallEvent {
    const sig = lowerKeys(headers)[FAKE_SIGNATURE_HEADER];
    if (!sig) throw new WebhookSignatureError('Missing signature');
    const expected = this.sign(body);
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookSignatureError();
    const event = (body as { event?: CallEvent } | null)?.event;
    if (!event || typeof event !== 'object' || !('type' in event)) throw new Error('Malformed webhook body');
    return event;
  }

  renderNextAction(next: NextAction): { contentType: string; body: string } {
    return { contentType: 'application/json', body: JSON.stringify(next) };
  }

  // ---- helpers for tests ----

  sign(body: unknown): string {
    return createHmac('sha256', this.secret).update(JSON.stringify(body)).digest('hex');
  }

  signed(event: CallEvent): { headers: Record<string, string>; body: unknown } {
    const body = { event };
    return { headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: this.sign(body) }, body };
  }

  unsigned(event: CallEvent): { headers: Record<string, string>; body: unknown } {
    return { headers: { 'content-type': 'application/json' }, body: { event } };
  }

  /** Signed for one event, but the body was changed afterwards. */
  tampered(event: CallEvent, change: Partial<CallEvent>): { headers: Record<string, string>; body: unknown } {
    const good = this.signed(event);
    return { headers: good.headers, body: { event: { ...event, ...change } } };
  }

  statusEvent(call: PlacedCall, status: CallStatus, eventId = randomUUID()): CallEvent {
    return { type: 'status', eventId, callId: call.callId, providerCallId: call.providerCallId, status, at: this.clock.nowIso() };
  }

  keyEvent(call: PlacedCall, value: string, eventId = randomUUID()): CallEvent {
    return { type: 'input', eventId, callId: call.callId, providerCallId: call.providerCallId, kind: 'key', value, at: this.clock.nowIso() };
  }

  speechEvent(call: PlacedCall, transcript: string | undefined, eventId = randomUUID()): CallEvent {
    return { type: 'input', eventId, callId: call.callId, providerCallId: call.providerCallId, kind: 'speech', transcript, at: this.clock.nowIso() };
  }
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}
