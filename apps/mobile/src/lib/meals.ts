/**
 * Meal windows: copy of MEAL_WINDOWS in packages/contracts/src/meals.ts (the app does not depend on the contracts
 * package; __tests__/setup-questions.test.ts fails if the two drift). The API rejects a schedule outside its window.
 */
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'bedtime';

/** Minutes after local midnight, inclusive. `to` < `from` when the window crosses midnight (bedtime). */
export interface MealWindow {
  from: number;
  to: number;
}

export const MEAL_WINDOWS: Record<Meal, MealWindow> = {
  breakfast: { from: 5 * 60, to: 11 * 60 + 30 },
  lunch: { from: 11 * 60, to: 16 * 60 },
  dinner: { from: 16 * 60 + 15, to: 23 * 60 + 30 },
  bedtime: { from: 20 * 60, to: 2 * 60 },
};

/** The whole day, for times not tied to a meal. */
export const ANY_TIME: MealWindow = { from: 0, to: 24 * 60 - 1 };

const DAY = 24 * 60;

/** "09:30" -> 570; NaN for anything else. */
export function minutesOf(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

export function hhmmOf(minutes: number): string {
  const v = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

export function inWindow(w: MealWindow, hhmm: string): boolean {
  const v = minutesOf(hhmm);
  if (Number.isNaN(v)) return false;
  return w.from <= w.to ? v >= w.from && v <= w.to : v >= w.from || v <= w.to;
}

/**
 * Move a time by `delta` minutes but never past either end of the window, so a picked time is always valid.
 * Works across midnight: positions are counted from the window's start.
 */
export function stepTime(w: MealWindow, hhmm: string, delta: number): string {
  const span = (w.to - w.from + DAY) % DAY;
  const cur = minutesOf(hhmm);
  const off = Number.isNaN(cur) ? 0 : (cur - w.from + DAY) % DAY;
  const start = off > span ? 0 : off;
  const next = Math.min(span, Math.max(0, start + delta));
  return hhmmOf(w.from + next);
}

/** Can the time still move this way inside the window? */
export function canStep(w: MealWindow, hhmm: string, delta: number): boolean {
  return stepTime(w, hhmm, delta) !== hhmm;
}

/** Order inside a day that starts at 05:00, so 00:30 (bedtime) sorts after 22:00. */
export function dayOrder(hhmm: string): number {
  return (minutesOf(hhmm) - 5 * 60 + DAY) % DAY;
}
