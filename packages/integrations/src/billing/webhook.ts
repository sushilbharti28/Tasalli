import { verifyHmacSha256Hex } from '../util/signature';
import type { IdempotencyStore } from '../util/idempotency';
import type { Logger } from '../util/logger';
import { applySubscriptionEvent } from './transitions';
import type { BillingEvent, BillingEventType, SubscriptionStore } from './types';

export interface BillingWebhookDeps {
  store: SubscriptionStore;
  idempotency: IdempotencyStore;
  logger: Logger;
  /** From env BILLING_WEBHOOK_SECRET; the caller reads it. */
  secret: string;
}

export type WebhookOutcome =
  | { status: 401; result: 'bad_signature' }
  | { status: 400; result: 'bad_payload' }
  | { status: 200; result: 'applied' | 'duplicate' | 'ignored'; reason?: string };

const TYPES: BillingEventType[] = ['subscription.activated', 'payment.succeeded', 'payment.failed', 'trial.ended', 'subscription.cancelled'];

function parse(raw: string): BillingEvent | undefined {
  try {
    const e = JSON.parse(raw) as BillingEvent;
    if (typeof e.id === 'string' && e.id && typeof e.subscriptionId === 'string' && TYPES.includes(e.type) && !Number.isNaN(Date.parse(e.occurredAt))) return e;
  } catch { /* fallthrough */ }
  return undefined;
}

/**
 * Verifies the signature over the RAW body first (nothing else is trusted before that),
 * then applies the event exactly once: a repeated event id changes nothing. If saving fails
 * the claim is released so the provider's retry can succeed.
 */
export async function handleBillingWebhook(rawBody: string, signature: string | undefined, deps: BillingWebhookDeps): Promise<WebhookOutcome> {
  if (!verifyHmacSha256Hex(deps.secret, rawBody, signature)) {
    deps.logger.warn('billing webhook rejected: bad signature');
    return { status: 401, result: 'bad_signature' };
  }
  const event = parse(rawBody);
  if (!event) return { status: 400, result: 'bad_payload' };
  const key = `billing:${event.id}`;
  if (!(await deps.idempotency.claim(key))) return { status: 200, result: 'duplicate' };
  try {
    const sub = await deps.store.get(event.subscriptionId);
    if (!sub) {
      await deps.idempotency.complete(key);
      return { status: 200, result: 'ignored', reason: 'unknown_subscription' };
    }
    const r = applySubscriptionEvent(sub, event);
    if (r.applied) await deps.store.save(r.subscription);
    await deps.idempotency.complete(key);
    deps.logger.info(`billing event ${event.type} ${r.applied ? 'applied' : 'ignored'}`, { subscriptionId: sub.id, status: r.subscription.status });
    return r.applied ? { status: 200, result: 'applied' } : { status: 200, result: 'ignored', reason: r.reason };
  } catch (err) {
    await deps.idempotency.release(key);
    throw err;
  }
}
