import type { CallerRelation, MedicineRow, PersonRow, ScheduleRow } from '../types.js';
import { joinSentences, render } from './render.js';
import { speakNumbers, scriptOf } from './spoken-numbers.js';
import type { ScriptTemplates, StepLook } from './templates.js';

/** Marks the end of the short greeting inside the opening prompt: the provider says the parts as separate <Say>s with a 1 s <Pause> between. */
export const SAY_BREAK = '\n';
/** A longer pause inside one prompt (before the question after each medicine). Twilio renders it as a longer SSML <break>; elsewhere it is a plain space. */
export const LONG_PAUSE = ' \u2016 ';
export const LONG_PAUSE_MARK = '\u2016';
/**
 * Splits a prompt into separate <Say>s with no pause between: the short acknowledgement ("ठीक है।") is synthesised alone and plays
 * at once, instead of waiting for the long next prompt to be synthesised (SSML synthesis is not streamed).
 */
export const SAY_SPLIT = '\u2029';
/** Text for anything that cannot render the longer pause or the split (plain-text speech, TTS files, logs): the marks become spaces. */
export const withoutPauseMarks = (text: string): string => text.split(/[\u2016\u2029]/).map((x) => x.trim()).filter(Boolean).join(' ');
/** "Ack. Rest" -> "Ack.<SAY_SPLIT>Rest" when the prompt starts with the acknowledgement; otherwise unchanged. */
export const splitAck = (ack: string, text: string): string => {
  const a = ack.trim();
  return a && text.startsWith(a) && text.length > a.length ? a + SAY_SPLIT + text.slice(a.length).trim() : text;
};

/** The call speaks three sizes. The app's older five map onto them (rai: very small; dal, matar: small; badam, bigger: large). */
export const SIZE_TO_THREE: Record<string, 'very_small' | 'small' | 'large'> = {
  very_small: 'very_small', small: 'small', large: 'large', rai: 'very_small', dal: 'small', matar: 'small', badam: 'large', bigger: 'large',
};

export interface ReminderItem {
  medicine: MedicineRow;
  schedule: ScheduleRow;
}

export interface ReminderScriptInput {
  templates: ScriptTemplates;
  person: Pick<PersonRow, 'nickname' | 'fullName'>;
  childName: string | null;
  items: ReminderItem[];
  /** full on the first answered call of the parent's day, short afterwards. */
  mode: 'full' | 'short';
  /** It is Sunday in the parent's time zone. */
  isSunday: boolean;
  /** Medicines already announced in an answered call today (Sunday line is said once per medicine per day). */
  announcedTodayMedicineIds: string[];
  /** Parent's local hour (0-23) of the dose time: picks the meal name and the day part. */
  localHour: number;
}

export function personName(t: ScriptTemplates, person: Pick<PersonRow, 'nickname' | 'fullName'>): string {
  // First word of the full name ("Ramesh Sharma" -> "Ramesh ji"). Never the nickname: it is the family's word for them
  // ("Mummy", "Papa"), not their name. With no full name the greeting is just "Namaste ji".
  const base = (person.fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return (base + t.words.person_suffix).trim();
}

export function childName(t: ScriptTemplates, name: string | null): string {
  return (name ?? '').trim() || t.words.child_fallback;
}

/** "Amlodac" -> "A-M-L-O-D-A-C"; words stay separated by a space. */
export function spellOut(stripName: string): string {
  return stripName
    .trim()
    .split(/\s+/)
    .map((w) => [...w.toUpperCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join('-'))
    .filter(Boolean)
    .join(' ');
}

type Form = 'm' | 'f' | 'obl';
type WordGroup = 'colours' | 'shapes' | 'sizes';

/**
 * Word for a key. In Hindi the colour, shape and size words agree with the noun they describe
 * (tablet: feminine, capsule: masculine, strip: oblique, bottle: feminine, cap: masculine); the forms come from
 * `words_gendered`. A word without a gendered entry (e.g. white) is the same in every form.
 */
function word(t: ScriptTemplates, group: WordGroup, key: string | null, form?: Form): string {
  if (!key) return '';
  const k = t.words[group][key] !== undefined ? key : key.toLowerCase();
  const g = form ? t.words_gendered?.[group]?.[k]?.[form] : undefined;
  return g ?? t.words[group][k] ?? key; // unknown values are spoken as entered
}

export function appearancePhrase(t: ScriptTemplates, m: MedicineRow): string {
  if (m.kind !== 'tablet' && m.kind !== 'capsule') return '';
  const w = t.words;
  const f: Form = m.kind === 'tablet' ? 'f' : 'm'; // tablet (goli) is feminine, capsule masculine
  const colour = m.kind === 'capsule' && m.colourSecondary
    ? render(w.two_colour, { colour: word(t, 'colours', m.colourPrimary, f), colour2: word(t, 'colours', m.colourSecondary, f) })
    : word(t, 'colours', m.colourPrimary, f);
  return render(w.appearance, {
    size: word(t, 'sizes', m.size, f), colour, shape: word(t, 'shapes', m.shape, f), kind: w.kinds[m.kind] ?? m.kind,
    marking: m.marking ? (w.markings[m.marking] ?? '') : '',
  });
}

export function packPhrase(t: ScriptTemplates, m: MedicineRow): string {
  if (!m.keptIn) return '';
  const w = t.words;
  return render(w.pack[m.keptIn], {
    pack_colour: word(t, 'colours', m.packColour, m.keptIn === 'strip' ? 'obl' : 'f'),
    print_phrase: m.printColour ? render(w.print_phrase, { print_colour: word(t, 'colours', m.printColour, 'f') }) : '', // likhai: feminine
    cap_phrase: m.capColour ? render(w.cap_phrase, { cap_colour: word(t, 'colours', m.capColour, 'm') }) : '', // dhakkan: masculine
  });
}

export function disambiguator(t: ScriptTemplates, m: MedicineRow): string {
  if (m.numberLabel !== null && m.numberLabel !== undefined) return render(t.words.disambiguator_number, { number: m.numberLabel });
  if (m.sayPrintedName) return render(t.words.disambiguator_printed_name, { strip_letters: spellOut(m.stripName) });
  return '';
}

/**
 * v1.6: how a medicine looks, as whole sentences ("Yeh ek chhoti si safed rang ki gol aakar ki goli hai. Iska patta laal rang ka hai.").
 * Only appearance fields are used (safety rule 2); family-typed values are never changed.
 */
export function lookSentences(t: ScriptTemplates, L: StepLook, m: MedicineRow): { appearance: string; pack: string; disambiguator: string } {
  const g = (form: 'f' | 'm' | 'obl', key: string | null | undefined) => {
    if (!key) return '';
    const stem = L.colours[key] ?? L.colours[key.toLowerCase()] ?? key; // unknown values are spoken as entered
    return render(L.coloured[form], { colour: stem });
  };
  const sizeWord = (f: 'f' | 'm') => {
    const k = m.size ? SIZE_TO_THREE[m.size] ?? m.size : null;
    const v = k ? L.sizes[k] : undefined;
    return typeof v === 'string' ? v : (v?.[f] ?? '');
  };
  const sentences: string[] = [];
  if (m.kind === 'tablet') {
    sentences.push(render(L.tablet, { size: sizeWord('f'), colour: g('f', m.colourPrimary), shape: m.shape ? (L.shapes[m.shape] ?? m.shape) : '' }));
    const mark = m.marking ? L.markings[m.marking] : '';
    if (mark) sentences.push(mark);
  } else if (m.kind === 'capsule') {
    sentences.push(m.colourSecondary
      ? render(L.capsule_two_colour, { colour: word(t, 'colours', m.colourPrimary, 'm'), colour2: word(t, 'colours', m.colourSecondary, 'm') })
      : render(L.capsule, { size: sizeWord('m'), colour: g('m', m.colourPrimary) }));
  }
  const pack: string[] = [];
  if (m.keptIn === 'strip' && m.packColour) pack.push(render(L.strip, { pack_colour: g('m', m.packColour) })); // patta: masculine
  if (m.keptIn === 'strip' && m.printColour) pack.push(render(L.print, { print_colour: g('obl', m.printColour) }));
  if (m.keptIn === 'bottle' && m.packColour) pack.push(render(L.bottle, { pack_colour: g('f', m.packColour) })); // bottle: feminine
  if (m.keptIn === 'bottle' && m.capColour) pack.push(render(L.cap, { cap_colour: g('m', m.capColour) })); // dhakkan: masculine
  if (m.keptIn === 'loose') pack.push(L.loose);
  const dis = m.numberLabel !== null && m.numberLabel !== undefined ? render(L.number, { number: m.numberLabel })
    : m.sayPrintedName ? render(L.printed_name, { strip_letters: spellOut(m.stripName) }) : '';
  return { appearance: joinSentences(sentences), pack: joinSentences(pack), disambiguator: dis };
}

export function foodPhrase(t: ScriptTemplates, food: ScheduleRow['food'], localHour: number): string {
  const morning = localHour < 11 ? t.words.food_morning?.[food] : undefined;
  return morning ?? t.words.food[food] ?? '';
}

export function buildReminderText(input: ReminderScriptInput, mode: 'full' | 'short' = input.mode): string {
  const t = input.templates;
  const r = t.reminder;
  const person_name = personName(t, input.person);
  const child_name = childName(t, input.childName);
  const count = input.items.length;
  const parts: string[] = [];

  if (mode === 'full') {
    parts.push(render(count === 1 && r.full_intro_one ? r.full_intro_one : r.full_intro, { person_name, child_name, count, dose_unit: count === 1 ? t.words.dose_unit.one : t.words.dose_unit.many }));
    input.items.forEach((it, i) => {
      parts.push(render(r.full_item, {
        ordinal: count > 1 ? (t.words.ordinals[i] ?? String(i + 1)) : '',
        spoken_name: it.medicine.spokenName,
        amount_text: it.schedule.amountText,
        appearance_phrase: appearancePhrase(t, it.medicine),
        pack_phrase: packPhrase(t, it.medicine),
        disambiguator: disambiguator(t, it.medicine),
        food_phrase: foodPhrase(t, it.schedule.food, input.localHour),
        extra_instruction: it.medicine.extraInstruction,
      }));
    });
  } else if (count === 1 && r.short_single && sundayLines(input).length === 0) {
    const it = input.items[0]!;
    // One sentence including its own outro, so nothing else is appended.
    return joinSentences([render(r.short_single, {
      person_name, child_name, spoken_name: it.medicine.spokenName, amount_text: it.schedule.amountText,
      disambiguator: disambiguator(t, it.medicine), food_phrase: foodPhrase(t, it.schedule.food, input.localHour),
      extra_instruction: it.medicine.extraInstruction,
    })]);
  } else {
    const names = input.items.map((it) => it.medicine.spokenName);
    const joined = names.length <= 1 ? (names[0] ?? '')
      : names.slice(0, -1).join(t.words.list_joiner) + t.words.list_last_joiner + names[names.length - 1];
    parts.push(render(r.short_intro, { person_name, child_name, names: joined }));
    for (const it of input.items) {
      parts.push(render(r.short_item, {
        spoken_name: it.medicine.spokenName,
        amount_text: it.schedule.amountText,
        disambiguator: disambiguator(t, it.medicine),
        food_phrase: foodPhrase(t, it.schedule.food, input.localHour),
        extra_instruction: it.medicine.extraInstruction,
      }));
    }
  }
  parts.push(...sundayLines(input));
  parts.push(mode === 'full' ? r.full_outro : r.short_outro);
  return joinSentences(parts);
}

export interface ReminderSteps {
  /** Intro, then the first medicine: one prompt (the call needs one listen step). */
  opening: string;
  /** Said first and alone: "Namaste Ramesh ji." then a pause, then `presence` ("can you hear me?"). Only after a yes does `opening` play. */
  greeting: string;
  presence: string;
  /** Re-ask when the presence answer was not a yes (v1.6); falls back to `presence`. */
  presenceRetry: string;
  /** Per medicine: `first` is said the first time (full or short mode), `full` is the repeat for key 0 / "phir se". */
  items: Array<{ first: string; full: string }>;
}

/** {relation_phrase} for the consent call only ("aapke bete"); empty when the relation is unknown or "other". */
export function relationPhrase(t: ScriptTemplates, rel: CallerRelation | null | undefined): string {
  return (rel && t.reminder.step_relations?.[rel as keyof ScriptTemplates['reminder']['step_relations']]) || '';
}

/** {meal_phrase}: "dopahar ke khane ke baad" for food rules, "dopahar ki" when the dose has no food rule. */
export function mealPhrase(t: ScriptTemplates, food: ScheduleRow['food'], hour: number): string {
  const r = t.reminder;
  if (food === 'any') return r.step_day_part[hour < 11 ? 'morning' : hour < 16 ? 'afternoon' : hour < 19 ? 'evening' : 'night'];
  const meal = r.step_meals[hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : 'dinner'];
  return `${meal} ${r.step_food_rel[food]}`;
}

/**
 * One-medicine-at-a-time script (v1.3). Same inputs as buildReminderText; full on the first call of the day, short afterwards.
 * The call's doses share one food timing (the scheduler groups that way), so it is said once in the intro and left out of the item lines.
 */
export function buildReminderSteps(input: ReminderScriptInput): ReminderSteps {
  const t = input.templates, r = t.reminder;
  const script = scriptOf(r.step_ack_next);
  const spoken = (x: string) => speakNumbers(x, script); // speech only: digits become words, the stored values are not touched
  const person_name = personName(t, input.person);
  const count = input.items.length;
  const count_word = r.step_count_words[count - 1] ?? String(count);
  const meal_phrase = mealPhrase(t, input.items[0]?.schedule.food ?? 'any', input.localHour);
  const seenNumbers = new Set(input.announcedTodayMedicineIds);
  const items = input.items.map((it, i) => {
    const m = it.medicine;
    const strip = m.stripName.trim();
    const common = {
      ordinal: t.words.ordinals[i] ?? String(i + 1), strip_name: strip, strength: (m.strengthText ?? '').trim(),
      // "Jise aap Sugar wali kehte hain." is left out when the family's name is the printed name.
      spoken_line: m.spokenName.trim().toLowerCase() === strip.toLowerCase() || !r.step_spoken_line ? '' : render(r.step_spoken_line, { spoken_name: m.spokenName }),
      spoken_name: m.spokenName, amount_text: it.schedule.amountText,
      disambiguator: disambiguator(t, m), extra_instruction: m.extraInstruction,
    };
    const look = r.step_look ? lookSentences(t, r.step_look, m) : null;
    if (look) common.disambiguator = look.disambiguator;
    // The question after each medicine comes after a longer pause (LONG_PAUSE), so the description and the question do not run together.
    // Speech only: whole-sentence pieces followed by the template's own full stop would say "hai.." / "है।।"; one mark is enough.
    const tidy = (text: string) => text.replace(/([.।!?])(?:\s*[.।])+/g, '$1');
    const withAsk = (text: string) => { const x = tidy(text); return r.step_item_ask ? x + LONG_PAUSE + spoken(r.step_item_ask) : x; };
    const full = withAsk(spoken(render(count === 1 ? r.step_item_one : r.step_item, {
      ...common, appearance_phrase: look ? look.appearance : appearancePhrase(t, m), pack_phrase: look ? look.pack : packPhrase(t, m) })));
    const short = withAsk(spoken(render(count === 1 ? r.step_item_short_one : r.step_item_short, common)));
    const sunday = input.isSunday && m.numberLabel !== null && m.numberLabel !== undefined && !seenNumbers.has(m.id)
      ? spoken(render(r.sunday_line, { number: m.numberLabel, spoken_name: m.spokenName })) : ''; // said once per medicine per day
    if (sunday) seenNumbers.add(m.id);
    return { first: joinSentences([sunday, input.mode === 'full' ? full : short]), full };
  });
  const vars = { person_name, meal_phrase, count_word, count }; // reminder calls never name the child or the relation
  const intro = spoken(input.mode === 'full' ? render(count === 1 ? r.step_intro_one : r.step_intro, vars)
    : render(count === 1 ? r.step_short_intro_one : r.step_short_intro, vars));
  const first = joinSentences([intro, items[0]?.first ?? '']);
  // A short separate greeting first ("Namaste Ramesh ji."), then a pause, so a slow synthesis of the long part cannot leave the line silent.
  const greeting = r.step_greeting ? spoken(render(r.step_greeting, { person_name })) : '';
  // v1.6: the opening after the greeting says who is calling and why, and its "haan" / 1 is the presence check.
  const presenceLine = (count === 1 ? r.step_reminder_presence_one : undefined) ?? r.step_reminder_presence ?? r.step_presence;
  const presence = presenceLine ? spoken(render(presenceLine, vars)) : '';
  const retryLine = (count === 1 ? r.step_presence_retry_one : undefined) ?? r.step_presence_retry;
  return { opening: first, greeting, presence, presenceRetry: retryLine ? spoken(render(retryLine, vars)) : presence, items };
}

export function sundayLines(input: ReminderScriptInput): string[] {
  if (!input.isSunday) return [];
  const seen = new Set(input.announcedTodayMedicineIds);
  const out: string[] = [];
  for (const it of input.items) {
    const m = it.medicine;
    if (m.numberLabel === null || m.numberLabel === undefined || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(render(input.templates.reminder.sunday_line, { number: m.numberLabel, spoken_name: m.spokenName }));
  }
  return out;
}

/** Any other template line with the standard variables. */
export function line(template: string, vars: { person_name?: string; child_name?: string; minutes?: number; relation_phrase?: string }): string {
  return render(template, vars);
}

/** The first prompt of a call: greeting, a pause (SAY_BREAK), then the presence question. */
export const presencePrompt = (greeting: string, question: string): string => [greeting, question].filter(Boolean).join(SAY_BREAK);
