import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { LANGUAGES, SCRIPTS_DIR, loadScript, templateVariables, toEngineTemplates } from '../src';

// Mirrors services/call-engine/src/scripts/templates.ts (ScriptTemplates) and loader.ts (ALLOWED_VARS).
const REQUIRED: Record<string, string[]> = {
  reminder: ['full_intro', 'full_item', 'full_outro', 'short_intro', 'short_item', 'short_outro', 'sunday_line', 'unclear',
    'keypad_only', 'confirm_ack', 'snooze_ack', 'snooze_used', 'declined_ack', 'doctor_changed_ack', 'unwell_ack', 'stop_ack', 'no_input_goodbye'],
  consent: ['prompt', 'unclear', 'keypad_only', 'yes_ack', 'no_ack', 'stop_ack', 'no_input_goodbye'],
  test: ['prompt', 'ack'],
  words: ['person_suffix', 'child_fallback', 'dose_unit', 'ordinals', 'list_joiner', 'list_last_joiner', 'food', 'appearance', 'two_colour',
    'colours', 'sizes', 'shapes', 'kinds', 'markings', 'pack', 'cap_phrase', 'print_phrase', 'disambiguator_number', 'disambiguator_printed_name'],
};
const ALLOWED: Record<string, string[]> = {
  reminder: ['person_name', 'child_name', 'count', 'dose_unit', 'ordinal', 'spoken_name', 'amount_text', 'appearance_phrase',
    'pack_phrase', 'disambiguator', 'food_phrase', 'extra_instruction', 'names', 'number', 'minutes', 'relation_phrase', 'meal_phrase', 'count_word'],
  consent: ['person_name', 'child_name', 'relation_phrase'],
  test: ['person_name'],
  words: ['size', 'colour', 'colour2', 'shape', 'kind', 'marking', 'pack_colour', 'print_colour', 'cap_colour', 'cap_phrase',
    'print_phrase', 'number', 'strip_letters'],
};

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

describe.each(LANGUAGES)('engine export %s', (lang) => {
  const out = toEngineTemplates(loadScript(lang)) as Record<string, Record<string, unknown>>;

  it('has every key the call engine requires', () => {
    for (const [section, keys] of Object.entries(REQUIRED)) {
      for (const k of keys) expect(out[section]![k], `${section}.${k}`).toBeDefined();
    }
    expect(out.words!.ordinals as string[]).toHaveLength(8);
  });

  it('uses only placeholders the engine knows', () => {
    for (const [section, allowed] of Object.entries(ALLOWED)) {
      for (const s of strings(out[section])) {
        for (const v of templateVariables(s)) expect(allowed, `${section}: ${s}`).toContain(v);
      }
    }
  });

  it('syrup bottles say the cap colour: pack.bottle carries {cap_phrase}, which holds {cap_colour}', () => {
    const w = out.words as any;
    expect(w.pack.bottle).toContain('{cap_phrase}');
    expect(w.cap_phrase).toContain('{cap_colour}');
  });

  it('leaves no optional-segment brackets or gender hints', () => {
    for (const s of strings([out.reminder, out.consent, out.words])) expect(s).not.toMatch(/[[\]|]/);
  });

  it('is marked for review and the committed engine file is up to date', () => {
    expect(String(out.status)).toContain('needs native-speaker review');
    const committed = parse(readFileSync(join(SCRIPTS_DIR, 'engine', `${lang}.yaml`), 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(out)));
  });

  it('exports negative phrases as decline, and no confirm phrase equals a negative', () => {
    const ph = out.phrases as any;
    expect(ph.reminder.decline.length).toBeGreaterThan(0);
    for (const c of ph.reminder.confirm) expect(ph.reminder.decline).not.toContain(c);
  });
});
