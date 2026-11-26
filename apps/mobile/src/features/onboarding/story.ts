/**
 * Timeline for the first-run story (docs/prototypes/onboarding-v6.html): three scenes that move on
 * by themselves, with Skip. Everything on screen is derived from the time since the scene started,
 * so the screen stays a pure function of (scene, elapsed ms) and is easy to test.
 */
export const SCENES = ['worry', 'call', 'know'] as const;
export type SceneKey = (typeof SCENES)[number];

/** How long each scene stays before the next one starts (ms). The last scene waits for the user. */
export const DWELL: Record<SceneKey, number> = { worry: 5200, call: 10500, know: 6200 };

/** Worry scene: when each thought bubble pops in. */
export const THOUGHT_AT = [900, 2400] as const;
/** Know scene: when each notification drops in. */
/** Only final results are notified (taken, missed), never a retry in progress. */
export const NOTIFY_AT = [600, 2200] as const;

/** Call scene: the phone rings, connects, Tasalli speaks, then Papa answers. */
export const CALL = {
  connectAt: 2000,
  lastSecond: 9,
  tasalli: { start: 2300, dur: 4600 },
  reply: { start: 7500, dur: 1100 },
} as const;

/** The placeholder in a caption where the person's name goes (shown as a dashed blank). */
export const BLANK = '{blank}';

export function captionWords(text: string): string[] {
  return text.split(' ').filter(Boolean);
}

/** How many words of a caption have been spoken by time `t`. Word k starts at start + dur * k / n. */
export function wordsSaid(count: number, line: { start: number; dur: number }, t: number): number {
  if (count === 0 || t < line.start) return 0;
  return Math.min(count, Math.floor(((t - line.start) * count) / line.dur) + 1);
}

export type Speaking = 'idle' | 'talking' | 'done';
export function speaking(line: { start: number; dur: number }, t: number): Speaking {
  if (t < line.start) return 'idle';
  return t < line.start + line.dur ? 'talking' : 'done';
}

/** What the handset display shows: still ringing, or the call timer ("00:03"). */
export function callDisplay(t: number): { state: 'calling' } | { state: 'onCall'; time: string } {
  if (t < CALL.connectAt) return { state: 'calling' };
  const s = Math.min(CALL.lastSecond, 1 + Math.floor((t - CALL.connectAt) / 1000));
  return { state: 'onCall', time: `00:${String(s).padStart(2, '0')}` };
}

/**
 * The scene to move to at time `t`, or null to stay. Auto-advance is off when the user asked for
 * less motion or uses a screen reader, and it never leaves the last scene on its own.
 */
export function autoNext(index: number, t: number, auto: boolean): number | null {
  if (!auto || index >= SCENES.length - 1) return null;
  return t >= DWELL[SCENES[index]!] ? index + 1 : null;
}
