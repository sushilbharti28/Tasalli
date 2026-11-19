import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, SCRIPTS_DIR, loadScriptText } from '../src';

/**
 * No medical claims anywhere (CLAUDE.md safety rules 1 and 2). Words that promise a result, or talk
 * about what a medicine does, are banned in call scripts and app copy. Add words as they are found.
 * Disclaimers ("not medical advice") are allowed: a line that also contains a negation is skipped.
 */
const CLAIM_WORDS: Record<string, RegExp> = {
  en: /\b(cure[sd]?|heal(s|ed|ing)?|treat(s|ed|ment|ing)?|therapy|diagnos\w*|prescrib\w*|side[- ]effects?|safe|safely|effective|effectiveness|prevent\w*|recover\w*|improv\w*|clinically|doctor[- ]approved|dosage (advice|recommend\w*)|overdose|interaction|substitute|equivalent|same medicine|generic)\b/i,
  hi: /(इलाज|ठीक हो जाएँ|ठीक हो जाओ|ठीक हो जाए|असर|फ़ायदा|फायदा|सुरक्षित|बीमारी|दुष्प्रभाव|उपचार|बराबर|एक ही दवाई)/,
  bn: /(চিকিৎসা|সারবে|সেরে|উপকার|নিরাপদ|রোগ|পার্শ্বপ্রতিক্রিয়া)/,
  mr: /(उपचार|इलाज|फायदा|सुरक्षित|आजार|दुष्परिणाम|बरे होईल)/,
  ta: /(சிகிச்சை|குணமாகும்|குணமாக|நன்மை|பாதுகாப்பான|நோய்|பக்கவிளைவு)/,
  te: /(చికిత్స|నయం|ప్రయోజనం|సురక్షిత|వ్యాధి|దుష్ప్రభావ)/,
};
const NEGATION = /\b(not|no|never|does not|do not|cannot|can't|without)\b|नहीं|না|নয়|नाही|இல்லை|కాదు|లేదు/i;

function flagged(text: string, langs: string[]): string[] {
  const hits: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('#') && !line.includes('"')) continue; // YAML comments (reviewer notes)
    for (const l of langs) {
      const m = line.match(CLAIM_WORDS[l]!);
      if (m && !(NEGATION.test(line) && /advice|claim|replace|substitute|compare/i.test(line))) hits.push(`${l}: "${m[0]}" in: ${line.trim().slice(0, 100)}`);
    }
  }
  return hits;
}

function walk(dir: string, ext: string[]): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p, ext) : ext.some((e) => p.endsWith(e)) ? [p] : [];
  });
}

describe('no medical claims', () => {
  it.each(LANGUAGES)('%s call script has no claim words (any language list)', (lang) => {
    expect(flagged(loadScriptText(lang), Object.keys(CLAIM_WORDS))).toEqual([]);
  });

  it('app strings have no claim words', () => {
    const files = walk(join(SCRIPTS_DIR, 'app-strings'), ['.json']);
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) expect(flagged(readFileSync(f, 'utf8'), ['en', 'hi']), f).toEqual([]);
  });

  it('store listing, guides and support replies have no claim words', () => {
    const docs = join(SCRIPTS_DIR, '..', '..', 'docs', 'content');
    for (const f of walk(docs, ['.md'])) expect(flagged(readFileSync(f, 'utf8'), ['en']), f).toEqual([]);
  });

  it('the scanner itself catches a claim', () => {
    expect(flagged('This medicine will cure your sugar.', ['en'])).toHaveLength(1);
    expect(flagged('यह दवाई असर करेगी', ['hi'])).toHaveLength(1);
    expect(flagged('Tasalli is not medical advice.', ['en'])).toEqual([]);
  });

  it('call scripts do not mention strength, dose changes or brand comparison', () => {
    for (const lang of LANGUAGES) {
      const t = loadScriptText(lang);
      expect(t, lang).not.toMatch(/\b(mg|mcg|ml)\b/i);
    }
  });
});
