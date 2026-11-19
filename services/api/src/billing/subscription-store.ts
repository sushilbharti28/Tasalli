import {
  entitlement, type IdempotencyStore, type Subscription, type SubscriptionStore,
} from '@tasalli/integrations';
import { Queryable } from '../db/db.service';

/** Founder decision: 3 days of access after a failed payment. */
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 3600 * 1000;

export interface SubRow {
  id: string;
  user_id: string;
  plan: Subscription['plan'];
  status: Subscription['status'];
  trial_ends_at: Date | null;
  razorpay_sub_id: string | null;
  current_period_end: Date | null;
  past_due_since: Date | null;
}

/** The provider's id is razorpay_sub_id; trial rows have none, so their own id stands in. */
export function rowToSub(r: SubRow): Subscription {
  return {
    id: r.razorpay_sub_id ?? r.id, userId: r.user_id, plan: r.plan, status: r.status,
    trialEndsAt: r.trial_ends_at?.toISOString() ?? null,
    currentPeriodEnd: r.current_period_end?.toISOString() ?? null,
    cancelledAt: null,
  };
}

/** Access rule: trialing, active, past_due for at most 3 days (paid plans), cancelled until period end. */
export function entitlementOf(r: SubRow, now: Date) {
  const base = entitlement(rowToSub(r), now);
  const graceEnd = r.status === 'past_due' && r.plan !== 'trial' && r.past_due_since
    ? new Date(r.past_due_since.getTime() + GRACE_DAYS * DAY_MS) : null;
  const inGrace = !!graceEnd && now < graceEnd;
  return { entitled: base.canSchedule || inGrace, graceEndsAt: graceEnd && r.status === 'past_due' ? graceEnd : null };
}

/** Writes a new state; past_due_since is set when the status turns past_due and cleared when it leaves it. */
export async function persistSub(q: Queryable, row: SubRow, next: Subscription, now: Date): Promise<void> {
  const pastDueSince = next.status === 'past_due' ? (row.status === 'past_due' ? row.past_due_since ?? now : now) : null;
  await q.query(
    `update subscriptions set plan = $2, status = $3, trial_ends_at = $4, current_period_end = $5, past_due_since = $6 where id = $1`,
    [row.id, next.plan, next.status, next.trialEndsAt, next.currentPeriodEnd, pastDueSince],
  );
}

export class PgSubscriptionStore implements SubscriptionStore {
  constructor(private readonly q: Queryable, private readonly now: () => Date) {}

  private async row(id: string): Promise<SubRow | undefined> {
    return (await this.q.query<SubRow>('select * from subscriptions where razorpay_sub_id = $1', [id])).rows[0];
  }
  async get(id: string) {
    const r = await this.row(id);
    return r && rowToSub(r);
  }
  async save(s: Subscription) {
    const r = await this.row(s.id);
    if (r) await persistSub(this.q, r, s, this.now());
  }
}

/** Exactly-once for billing events, on the webhook_events table (safety rule 6). */
export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly q: Queryable) {}
  private split(key: string): [string, string] {
    const i = key.indexOf(':');
    return [key.slice(0, i), key.slice(i + 1)];
  }
  async claim(key: string) {
    const [provider, id] = this.split(key);
    const r = await this.q.query('insert into webhook_events (provider, event_id) values ($1, $2) on conflict do nothing', [provider, id]);
    return r.rowCount === 1;
  }
  async complete() { /* the row is the record */ }
  async release(key: string) {
    const [provider, id] = this.split(key);
    await this.q.query('delete from webhook_events where provider = $1 and event_id = $2', [provider, id]);
  }
  async isCompleted(key: string) {
    const [provider, id] = this.split(key);
    return (await this.q.query('select 1 from webhook_events where provider = $1 and event_id = $2', [provider, id])).rows.length > 0;
  }
}
