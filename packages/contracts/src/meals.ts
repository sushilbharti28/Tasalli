/**
 * Meals a schedule can be tied to, and the local times each allows (v1.8, onboarding).
 * The app limits its time pickers to these windows; the API rejects a schedule outside them.
 * Lunch ends at 16:00 and dinner starts at 16:15 so a time never belongs to two meals except breakfast/lunch 11:00-11:30.
 */
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'bedtime';

export interface MealWindow {
  /** Minutes after local midnight, inclusive. */
  from: number;
  /** Minutes after local midnight, inclusive. Smaller than `from` when the window crosses midnight (bedtime). */
  to: number;
}

export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'bedtime'];

export const MEAL_WINDOWS: Record<Meal, MealWindow> = {
  breakfast: { from: 5 * 60, to: 11 * 60 + 30 },
  lunch: { from: 11 * 60, to: 16 * 60 },
  dinner: { from: 16 * 60 + 15, to: 23 * 60 + 30 },
  bedtime: { from: 20 * 60, to: 2 * 60 },
};

/** "09:30" or "09:30:00" -> 570. Returns NaN for anything else. */
export function minutesOf(localTime: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(localTime);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

export function isInMealWindow(meal: Meal, localTime: string): boolean {
  const v = minutesOf(localTime);
  if (Number.isNaN(v)) return false;
  const w = MEAL_WINDOWS[meal];
  return w.from <= w.to ? v >= w.from && v <= w.to : v >= w.from || v <= w.to;
}
