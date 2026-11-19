/**
 * Billing behind an interface. Founder rule: no paid services, so only a fake exists.
 *
 * services/api (backend/v1) already owns plans, the trial constants, the `subscriptions`
 * table, `GET/POST /subscription` and a start-only `BillingProvider`. This module adds what
 * the API does not have: the status state machine, webhook-style events (signature check
 * and exactly-once handling), failed payment and cancel. The API can call
 * `applySubscriptionEvent` and `handleBillingWebhook` when it adds those endpoints.
 * Plan figures mirror services/api/src/billing/plans.ts (paise); keep the two in step.
 */
export const TRIAL_DAYS = 7;

export type PaidPlan = 'one_parent' | 'two_parents' | 'family_yearly';
export type Plan = 'trial' | PaidPlan;
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';

export const PLANS: Record<Plan, { pricePaise: number; period: 'none' | 'month' | 'year'; maxPeople: number; maxCallsPerDay: number | null }> = {
  trial: { pricePaise: 0, period: 'none', maxPeople: 1, maxCallsPerDay: 3 },
  one_parent: { pricePaise: 29900, period: 'month', maxPeople: 1, maxCallsPerDay: null },
  two_parents: { pricePaise: 49900, period: 'month', maxPeople: 2, maxCallsPerDay: null },
  family_yearly: { pricePaise: 499900, period: 'year', maxPeople: 4, maxCallsPerDay: null },
};

export interface Subscription {
  id: string;
  userId: string;
  plan: Plan;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
}

/** Webhook-style events. `id` is the provider's event id and is the idempotency key. */
export type BillingEventType =
  | 'subscription.activated'  // first payment authorised (UPI autopay mandate set) or trial converted
  | 'payment.succeeded'       // renewal charged
  | 'payment.failed'          // renewal failed
  | 'trial.ended'             // trial ran out with no paid plan
  | 'subscription.cancelled';

export interface BillingEvent {
  id: string;
  type: BillingEventType;
  subscriptionId: string;
  /** ISO UTC. */
  occurredAt: string;
  /** Required for subscription.activated. */
  plan?: PaidPlan;
}

export interface StartResult {
  subscription: Subscription;
  /** What the app would hand to a checkout. Fake: plain description, no real payment page. */
  checkout: Record<string, unknown>;
}

export interface BillingProvider {
  readonly name: string;
  /** Begins the 7-day trial (1 person, 3 calls/day). One trial per user. */
  startTrial(userId: string, now: Date): Promise<StartResult>;
  /** Starts a paid plan. A real provider confirms later by webhook; the fake does too (send subscription.activated). */
  startPaid(userId: string, plan: PaidPlan, now: Date): Promise<StartResult>;
  cancel(subscriptionId: string, now: Date): Promise<Subscription>;
}

export interface SubscriptionStore {
  get(id: string): Promise<Subscription | undefined>;
  save(s: Subscription): Promise<void>;
}

export class InMemorySubscriptionStore implements SubscriptionStore {
  readonly rows = new Map<string, Subscription>();
  async get(id: string) { const s = this.rows.get(id); return s && { ...s }; }
  async save(s: Subscription) { this.rows.set(s.id, { ...s }); }
}
