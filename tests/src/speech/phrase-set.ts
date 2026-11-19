import type { CallLanguage } from '@tasalli/contracts';
import bn from './phrases/bn.json';
import en from './phrases/en.json';
import hi from './phrases/hi.json';
import mr from './phrases/mr.json';
import ta from './phrases/ta.json';
import te from './phrases/te.json';
import type { PhraseCase, PhraseSet } from './types';

export const PHRASE_SETS: Record<CallLanguage, PhraseSet> = {
  hi: hi as PhraseSet, en: en as PhraseSet, bn: bn as PhraseSet,
  mr: mr as PhraseSet, ta: ta as PhraseSet, te: te as PhraseSet,
};

export const LANGUAGES = Object.keys(PHRASE_SETS) as CallLanguage[];

/** Intents that would be a safety failure for this case. */
export function forbiddenIntents(c: PhraseCase): string[] {
  const out = new Set(c.mustNot ?? []);
  if (c.intent !== 'confirm') out.add('confirm');
  return [...out];
}

export function acceptable(c: PhraseCase): string[] {
  return [c.intent, ...(c.alsoAccept ?? [])];
}

/** Every case where a confirmation would break safety rule 4. */
export function safetyNegatives(language?: CallLanguage): Array<PhraseCase & { language: CallLanguage }> {
  return LANGUAGES.filter((l) => !language || l === language).flatMap((l) =>
    PHRASE_SETS[l].phrases
      .filter((c) => c.intent !== 'confirm' && (c.context ?? 'reminder') === 'reminder')
      .map((c) => ({ ...c, language: l })),
  );
}
