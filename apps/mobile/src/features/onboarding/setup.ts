/**
 * Setup questions after sign-in (Phase 2, step 2): who, name, call language, medicine times.
 * Matches docs/prototypes/onboarding-v6.html. Answers live in a draft on this phone until the person can be saved:
 * yourself right after the questions, a loved one once their number is entered (the API places the consent call then).
 * Meal times have no API field until a medicine exists, so they are kept per person for the add-medicine flow.
 */
import type { CallLanguage, PersonCreate } from '@/api/types';
import { getJson, KEYS, removeItem, setJson } from '@/lib/storage';
import { DEFAULT_TIME_ZONE } from '@/lib/time';
import {
  ANY_TIME,
  dayOrder,
  inWindow,
  MEAL_WINDOWS,
  type Meal,
  type MealWindow,
} from '@/lib/meals';

export type Who = 'loved' | 'me';
export type SlotKey = 'bb' | 'ab' | 'bl' | 'al' | 'bd' | 'ad' | 'bt';
export type Food = 'before' | 'after' | 'any';

export interface Slot {
  key: SlotKey;
  meal: Meal;
  /** Food rule sent with the schedule. Bedtime has none. */
  food: Food;
  defaultTime: string;
}

export const SLOTS: readonly Slot[] = [
  { key: 'bb', meal: 'breakfast', food: 'before', defaultTime: '08:00' },
  { key: 'ab', meal: 'breakfast', food: 'after', defaultTime: '09:00' },
  { key: 'bl', meal: 'lunch', food: 'before', defaultTime: '13:00' },
  { key: 'al', meal: 'lunch', food: 'after', defaultTime: '14:00' },
  { key: 'bd', meal: 'dinner', food: 'before', defaultTime: '20:00' },
  { key: 'ad', meal: 'dinner', food: 'after', defaultTime: '21:00' },
  { key: 'bt', meal: 'bedtime', food: 'any', defaultTime: '22:30' },
];
export const slotOf = (k: SlotKey) => SLOTS.find((s) => s.key === k)!;

/** Before/after pairs that must stay in order. */
export const PAIRS: readonly [SlotKey, SlotKey, Meal][] = [
  ['bb', 'ab', 'breakfast'],
  ['bl', 'al', 'lunch'],
  ['bd', 'ad', 'dinner'],
];

export interface ExtraTime {
  id: number;
  time: string;
  food: Food;
}

/** Most calls a number gets in a day (safety rule 5). Medicines due at the same time share one call. */
export const MAX_TIMES = 6;
export const STEP_MINUTES = 15;
export const RELATIONS = ['papa', 'maa', 'dadi', 'dada', 'nani', 'nana'] as const;
export type Relation = (typeof RELATIONS)[number] | 'other';
/** Longest family word the family can type with "Other" (e.g. Chacha, Bua, Mausi). */
export const CUSTOM_RELATION_MAX = 20;

export const QUESTIONS = ['who', 'name', 'lang', 'when'] as const;
export type Question = (typeof QUESTIONS)[number] | 'phone';

export interface SetupDraft {
  step: Question;
  who: Who | null;
  name: string;
  rel: Relation | null;
  /** The family's own word when `rel` is 'other'. */
  relCustom: string;
  lang: CallLanguage;
  /** Picked meal slots and their time. */
  slots: Partial<Record<SlotKey, string>>;
  extra: ExtraTime[];
}

export const EMPTY_DRAFT: SetupDraft = {
  step: 'who',
  who: null,
  name: '',
  rel: null,
  relCustom: '',
  lang: 'hi',
  slots: {},
  extra: [],
};

/** Screens in order for this person; a loved one also needs a number. */
export function stepsFor(who: Who | null): Question[] {
  return who === 'me' ? [...QUESTIONS] : [...QUESTIONS, 'phone'];
}

export function windowOf(k: SlotKey): MealWindow {
  return MEAL_WINDOWS[slotOf(k).meal];
}
export { ANY_TIME };

export function timeCount(d: Pick<SetupDraft, 'slots' | 'extra'>): number {
  return Object.keys(d.slots).length + d.extra.length;
}

export type TimeProblem = { kind: 'window'; meal: Meal } | { kind: 'order'; meal: Meal };

/** Why the times can't be saved yet, if anything. The steppers keep times inside windows, so this is a backstop. */
export function timeProblems(d: Pick<SetupDraft, 'slots'>): TimeProblem[] {
  const out: TimeProblem[] = [];
  for (const s of SLOTS) {
    const v = d.slots[s.key];
    if (v !== undefined && !inWindow(MEAL_WINDOWS[s.meal], v))
      out.push({ kind: 'window', meal: s.meal });
  }
  for (const [b, a, meal] of PAIRS) {
    const tb = d.slots[b];
    const ta = d.slots[a];
    if (tb !== undefined && ta !== undefined && tb >= ta) out.push({ kind: 'order', meal });
  }
  return out;
}

/** Slots whose time is part of a problem, to mark them. */
export function badSlots(d: Pick<SetupDraft, 'slots'>): Set<SlotKey> {
  const bad = new Set<SlotKey>();
  for (const s of SLOTS) {
    const v = d.slots[s.key];
    if (v !== undefined && !inWindow(MEAL_WINDOWS[s.meal], v)) bad.add(s.key);
  }
  for (const [b, a] of PAIRS) {
    const tb = d.slots[b];
    const ta = d.slots[a];
    if (tb !== undefined && ta !== undefined && tb >= ta) {
      bad.add(b);
      bad.add(a);
    }
  }
  return bad;
}

export function canContinue(d: SetupDraft, step: Question): boolean {
  if (step === 'who') return d.who !== null;
  if (step === 'name') return d.name.trim().length > 0;
  if (step === 'when')
    return timeCount(d) > 0 && timeCount(d) <= MAX_TIMES && timeProblems(d).length === 0;
  return true;
}

/** One call time of the day: a meal slot or an extra time. */
export interface DayTime {
  time: string;
  food: Food;
  meal: Meal | null;
  slot?: SlotKey;
}

/** Every picked time, in the order of the day (05:00 first, bedtime after midnight last). */
export function dayTimes(d: Pick<SetupDraft, 'slots' | 'extra'>): DayTime[] {
  const meal = SLOTS.filter((s) => d.slots[s.key] !== undefined).map((s) => ({
    time: d.slots[s.key]!,
    food: s.food,
    meal: s.meal,
    slot: s.key,
  }));
  const extra = d.extra.map((x) => ({ time: x.time, food: x.food, meal: null }));
  return [...meal, ...extra].sort((a, b) => dayOrder(a.time) - dayOrder(b.time));
}

/** What the family calls them: a chip's word, their own word, or null (then the questions use "<first name> ji"). */
export function relationLabel(
  d: Pick<SetupDraft, 'rel' | 'relCustom'>,
  chipLabel: (r: Exclude<Relation, 'other'>) => string,
): string | null {
  if (!d.rel) return null;
  if (d.rel === 'other') return d.relCustom.trim().replace(/\s+/g, ' ') || null;
  return chipLabel(d.rel);
}

/** The API body. The calls greet by the full name; the relation word (or first name) is the family's label. */
export function personBody(
  d: SetupDraft,
  relationLabel: string | null,
  phone?: string,
): PersonCreate {
  const name = d.name.trim().replace(/\s+/g, ' ');
  return {
    isSelf: d.who === 'me',
    nickname: d.who === 'loved' && relationLabel ? relationLabel : name.split(' ')[0]!,
    fullName: name,
    ...(d.who === 'loved' && phone ? { phone } : {}),
    language: d.lang,
    // Times are kept in the person's time zone (safety rule 7). Setup assumes India; the old Add person form still offers others.
    timeZone: DEFAULT_TIME_ZONE,
  };
}

/** Next id for an extra time. */
export function nextExtraId(extra: ExtraTime[]): number {
  return extra.reduce((m, x) => Math.max(m, x.id), 0) + 1;
}

// Storage -----------------------------------------------------------------------------------------

export async function loadDraft(): Promise<SetupDraft> {
  const d = await getJson<Partial<SetupDraft>>(KEYS.setupDraft, {});
  return { ...EMPTY_DRAFT, ...d };
}
export async function saveDraft(d: SetupDraft): Promise<void> {
  await setJson(KEYS.setupDraft, d);
}
export async function clearDraft(): Promise<void> {
  await removeItem(KEYS.setupDraft);
}

/** Meal times the family picked, per person, so adding a medicine can offer them (step 4). */
export type SavedTimes = Pick<SetupDraft, 'slots' | 'extra'>;
export async function rememberTimes(personId: string, t: SavedTimes): Promise<void> {
  const map = await getJson<Record<string, SavedTimes>>(KEYS.mealTimes, {});
  map[personId] = { slots: t.slots, extra: t.extra };
  await setJson(KEYS.mealTimes, map);
}
export async function timesFor(personId: string): Promise<SavedTimes | null> {
  const map = await getJson<Record<string, SavedTimes>>(KEYS.mealTimes, {});
  return map[personId] ?? null;
}

// Where to go once the person exists (the navigator leaves setup when the account has people) -----

let afterSetup: { pathname: string; params: Record<string, string> } | null = null;
export function setAfterSetup(to: typeof afterSetup) {
  afterSetup = to;
}
export function takeAfterSetup() {
  const to = afterSetup;
  afterSetup = null;
  return to;
}
