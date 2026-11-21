/** Per-call pacing limits for reminder calls (founder decision, v1.4). */

/** A medicine can be repeated at most 2 times (heard 3 times in all). */
export const MAX_REPEATS_PER_MEDICINE = 2;

/** Soft time limit in seconds: 180 for up to 5 medicines, +40 for each medicine above 5. */
export function softLimitSeconds(medicines: number): number {
  return 180 + 40 * Math.max(0, medicines - 5);
}

/** Twilio's hard backstop on call creation: soft limit + 30 s. */
export const HARD_LIMIT_EXTRA_SECONDS = 30;
export function hardLimitSeconds(medicines: number): number {
  return softLimitSeconds(medicines) + HARD_LIMIT_EXTRA_SECONDS;
}
