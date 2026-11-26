/**
 * Scheduling hardening (v1.7, founder decisions 25 Nov 2026). See docs/architecture.md, section 4.
 *
 *  C. Dial limiter: never dial faster than the provider plan allows (calls per second, concurrent calls).
 *     Calls wait on our side instead of failing at the provider.
 *  B. Heartbeat: the engine records that it was alive each minute, so a late dose can tell "the engine was down"
 *     (then the dose is too late: missed, family told) from "the engine was busy dialling" (then it still calls).
 *  E. Sweeper: calls that never got a final status (lost webhook, crash) and groups that were never dialled are
 *     finished through the normal retry rules, so no dose stays "calling" for ever.
 *  F. Outage alert: doses missed because the engine was down are reported in one alert per person, not one per dose.
 */
import { MINUTE } from '../clock.js';
import { RULES } from '../contracts-values.js';
import { localDay } from '../scheduler/time.js';
import type { Deps } from './deps.js';
import { afterNoConfirmation, alertFor, consentUnanswered } from './calls.js';
import { decodeAttempt, encodeAttempt } from './deps.js';

// ---- C. dial limiter --------------------------------------------------------

/** Dial times of the last second, per engine (the limiter is per process; one engine instance today). */
const recentDials = new WeakMap<Deps, number[]>();
/** A call that has not ended within this long no longer counts as live (stale; the sweeper finishes it). */
const LIVE_WINDOW_MS = 15 * MINUTE;

/** Wait until a call may be dialled: at most `maxCallsPerSecond` per second and `maxConcurrentCalls` live calls. */
export async function acquireDialSlot(d: Deps): Promise<{ waitedMs: number }> {
  const { maxCallsPerSecond, maxConcurrentCalls, dialWaitMaxMs } = d.config;
  const started = d.clock.now().getTime();
  for (;;) {
    const now = d.clock.now().getTime();
    const dials = (recentDials.get(d) ?? []).filter((t) => t > now - 1000);
    recentDials.set(d, dials);
    const live = await d.store.countLiveCalls(new Date(now - LIVE_WINDOW_MS));
    if (dials.length < maxCallsPerSecond && live < maxConcurrentCalls) {
      dials.push(now);
      const waitedMs = now - started;
      if (waitedMs > 0) d.log.info('dial waited for a slot', { waitedMs, live });
      return { waitedMs };
    }
    if (now - started > dialWaitMaxMs) {
      // Better a late call than none: the limit protects the provider, but a dose must not be dropped here.
      d.log.warn('dial slot wait exceeded; dialling anyway', { waitedMs: now - started, live, maxConcurrentCalls });
      dials.push(now);
      return { waitedMs: now - started };
    }
    await (d.sleep ?? realSleep)(dials.length >= maxCallsPerSecond ? 250 : 1000);
  }
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- B. heartbeat --------------------------------------------------------------

const minuteKey = (at: Date) => `hb:${Math.floor(at.getTime() / MINUTE)}`;

/** Record that the engine is alive this minute (called every 30 s by main; kept 3 days). */
export async function heartbeat(d: Deps): Promise<void> {
  await d.sessions.incr(minuteKey(d.clock.now()), 3 * 24 * 3600);
}

/** Was the engine alive around `at` (that minute or the next)? */
export async function engineWasUp(d: Deps, at: Date): Promise<boolean> {
  return (await d.sessions.peek(minuteKey(at))) > 0 || (await d.sessions.peek(minuteKey(new Date(at.getTime() + MINUTE)))) > 0;
}

// ---- E. sweeper ------------------------------------------------------------------

/** Longer than any call can last: the hard Twilio time limit for a big call plus margin. */
export const STALE_CALL_MS = 15 * MINUTE;

/** Every 5 minutes: finish calls that never got a final status, and groups that were never dialled. */
export async function sweep(d: Deps): Promise<{ staleCalls: number; orphanGroups: number }> {
  const now = d.clock.now();
  const before = new Date(now.getTime() - STALE_CALL_MS);
  const stale = await d.store.listStaleCalls(before);
  for (const call of stale) {
    // Lost final webhook or a crash: close it, then the normal rules (retry in 10 minutes, or missed and the family told).
    await d.store.updateCall(call.id, { status: 'failed', endedAt: now });
    d.log.warn('stale call closed by sweeper', { callId: call.id, purpose: call.purpose });
    if (call.purpose === 'reminder' && call.callGroupId && (call.result === null || call.result === 'none')) {
      await afterNoConfirmation(d, call.callGroupId, call.attempt);
    } else if (call.purpose === 'consent' && call.personId && call.result === null) {
      await consentUnanswered(d, call.personId, call.attempt);
    }
  }
  const orphans = await d.store.listOrphanGroups(before);
  for (const groupId of orphans) {
    // Grouped but never dialled (crash between grouping and dialling): treat as an unanswered first call.
    d.log.warn('orphan group retried by sweeper', { groupId });
    await afterNoConfirmation(d, groupId, encodeAttempt(0, 0));
  }
  return { staleCalls: stale.length, orphanGroups: orphans.length };
}

// ---- F. one outage alert per person ---------------------------------------------

/** Doses marked missed because the engine was down are collected for this long, then reported together. */
export const OUTAGE_ALERT_DELAY_MS = 2 * MINUTE;

export async function queueOutageAlert(d: Deps, personId: string, at: Date, zone: string): Promise<void> {
  const date = localDay(at, zone).date;
  const bucket = Math.floor(d.clock.now().getTime() / (60 * MINUTE));
  await d.queue.add('outage.alert', { personId, localDate: date }, { delayMs: OUTAGE_ALERT_DELAY_MS, jobId: `outage_${personId}_${date}_${bucket}` });
}

/** Send one dose_missed alert (reason service_outage) listing every dose of the person missed without a call in the last 6 hours. */
export async function outageAlert(d: Deps, personId: string, localDate: string): Promise<void> {
  const person = await d.store.getPerson(personId);
  if (!person) return;
  const now = d.clock.now();
  const doses = await d.store.listDoses(personId, new Date(now.getTime() - 6 * 60 * MINUTE), now);
  const ids = doses.filter((x) => x.status === 'missed' && !x.callGroupId).map((x) => x.id);
  if (ids.length === 0) return;
  await alertFor(d, person, 'dose_missed', null, ids, `outage_${personId}_${localDate}_${Math.floor(now.getTime() / (60 * MINUTE))}`, 'service_outage');
}

// ---- A. daily cap: protect first attempts ----------------------------------------

/**
 * Calls of the 6/day cap that must stay free for first calls still to come today on this number (retries only use the rest).
 * Founder decision (25 Nov 2026): under pressure, retries are dropped before any dose goes uncalled.
 */
export async function reserveForFirstCalls(d: Deps, phone: string, zone: string, attemptCode: number): Promise<number> {
  if (decodeAttempt(attemptCode).n === 0) return 0; // a first call never reserves against itself
  const now = d.clock.now();
  const day = localDay(now, zone);
  return d.store.countUpcomingSlotsForPhone(phone, now, day.end);
}

export const DAILY_CAP = RULES.maxCallsPerNumberPerDay;
