import { describe, expect, it } from 'vitest';
import {
  FakeBillingProvider, InMemoryIdempotencyStore, InMemorySubscriptionStore, MemoryLogger, PLANS, TRIAL_DAYS,
  entitlement, handleBillingWebhook, type BillingEventType, type PaidPlan,
} from '../src';

const SECRET = 'test-secret';
const T0 = new Date('2026-11-20T06:00:00Z');

function setup() {
  const store = new InMemorySubscriptionStore();
  const fake = new FakeBillingProvider(store, SECRET);
  const deps = { store, idempotency: new InMemoryIdempotencyStore(), logger: new MemoryLogger(), secret: SECRET };
  const send = async (type: BillingEventType, subId: string, at = T0, plan?: PaidPlan, id?: string) => {
    const { rawBody, signature } = fake.signedEvent(fake.event(type, subId, at, plan, id));
    return handleBillingWebhook(rawBody, signature, deps);
  };
  return { store, fake, deps, send };
}

describe('plans', () => {
  it('prices and limits', () => {
    expect(PLANS.one_parent).toMatchObject({ pricePaise: 29900, period: 'month', maxPeople: 1 });
    expect(PLANS.two_parents).toMatchObject({ pricePaise: 49900, period: 'month', maxPeople: 2 });
    expect(PLANS.family_yearly).toMatchObject({ pricePaise: 499900, period: 'year', maxPeople: 4 });
    expect(PLANS.trial).toMatchObject({ maxPeople: 1, maxCallsPerDay: 3 });
  });
});

describe('billing on the fake provider', () => {
  it('trial lasts 7 days with trial limits, then trial.ended makes it past_due', async () => {
    const { fake, send, store } = setup();
    const { subscription: s } = await fake.startTrial('u1', T0);
    expect(s.status).toBe('trialing');
    expect(new Date(s.trialEndsAt!).getTime() - T0.getTime()).toBe(TRIAL_DAYS * 86400_000);
    expect(entitlement(s, T0)).toEqual({ canSchedule: true, maxPeople: 1, maxCallsPerDay: 3 });
    await send('trial.ended', s.id);
    expect((await store.get(s.id))!.status).toBe('past_due');
    expect(entitlement((await store.get(s.id))!, T0).canSchedule).toBe(false);
  });

  it('trialing -> active -> past_due -> active -> cancelled', async () => {
    const { fake, send, store } = setup();
    const { subscription: s } = await fake.startTrial('u1', T0);
    expect((await send('subscription.activated', s.id, T0, 'two_parents')).result).toBe('applied');
    let cur = (await store.get(s.id))!;
    expect(cur).toMatchObject({ status: 'active', plan: 'two_parents', currentPeriodEnd: '2026-12-20T06:00:00.000Z' });
    expect(entitlement(cur, T0)).toEqual({ canSchedule: true, maxPeople: 2, maxCallsPerDay: null });

    await send('payment.failed', s.id);
    expect((await store.get(s.id))!.status).toBe('past_due');

    await send('payment.succeeded', s.id, new Date('2026-12-21T06:00:00Z'));
    cur = (await store.get(s.id))!;
    expect(cur.status).toBe('active');
    expect(cur.currentPeriodEnd).toBe('2027-01-21T06:00:00.000Z');

    await send('subscription.cancelled', s.id, new Date('2026-12-22T06:00:00Z'));
    cur = (await store.get(s.id))!;
    expect(cur.status).toBe('cancelled');
    expect(cur.cancelledAt).toBe('2026-12-22T06:00:00.000Z');
    // paid period still running
    expect(entitlement(cur, new Date('2026-12-30T00:00:00Z')).canSchedule).toBe(true);
    expect(entitlement(cur, new Date('2027-02-01T00:00:00Z')).canSchedule).toBe(false);
  });

  it('yearly plan renews for a year', async () => {
    const { fake, send, store } = setup();
    const { subscription: s } = await fake.startPaid('u1', 'family_yearly', T0);
    expect(s.status).toBe('past_due');
    await send('subscription.activated', s.id, T0, 'family_yearly');
    expect((await store.get(s.id))!.currentPeriodEnd).toBe('2027-11-20T06:00:00.000Z');
  });

  it('a repeated event id changes nothing (exactly once)', async () => {
    const { fake, send, store } = setup();
    const { subscription: s } = await fake.startPaid('u1', 'one_parent', T0);
    expect((await send('subscription.activated', s.id, T0, 'one_parent', 'evt_1')).result).toBe('applied');
    await send('payment.failed', s.id, T0, undefined, 'evt_2');
    await send('payment.succeeded', s.id, new Date('2026-12-20T06:00:00Z'), undefined, 'evt_3');
    const once = (await store.get(s.id))!.currentPeriodEnd;
    for (const id of ['evt_3', 'evt_3']) {
      expect((await send('payment.succeeded', s.id, new Date('2026-12-20T06:00:00Z'), undefined, id)).result).toBe('duplicate');
    }
    expect((await store.get(s.id))!.currentPeriodEnd).toBe(once); // not extended twice
  });

  it('rejects a bad or missing signature and a tampered body, without touching state', async () => {
    const { fake, deps, store } = setup();
    const { subscription: s } = await fake.startTrial('u1', T0);
    const { rawBody, signature } = fake.signedEvent(fake.event('subscription.cancelled', s.id, T0));
    expect((await handleBillingWebhook(rawBody, undefined, deps)).status).toBe(401);
    expect((await handleBillingWebhook(rawBody, 'deadbeef', deps)).status).toBe(401);
    expect((await handleBillingWebhook(rawBody + ' ', signature, deps)).status).toBe(401);
    expect((await store.get(s.id))!.status).toBe('trialing');
    // a rejected event did not burn its id
    expect((await handleBillingWebhook(rawBody, signature, deps)).result).toBe('applied');
  });

  it('ignores impossible transitions and unknown subscriptions with 200', async () => {
    const { fake, send, store } = setup();
    const { subscription: s } = await fake.startTrial('u1', T0);
    expect(await send('payment.failed', s.id)).toMatchObject({ status: 200, result: 'ignored', reason: 'not_active' });
    expect(await send('subscription.activated', s.id)).toMatchObject({ result: 'ignored', reason: 'plan_required' });
    expect(await send('payment.failed', 'nope')).toMatchObject({ status: 200, result: 'ignored', reason: 'unknown_subscription' });
    await send('subscription.cancelled', s.id);
    expect(await send('payment.succeeded', s.id)).toMatchObject({ result: 'ignored', reason: 'already_cancelled' });
    expect((await store.get(s.id))!.status).toBe('cancelled');
  });

  it('malformed signed payload gives 400', async () => {
    const { deps } = setup();
    const { hmacSha256Hex } = await import('../src');
    const raw = '{"nope":1}';
    expect((await handleBillingWebhook(raw, hmacSha256Hex(SECRET, raw), deps)).status).toBe(400);
  });
});
