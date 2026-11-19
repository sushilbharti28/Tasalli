import { render, spellOut, type TemplateValues } from './render';
import type { BlockWord, CallScript, MedicineForCall } from './types';

/**
 * Reference composer: turns the family's entries into the sentences of a call.
 * It only looks words up and inserts the family's text verbatim (safety rule 1).
 * The call engine may use this directly or re-implement it against the same YAML.
 */

function key(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** A colour the app stored as a known key becomes the script's word; anything else is spoken as typed. */
export function colourWord(script: CallScript, raw: string | null | undefined): BlockWord | undefined {
  if (!raw || !raw.trim()) return undefined;
  const known = (script.blocks.colours as Record<string, BlockWord>)[key(raw)];
  return known ?? raw.trim();
}

function lookup<T extends Record<string, BlockWord>>(table: T, raw: string | null | undefined): BlockWord | undefined {
  if (!raw) return undefined;
  const v = (table as Record<string, BlockWord>)[key(raw)];
  if (v === undefined || v === '') return undefined;
  return v;
}

export function appearancePhrase(script: CallScript, med: MedicineForCall): string {
  const a = script.building.appearance;
  const values: TemplateValues = {
    colour_primary: colourWord(script, med.colourPrimary),
    colour_secondary: colourWord(script, med.colourSecondary),
    shape: lookup(script.blocks.shapes, med.shape),
    size: lookup(script.blocks.sizes, med.size),
    marking: lookup(script.blocks.markings, med.marking),
  };
  if (med.kind === 'tablet') return render(a.tablet, values, { strict: false });
  if (med.kind === 'capsule') {
    if (med.colourPrimary && med.colourSecondary) {
      return render(a.capsule_two_colour, values, { strict: false });
    }
    return render(a.capsule, values, { strict: false });
  }
  return '';
}

export function packPhrase(script: CallScript, med: MedicineForCall): string {
  const p = script.building.pack;
  const values: TemplateValues = {
    pack_colour: colourWord(script, med.packColour),
    print_colour: colourWord(script, med.printColour),
    cap_colour: colourWord(script, med.capColour),
  };
  switch (med.keptIn) {
    case 'strip':
      return render(med.printColour ? p.strip_with_print : p.strip, values, { strict: false });
    case 'bottle':
      return render(med.capColour ? p.bottle_with_cap : p.bottle, values, { strict: false });
    case 'loose':
      return render(p.loose, values, { strict: false });
    default:
      return '';
  }
}

export function disambiguatorPhrase(script: CallScript, med: MedicineForCall): string {
  const d = script.building.disambiguator;
  if (med.numberLabel !== null && med.numberLabel !== undefined) {
    return render(d.number, { number: med.numberLabel });
  }
  if (med.sayPrintedName) {
    return render(d.printed_name, { strip_name_spelled: spellOut(med.stripName) }, { strict: false });
  }
  return '';
}

function ordinal(script: CallScript, index: number): string {
  return script.blocks.ordinals[index] ?? String(index + 1);
}

export function countWord(script: CallScript, n: number): string {
  return script.blocks.counts[n - 1] ?? String(n);
}

export function medicineItem(script: CallScript, med: MedicineForCall, index: number): string {
  return render(script.templates.reminder_full.item, {
    ordinal: ordinal(script, index),
    spoken_name: med.spokenName,
    amount_text: med.amountText,
    appearance_phrase: appearancePhrase(script, med),
    pack_phrase: packPhrase(script, med),
    disambiguator: disambiguatorPhrase(script, med),
    food_phrase: script.blocks.food[med.food],
    extra_instruction: med.extraInstruction,
  });
}

export interface CallPeople {
  personName: string;
  childName: string;
}

/** First call of the day: full description of every medicine. Returns one string per spoken sentence group. */
export function reminderFull(script: CallScript, people: CallPeople, meds: MedicineForCall[]): string[] {
  if (meds.length === 0) throw new Error('reminderFull needs at least one medicine');
  const t = script.templates.reminder_full;
  const names = { person_name: people.personName, child_name: people.childName };
  return [
    render(t.greeting, names),
    meds.length === 1 ? render(t.count_one, {}) : render(t.count_many, { count: countWord(script, meds.length) }),
    ...meds.map((m, i) => medicineItem(script, m, i)),
    render(t.ask, {}),
    render(t.more_options, {}),
  ];
}

/** Later calls in the day: name, amount and food only. */
export function reminderShort(script: CallScript, people: CallPeople, meds: MedicineForCall[]): string[] {
  if (meds.length === 0) throw new Error('reminderShort needs at least one medicine');
  const t = script.templates.reminder_short;
  if (meds.length === 1) {
    const m = meds[0]!;
    return [
      render(t.single, {
        person_name: people.personName,
        spoken_name: m.spokenName,
        amount_text: m.amountText,
        food_phrase: script.blocks.food[m.food],
      }),
    ];
  }
  return [
    render(t.group_greeting, { person_name: people.personName }),
    ...meds.map((m) =>
      render(t.group_item, {
        spoken_name: m.spokenName,
        amount_text: m.amountText,
        food_phrase: script.blocks.food[m.food],
      }),
    ),
    render(t.ask, {}),
  ];
}

export function sundayLine(script: CallScript, med: MedicineForCall): string {
  if (med.numberLabel === null || med.numberLabel === undefined) return '';
  return render(script.templates.sunday.new_strip, { spoken_name: med.spokenName, number: med.numberLabel });
}
