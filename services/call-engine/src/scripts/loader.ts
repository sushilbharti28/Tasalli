import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { CallLanguage } from '@tasalli/contracts';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { BUILTIN_PHRASES, type ContextPhrases, type PhraseBook } from '../speech/phrases.js';
import { mergePhraseBooks } from '../speech/intent.js';
import { placeholders } from './render.js';
import { BUILTIN_TEMPLATES, EN_TEMPLATES, type ScriptTemplates } from './templates.js';

/** The generated engine scripts (pnpm --filter @tasalli/scripts build:engine). SCRIPTS_DIR overrides. */
export const DEFAULT_SCRIPTS_DIR = fileURLToPath(new URL('../../../../packages/scripts/engine', import.meta.url));

export interface LanguagePack {
  language: CallLanguage;
  templates: ScriptTemplates;
  phrases: PhraseBook;
  /** 'builtin' | 'file' | 'builtin+file' | 'fallback-en' */
  source: string;
  warnings: string[];
}

interface YamlPhrases {
  negation_words?: string[];
  reminder?: ContextPhrases;
  consent?: ContextPhrases;
}

/**
 * Loads language packs. packages/scripts/<lang>.yaml (if present) is deep-merged over the
 * built-in defaults (hi, en). A language with neither a file nor defaults falls back to English
 * and the pack carries a warning; the README lists which languages need files.
 */
export class ScriptLibrary {
  private cache = new Map<string, LanguagePack>();

  constructor(private readonly scriptsDir: string | null, private readonly log: Logger = silentLogger) {}

  get(language: CallLanguage): LanguagePack {
    const hit = this.cache.get(language);
    if (hit) return hit;
    const pack = this.load(language);
    for (const w of pack.warnings) this.log.warn('script pack warning', { language, warning: w });
    this.cache.set(language, pack);
    return pack;
  }

  private load(language: CallLanguage): LanguagePack {
    const warnings: string[] = [];
    const builtin = BUILTIN_TEMPLATES[language];
    const base = builtin ?? EN_TEMPLATES;
    const basePhrases = BUILTIN_PHRASES[language as 'hi' | 'en'] ?? BUILTIN_PHRASES.en;
    let file: Record<string, unknown> | null = null;
    const path = this.scriptsDir ? join(this.scriptsDir, `${language}.yaml`) : null;
    if (path && existsSync(path)) {
      try {
        file = parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      } catch (err) {
        warnings.push(`could not parse ${language}.yaml: ${(err as Error).message}; using defaults`);
      }
    }
    if (!builtin && !file) warnings.push(`no templates for "${language}": falling back to English`);

    const { phrases: rawPhrases, ...templatePart } = (file ?? {}) as { phrases?: YamlPhrases };
    const templates = deepMerge(structuredClone(base), templatePart) as ScriptTemplates;
    templates.language = language;
    if (!builtin && file) {
      for (const missing of missingKeys(templatePart, EN_TEMPLATES)) warnings.push(`${language}.yaml missing ${missing}; English used`);
    }
    warnings.push(...unknownPlaceholders(templates));

    const extra: Partial<PhraseBook> | undefined = rawPhrases
      ? { negationWords: rawPhrases.negation_words, reminder: rawPhrases.reminder ?? {}, consent: rawPhrases.consent ?? {} }
      : undefined;
    const { book, rejected } = mergePhraseBooks(basePhrases, extra);
    for (const r of rejected) warnings.push(`confirm phrase dropped (contains a negative): ${r}`);

    const source = builtin ? (file ? 'builtin+file' : 'builtin') : file ? 'file' : 'fallback-en';
    return { language, templates, phrases: book, source, warnings };
  }
}

function deepMerge(target: unknown, src: unknown): unknown {
  if (!isObj(target) || !isObj(src)) return src === undefined ? target : src;
  for (const [k, v] of Object.entries(src)) {
    if (v === null || v === undefined) continue;
    (target as Record<string, unknown>)[k] = isObj(v) && isObj((target as Record<string, unknown>)[k])
      ? deepMerge((target as Record<string, unknown>)[k], v)
      : v;
  }
  return target;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function missingKeys(given: unknown, reference: unknown, prefix = ''): string[] {
  if (!isObj(reference)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(reference)) {
    if (k === 'language' || k === 'status' || k === 'food_morning' || k === 'colours') continue;
    const g = isObj(given) ? given[k] : undefined;
    if (g === undefined) out.push(prefix + k);
    else if (isObj(v)) out.push(...missingKeys(g, v, `${prefix}${k}.`));
  }
  return out;
}

const ALLOWED_VARS: Record<string, string[]> = {
  reminder: ['person_name', 'child_name', 'count', 'dose_unit', 'ordinal', 'spoken_name', 'amount_text', 'appearance_phrase',
    'pack_phrase', 'disambiguator', 'food_phrase', 'extra_instruction', 'names', 'number', 'minutes', 'relation_phrase', 'meal_phrase', 'count_word'],
  consent: ['person_name', 'child_name', 'relation_phrase'],
  test: ['person_name'],
  words: ['size', 'colour', 'colour2', 'shape', 'kind', 'marking', 'pack_colour', 'print_colour', 'cap_colour', 'cap_phrase',
    'print_phrase', 'number', 'strip_letters'],
};

function unknownPlaceholders(t: ScriptTemplates): string[] {
  const out: string[] = [];
  const walk = (section: string, v: unknown, path: string) => {
    if (typeof v === 'string') {
      for (const p of placeholders(v)) if (!ALLOWED_VARS[section]!.includes(p)) out.push(`unknown placeholder {${p}} in ${path}`);
    } else if (isObj(v)) for (const [k, c] of Object.entries(v)) walk(section, c, `${path}.${k}`);
    else if (Array.isArray(v)) v.forEach((c, i) => walk(section, c, `${path}[${i}]`));
  };
  for (const section of ['reminder', 'consent', 'test', 'words'] as const) walk(section, t[section], section);
  return out;
}
