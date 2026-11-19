import { randomUUID } from 'node:crypto';
import { hmacSha256Hex } from '../util/signature';
import { trialEnd } from './transitions';
import {
  PLANS, type BillingEvent, type BillingEventType, type BillingProvider, type PaidPlan, type StartResult, type Subscription,
  type SubscriptionStore,
} from './types';

/**
 * In-process stand-in for Razorpay Subscriptions. It keeps nothing real: startPaid leaves
 * the subscription past_due until a subscription.activated event arrives, like a real mandate
 * confirmed later by webhook. `signedEvent` builds a body and signature exactly as the
 * webhook handler expects, so tests exercise the same path a real provider would.
 */
export class FakeBillingProvider implements BillingProvider {
  readonly name = 'fake';
  private seq = 0;
  constructor(private readonly store: SubscriptionStore, private readonly webhookSecret: string) {}

  async startTrial(userId: string, now: Date): Promise<StartResult> {
    const sub: Subscription = {
      id: `fake_sub_${randomUUID()}`, userId, plan: 'trial', status: 'trialing',
      trialEndsAt: trialEnd(now).toISOString(), currentPeriodEnd: null, cancelledAt: null,
    };
    await this.store.save(sub);
    return { subscription: sub, checkout: { provider: 'fake', plan: 'trial', amountPaise: 0, currency: 'INR' } };
  }

  async startPaid(userId: string, plan: PaidPlan, _now: Date): Promise<StartResult> {
    const sub: Subscription = {
      id: `fake_sub_${randomUUID()}`, userId, plan, status: 'past_due',
      trialEndsAt: null, currentPeriodEnd: null, cancelledAt: null,
    };
    await this.store.save(sub);
    return { subscription: sub, checkout: { provider: 'fake', plan, amountPaise: PLANS[plan].pricePaise, currency: 'INR', method: 'upi_autopay' } };
  }

  /** Like the real API: asks the provider to cancel. The status changes when the subscription.cancelled event is handled. */
  async cancel(subscriptionId: string, _now: Date): Promise<Subscription> {
    const sub = await this.store.get(subscriptionId);
    if (!sub) throw new Error('unknown subscription');
    return sub;
  }

  event(type: BillingEventType, subscriptionId: string, at: Date, plan?: PaidPlan, id?: string): BillingEvent {
    return { id: id ?? `evt_fake_${++this.seq}_${randomUUID().slice(0, 8)}`, type, subscriptionId, occurredAt: at.toISOString(), plan };
  }

  /** Raw body and signature header value, as the provider would send them. */
  signedEvent(e: BillingEvent): { rawBody: string; signature: string } {
    const rawBody = JSON.stringify(e);
    return { rawBody, signature: hmacSha256Hex(this.webhookSecret, rawBody) };
  }
}
