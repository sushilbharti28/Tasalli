import type { BlockWord, WordForm } from './types';

/**
 * Template syntax (kept deliberately small):
 *   {name}        insert a value verbatim
 *   {name|f}      insert the f / m / n / obl form of a gendered block word
 *   [ ... ]       optional segment: dropped if any {name} inside it is empty
 * Segments do not nest. There is no other logic in templates.
 */
export type TemplateValue = BlockWord | number | null | undefined;
export type TemplateValues = Record<string, TemplateValue>;

const VAR = /\{([a-z_]+)(?:\|(m|f|n|obl))?\}/g;

export class MissingValueError extends Error {
  constructor(public readonly variable: string, template: string) {
    super(`Missing value for {${variable}} in template: ${template}`);
  }
}

/** Pick the right form of a block word. Plain strings (and family free text) pass through unchanged. */
export function wordForm(value: BlockWord, form?: WordForm): string {
  if (typeof value === 'string') return value;
  if (form && value[form] !== undefined) return value[form]!;
  return value.m ?? value.f ?? value.n ?? value.obl ?? '';
}

function valueText(value: TemplateValue, form?: WordForm): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return wordForm(value, form).trim();
}

function fill(text: string, values: TemplateValues): { out: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(VAR, (_m, name: string, form?: WordForm) => {
    const v = valueText(values[name], form);
    if (v === '') missing.push(name);
    return v;
  });
  return { out, missing };
}

/**
 * Render a template. Variables outside [optional] segments are required:
 * with `strict` (the default) a missing one throws, otherwise the whole result is ''.
 */
export function render(template: string, values: TemplateValues, opts: { strict?: boolean } = {}): string {
  const strict = opts.strict ?? true;
  let requiredMissing: string | undefined;
  const parts = template.split(/(\[[^\]]*\])/g);
  const out = parts
    .map((part) => {
      if (part.startsWith('[') && part.endsWith(']')) {
        const { out, missing } = fill(part.slice(1, -1), values);
        return missing.length ? '' : out;
      }
      const { out, missing } = fill(part, values);
      if (missing.length && !requiredMissing) requiredMissing = missing[0];
      return out;
    })
    .join('');
  if (requiredMissing) {
    if (strict) throw new MissingValueError(requiredMissing, template);
    return '';
  }
  // No whitespace clean-up: the family's text must come out exactly as entered.
  return out.trim();
}

/** Variable names used by a template, e.g. ['person_name', 'child_name']. */
export function templateVariables(template: string): string[] {
  return [...template.matchAll(VAR)].map((m) => m[1]!);
}

/** "Amlodac 5" -> "A-M-L-O-D-A-C-5": spoken letter by letter so the parent can match the strip. */
export function spellOut(stripName: string): string {
  return [...stripName.toUpperCase().replace(/[^A-Z0-9]/g, '')].join('-');
}
