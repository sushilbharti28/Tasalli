import type { CallLanguage } from '@tasalli/contracts';

/**
 * A word that changes with grammatical gender (Hindi, Marathi).
 * m = masculine, f = feminine, n = neuter, obl = oblique (before a postposition).
 * Languages without agreement use a plain string.
 */
export type BlockWord = string | { m?: string; f?: string; n?: string; obl?: string };
export type WordForm = 'm' | 'f' | 'n' | 'obl';

export type ReviewStatus = 'needs_native_speaker_review' | 'approved';

export interface ScriptMeta {
  language: CallLanguage;
  name: string;
  version: number;
  review_status: ReviewStatus;
  approved_by: string | null;
  approved_on: string | null;
  reviewer_notes?: string[];
}

export interface ScriptTemplates {
  consent: {
    ask: string;
    agreed: string;
    declined: string;
    stopped: string;
    unclear: string;
    no_answer_goodbye: string;
  };
  reminder_full: {
    greeting: string;
    count_one: string;
    count_many: string;
    item: string;
    ask: string;
    more_options: string;
  };
  reminder_short: {
    single: string;
    group_greeting: string;
    group_item: string;
    ask: string;
  };
  test_call: { intro: string };
  repeat: { intro: string };
  unclear: { first: string; keypad: string; final: string };
  reply_ack: {
    confirmed: string;
    snoozed: string;
    snooze_used_up: string;
    not_taken: string;
    doctor_changed: string;
    unwell: string;
    stop: string;
    goodbye: string;
  };
  sunday: { new_strip: string };
}

export interface ScriptBuilding {
  appearance: { tablet: string; capsule: string; capsule_two_colour: string };
  pack: {
    strip: string;
    strip_with_print: string;
    loose: string;
    bottle: string;
    bottle_with_cap: string;
    cap_phrase: string;
  };
  disambiguator: { number: string; printed_name: string };
}

export const COLOUR_KEYS = [
  'white', 'cream', 'yellow', 'orange', 'pink', 'red', 'maroon', 'brown',
  'green', 'blue', 'purple', 'grey', 'black', 'silver', 'golden', 'transparent',
] as const;
export type ColourKey = (typeof COLOUR_KEYS)[number];

export const SHAPE_KEYS = ['round', 'oval', 'long', 'square'] as const;
export const SIZE_KEYS = ['rai', 'dal', 'matar', 'badam', 'bigger'] as const;
export const MARKING_KEYS = ['plain', 'line', 'letters', 'unknown'] as const;
export const FOOD_KEYS = ['before', 'after', 'with', 'any'] as const;
export const KIND_KEYS = ['tablet', 'capsule', 'syrup', 'other'] as const;

export interface ScriptBlocks {
  colours: Record<ColourKey, BlockWord>;
  shapes: Record<(typeof SHAPE_KEYS)[number], BlockWord>;
  sizes: Record<(typeof SIZE_KEYS)[number], BlockWord>;
  markings: Record<(typeof MARKING_KEYS)[number], BlockWord>;
  food: Record<(typeof FOOD_KEYS)[number], string>;
  kinds: Record<(typeof KIND_KEYS)[number], string>;
  /** ordinals[0] is "first medicine". At least 10 entries. */
  ordinals: string[];
  /** counts[0] is the word for 1. At least 10 entries. */
  counts: string[];
}

export const REMINDER_REPLY_LISTS = [
  'confirm', 'negative', 'snooze', 'repeat', 'doctor_changed', 'unwell', 'stop',
] as const;
export const CONSENT_REPLY_LISTS = ['consent_yes', 'consent_no', 'stop'] as const;
export type ReplyListName =
  | (typeof REMINDER_REPLY_LISTS)[number]
  | (typeof CONSENT_REPLY_LISTS)[number];

export type ScriptReplies = Record<ReplyListName, string[]>;

export interface ReminderSteps {
  /** Said alone first, then a 1 s pause ({person_name}); and the "you call it" sentence ({spoken_name}), left out when it equals the strip name. */
  greeting?: string; spoken_line?: string; presence?: string;
  intro_many: string; intro_one: string; short_intro_many: string; short_intro_one: string;
  item: string; item_one: string; item_short: string; item_short_one: string;
  meals: Record<'breakfast' | 'lunch' | 'dinner', string>;
  food_rel: Record<'before' | 'after' | 'with', string>;
  day_part: Record<'morning' | 'afternoon' | 'evening' | 'night', string>;
  relations: Partial<Record<'son' | 'daughter' | 'grandson' | 'granddaughter' | 'daughter_in_law' | 'son_in_law', string>>;
  count_words: string[];
  ack_next: string; ack_not_now: string; ack_silence: string; unclear: string;
  all_done: string; all_done_one: string; some_left: string; some_left_one: string;
  /** Optional: a medicine heard 3 times moves on; soft call time limit reached. */
  repeat_limit?: string; time_up?: string;
  /** Optional (v1.6): reminder opening that doubles as the presence check ({meal_phrase} {count_word}), and its re-ask. */
  reminder_presence?: string; reminder_presence_one?: string; presence_retry?: string; presence_retry_one?: string;
  /** Optional (v1.6): the question said after each medicine (after a longer pause), and the line before a medicine is played again after silence. */
  item_ask?: string; silence_repeat?: string;
  /** Optional (v1.6): after repeat_limit, "moving to the next one", and "we will call again" (only when a call really follows). */
  moving_on?: string; will_call_again?: string; end_no_call_back?: string;
  /** Optional (v1.6): how a medicine looks, as whole sentences. */
  look?: StepLook;
}

/** Appearance and pack sentences for the one-medicine-at-a-time call (v1.6). Sizes are three: very_small, small, large. */
export interface StepLook {
  sizes: Record<'very_small' | 'small' | 'large', BlockWord>;
  /** Colour word before "rang" (oblique); `coloured` wraps it per gender: {colour}. */
  colours: Record<string, string>;
  coloured: { f: string; m: string; obl: string };
  shapes: Record<string, string>;
  tablet: string; capsule: string; capsule_two_colour: string;
  markings: Record<string, string>;
  strip: string; print: string; loose: string; bottle: string; cap: string;
  number: string; printed_name: string;
}

export interface CallScript {
  meta: ScriptMeta;
  templates: ScriptTemplates;
  engine_extra: { child_fallback: string; list_and: string; declined_ack: string };
  /** One-medicine-at-a-time call lines (hi and en for now; other languages use the engine's built-ins). */
  reminder_steps?: ReminderSteps;
  building: ScriptBuilding;
  blocks: ScriptBlocks;
  replies: ScriptReplies;
}

/** Medicine fields as the family entered them (mirrors openapi Medicine + Schedule). */
export interface MedicineForCall {
  kind: (typeof KIND_KEYS)[number];
  spokenName: string;
  stripName: string;
  amountText: string;
  food: (typeof FOOD_KEYS)[number];
  colourPrimary?: string | null;
  colourSecondary?: string | null;
  shape?: string | null;
  size?: string | null;
  marking?: string | null;
  keptIn?: 'strip' | 'loose' | 'bottle' | null;
  packColour?: string | null;
  printColour?: string | null;
  capColour?: string | null;
  numberLabel?: number | null;
  sayPrintedName?: boolean;
  extraInstruction?: string | null;
}
