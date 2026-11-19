import { describe, expect, it } from 'vitest';
import {
  COLOUR_KEYS, FOOD_KEYS, KIND_KEYS, MARKING_KEYS, SHAPE_KEYS, SIZE_KEYS,
  CONSENT_REPLY_LISTS, REMINDER_REPLY_LISTS,
  LANGUAGES, isApproved, loadScript, loadScriptText, templateVariables, normalise,
  type CallScript,
} from '../src';

const en = loadScript('en');

/** Every leaf string under an object, with its dotted path. */
function leaves(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj).flatMap(([k, v]) => {
      const p = prefix ? `${prefix}.${k}` : k;
      // gendered word maps are leaves for parity purposes
      const isWordMap = v && typeof v === 'object' && !Array.isArray(v) &&
        Object.keys(v).every((x) => ['m', 'f', 'n', 'obl'].includes(x));
      return isWordMap ? [p] : [p, ...keyPaths(v, p)];
    });
  }
  return [];
}

/** Variables each section may use. Anything else would be a value the family never entered. */
const ALLOWED: Record<string, string[]> = {
  'engine_extra.child_fallback': [], 'engine_extra.list_and': [], 'engine_extra.declined_ack': ['child_name'],
  'templates.consent': ['person_name', 'child_name'],
  'templates.reminder_full': ['person_name', 'child_name', 'count', 'ordinal', 'spoken_name', 'amount_text',
    'appearance_phrase', 'pack_phrase', 'disambiguator', 'food_phrase', 'extra_instruction'],
  'templates.reminder_short': ['person_name', 'spoken_name', 'amount_text', 'food_phrase'],
  'templates.test_call': [],
  'templates.repeat': [],
  'templates.unclear': [],
  'templates.reply_ack': ['child_name'],
  'templates.sunday': ['spoken_name', 'number'],
  'building.appearance': ['colour_primary', 'colour_secondary', 'shape', 'size', 'marking'],
  'building.pack': ['pack_colour', 'print_colour', 'cap_colour'],
  'building.disambiguator': ['number', 'strip_name_spelled'],
};

function templateStrings(s: CallScript): Array<[string, string]> {
  return [...leaves(s.templates, 'templates'), ...leaves(s.building, 'building'), ...leaves(s.engine_extra, 'engine_extra')];
}

describe.each(LANGUAGES)('%s.yaml', (lang) => {
  const script = loadScript(lang);
  const text = loadScriptText(lang);

  it('is marked NEEDS NATIVE-SPEAKER REVIEW until the founder approves it', () => {
    if (!isApproved(script)) {
      expect(script.meta.review_status).toBe('needs_native_speaker_review');
      expect(text.split('\n')[0]).toContain('NEEDS NATIVE-SPEAKER REVIEW');
    } else {
      expect(script.meta.approved_by).toBeTruthy();
      expect(script.meta.approved_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('has exactly the same keys as en.yaml', () => {
    for (const section of ['templates', 'building', 'blocks', 'replies'] as const) {
      expect(keyPaths(script[section]).sort(), section).toEqual(keyPaths(en[section]).sort());
    }
  });

  it('covers every enum value from the contracts', () => {
    expect(Object.keys(script.blocks.colours).sort()).toEqual([...COLOUR_KEYS].sort());
    expect(Object.keys(script.blocks.shapes).sort()).toEqual([...SHAPE_KEYS].sort());
    expect(Object.keys(script.blocks.sizes).sort()).toEqual([...SIZE_KEYS].sort());
    expect(Object.keys(script.blocks.markings).sort()).toEqual([...MARKING_KEYS].sort());
    expect(Object.keys(script.blocks.food).sort()).toEqual([...FOOD_KEYS].sort());
    expect(Object.keys(script.blocks.kinds).sort()).toEqual([...KIND_KEYS].sort());
    expect(script.blocks.ordinals.length).toBeGreaterThanOrEqual(10);
    expect(script.blocks.counts.length).toBeGreaterThanOrEqual(10);
    // "any" food means nothing is said
    expect(script.blocks.food.any).toBe('');
  });

  it('uses only allowed variables, and the same ones as English', () => {
    const enMap = new Map(templateStrings(en));
    for (const [path, tpl] of templateStrings(script)) {
      const section = path.split('.').slice(0, 2).join('.');
      const allowed = ALLOWED[section];
      expect(allowed, `no allow-list for ${section}`).toBeDefined();
      for (const v of templateVariables(tpl)) expect(allowed, `${path} uses {${v}}`).toContain(v);
      const enVars = new Set(templateVariables(enMap.get(path)!));
      expect(new Set(templateVariables(tpl)), `${path} must say the same family values as en`).toEqual(enVars);
    }
  });

  it('has balanced, non-nested optional segments and no stray braces', () => {
    for (const [path, tpl] of templateStrings(script)) {
      let depth = 0;
      for (const ch of tpl) {
        if (ch === '[') depth++;
        if (ch === ']') depth--;
        expect(depth, path).toBeGreaterThanOrEqual(0);
        expect(depth, path).toBeLessThanOrEqual(1);
      }
      expect(depth, path).toBe(0);
      expect(tpl.replace(/\{[a-z_]+(\|(m|f|n|obl))?\}/g, ''), path).not.toMatch(/[{}]/);
    }
  });

  it('never hard-codes a number except keypad keys (no doses in templates)', () => {
    for (const [path, tpl] of templateStrings(script)) {
      const digits = tpl.replace(/\{[^}]*\}/g, '').match(/\d+/g) ?? [];
      for (const d of digits) expect(['0', '1', '2', '3', '9'], `${path}: "${d}"`).toContain(d);
    }
  });

  it('every consent and reminder prompt tells the parent which key to press', () => {
    expect(script.templates.consent.ask).toContain('1');
    expect(script.templates.consent.ask).toContain('9');
    expect(script.templates.reminder_full.ask).toMatch(/1[\s\S]*0[\s\S]*2/);
    expect(script.templates.reminder_full.more_options).toContain('3');
    expect(script.templates.reminder_short.single).toContain('1');
    expect(script.templates.unclear.keypad).toContain('1');
  });

  it('has non-empty reply lists with no phrase in two lists of the same call type', () => {
    for (const group of [REMINDER_REPLY_LISTS, CONSENT_REPLY_LISTS]) {
      const seen = new Map<string, string>();
      for (const list of group) {
        const phrases = script.replies[list];
        expect(phrases.length, list).toBeGreaterThan(0);
        for (const p of phrases) {
          const n = normalise(p);
          expect(n, `${list}: "${p}"`).not.toBe('');
          const other = seen.get(n);
          if (other && other !== list) throw new Error(`"${p}" is in both ${other} and ${list}`);
          seen.set(n, list);
        }
      }
    }
  });
});
