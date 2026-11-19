import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { CallLanguage } from '@tasalli/contracts';
import type { CallScript } from './types';

export const LANGUAGES: readonly CallLanguage[] = ['hi', 'en', 'bn', 'mr', 'ta', 'te'];

export const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export function scriptPath(language: CallLanguage): string {
  return join(SCRIPTS_DIR, `${language}.yaml`);
}

export function loadScriptText(language: CallLanguage): string {
  return readFileSync(scriptPath(language), 'utf8');
}

export function loadScript(language: CallLanguage): CallScript {
  const script = parse(loadScriptText(language)) as CallScript;
  if (script?.meta?.language !== language) {
    throw new Error(`${language}.yaml: meta.language must be '${language}'`);
  }
  return script;
}

/** True only after the founder has approved this language. Calls to real parents should require it. */
export function isApproved(script: CallScript): boolean {
  return (
    script.meta.review_status === 'approved' &&
    Boolean(script.meta.approved_by) &&
    Boolean(script.meta.approved_on)
  );
}
