import type { SubscriptionRow } from '../types.js';
import type { Deps } from './deps.js';

export const PAST_DUE_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Billing gate for reminder calls (consent calls are never gated).
 * Entitled = trialing, active, past_due within 3 days of becoming past_due, or cancelled but before current_period_end.
 * The grace period starts at subscriptions.past_due_since. Only if that is null (rows from before the column existed) do we
 * fall back to current_period_end. A past_due row with neither is not entitled (no evidence the grace period is still running).
 */
export function isEntitled(sub: SubscriptionRow, now: Date): boolean {
  const end = sub.currentPeriodEnd?.getTime() ?? null;
  const graceStart = sub.pastDueSince?.getTime() ?? end;
  switch (sub.status) {
    case 'trialing':
    case 'active':
      return true;
    case 'past_due':
      return graceStart !== null && now.getTime() <= graceStart + PAST_DUE_GRACE_DAYS * DAY_MS;
    case 'cancelled':
      return end !== null && now.getTime() < end;
    default:
      return false;
  }
}

/** An account is entitled if any of its subscription rows is. No rows: not entitled. */
export async function ownerEntitled(d: Deps, ownerUserId: string): Promise<boolean> {
  const now = d.clock.now();
  return (await d.store.listSubscriptions(ownerUserId)).some((s) => isEntitled(s, now));
}
