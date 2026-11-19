import type { CallerRelation, MedicineRow, PersonRow, ScheduleRow } from '../types.js';
import { joinSentences, render } from './render.js';
import type { ScriptTemplates } from './templates.js';

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
  /** Relation of the caller (child) to the parent; unknown means "{child} ki taraf se" alone. */
  callerRelation?: CallerRelation | null;
}

export function personName(t: ScriptTemplates, person: Pick<PersonRow, 'nickname' | 'fullName'>): string {
  // First word of the full name ("Ramesh Sharma" -> "Ramesh ji"); the nickname when there is no full name.
  const base = (person.fullName ?? '').trim().split(/\s+/)[0] || person.nickname.trim();
  return base + t.words.person_suffix;
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
  /** Per medicine: `first` is said the first time (full or short mode), `full` is the repeat for key 0 / "phir se". */
  items: Array<{ first: string; full: string }>;
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
  const person_name = personName(t, input.person), child_name = childName(t, input.childName);
  const count = input.items.length;
  const count_word = r.step_count_words[count - 1] ?? String(count);
  const relation_phrase = (input.callerRelation && r.step_relations[input.callerRelation as keyof typeof r.step_relations]) || '';
  const meal_phrase = mealPhrase(t, input.items[0]?.schedule.food ?? 'any', input.localHour);
  const seenNumbers = new Set(input.announcedTodayMedicineIds);
  const items = input.items.map((it, i) => {
    const m = it.medicine;
    const common = {
      ordinal: t.words.ordinals[i] ?? String(i + 1), spoken_name: m.spokenName, amount_text: it.schedule.amountText,
      disambiguator: disambiguator(t, m), extra_instruction: m.extraInstruction,
    };
    const full = render(count === 1 ? r.step_item_one : r.step_item, { ...common, appearance_phrase: appearancePhrase(t, m), pack_phrase: packPhrase(t, m) });
    const short = render(count === 1 ? r.step_item_short_one : r.step_item_short, common);
    const sunday = input.isSunday && m.numberLabel !== null && m.numberLabel !== undefined && !seenNumbers.has(m.id)
      ? render(r.sunday_line, { number: m.numberLabel, spoken_name: m.spokenName }) : ''; // said once per medicine per day
    if (sunday) seenNumbers.add(m.id);
    return { first: joinSentences([sunday, input.mode === 'full' ? full : short]), full };
  });
  const vars = { person_name, relation_phrase, child_name, meal_phrase, count_word, count };
  const intro = input.mode === 'full' ? render(count === 1 ? r.step_intro_one : r.step_intro, vars)
    : render(count === 1 ? r.step_short_intro_one : r.step_short_intro, vars);
  return { opening: joinSentences([intro, items[0]?.first ?? '']), items };
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
export function line(template: string, vars: { person_name?: string; child_name?: string; minutes?: number }): string {
  return render(template, vars);
}
