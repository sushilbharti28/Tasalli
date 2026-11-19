import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PaidPlan, PLANS } from './plans';

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

export interface StartSubscriptionResult {
  providerSubscriptionId: string;
  /** Whether the provider activated it at once (fake) or will confirm later by webhook (real). */
  activeNow: boolean;
  /** Passed to the app, e.g. Razorpay checkout options. */
  checkout: Record<string, unknown>;
}

/**
 * Billing behind an interface. Founder rule: no paid services yet, so only the fake
 * exists. A Razorpay implementation would return checkout options and activate the
 * subscription from its webhook.
 */
export interface BillingProvider {
  readonly name: string;
  startSubscription(userId: string, plan: PaidPlan): Promise<StartSubscriptionResult>;
}

@Injectable()
export class FakeBillingProvider implements BillingProvider {
  readonly name = 'fake';
  async startSubscription(_userId: string, plan: PaidPlan): Promise<StartSubscriptionResult> {
    return {
      providerSubscriptionId: `fake_sub_${randomUUID()}`,
      activeNow: true,
      checkout: { provider: 'fake', plan, amountPaise: PLANS[plan].pricePaise, currency: 'INR' },
    };
  }
}
