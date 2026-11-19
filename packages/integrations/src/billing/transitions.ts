import { PLANS, TRIAL_DAYS, type BillingEvent, type Subscription } from './types';

export type TransitionResult =
  | { applied: true; subscription: Subscription }
  | { applied: false; reason: string; subscription: Subscription };

export function addPeriod(from: Date, period: 'month' | 'year'): Date {
  const d = new Date(from);
  if (period === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export function trialEnd(from: Date): Date {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 3600 * 1000);
}

/**
 * trialing -> active -> past_due -> cancelled, plus past_due -> active when payment recovers.
 * cancelled is final. Out-of-order or impossible events are ignored with a reason (a webhook
 * must still be answered 200), never thrown.
 */
export function applySubscriptionEvent(s: Subscription, e: BillingEvent): TransitionResult {
  const ignore = (reason: string): TransitionResult => ({ applied: false, reason, subscription: s });
  if (s.status === 'cancelled') return ignore('already_cancelled');
  const at = new Date(e.occurredAt);
  switch (e.type) {
    case 'subscription.activated': {
      if (s.status === 'active') return ignore('already_active');
      if (!e.plan || e.plan === ('trial' as string)) return ignore('plan_required');
      const period = PLANS[e.plan].period as 'month' | 'year';
      return { applied: true, subscription: { ...s, plan: e.plan, status: 'active', trialEndsAt: s.trialEndsAt, currentPeriodEnd: addPeriod(at, period).toISOString() } };
    }
    case 'payment.succeeded': {
      if (s.status === 'trialing' || s.plan === 'trial') return ignore('no_paid_plan');
      const base = s.currentPeriodEnd && new Date(s.currentPeriodEnd) > at ? new Date(s.currentPeriodEnd) : at;
      const period = PLANS[s.plan].period as 'month' | 'year';
      return { applied: true, subscription: { ...s, status: 'active', currentPeriodEnd: addPeriod(base, period).toISOString() } };
    }
    case 'payment.failed':
      if (s.status !== 'active') return ignore('not_active');
      return { applied: true, subscription: { ...s, status: 'past_due' } };
    case 'trial.ended':
      if (s.status !== 'trialing') return ignore('not_trialing');
      return { applied: true, subscription: { ...s, status: 'past_due' } };
    case 'subscription.cancelled':
      return { applied: true, subscription: { ...s, status: 'cancelled', cancelledAt: e.occurredAt } };
  }
}

/**
 * What the status allows. Assumption to confirm with the founder: past_due and cancelled
 * stop new reminder scheduling (cancelled keeps access to the end of the paid period).
 */
export function entitlement(s: Subscription, now: Date): { canSchedule: boolean; maxPeople: number; maxCallsPerDay: number | null } {
  const p = PLANS[s.plan];
  const paidThrough = s.currentPeriodEnd ? new Date(s.currentPeriodEnd) > now : false;
  const trialLive = s.status === 'trialing' && !!s.trialEndsAt && new Date(s.trialEndsAt) > now;
  const canSchedule = trialLive || s.status === 'active' || (s.status === 'cancelled' && s.plan !== 'trial' && paidThrough);
  return { canSchedule, maxPeople: p.maxPeople, maxCallsPerDay: p.maxCallsPerDay };
}
