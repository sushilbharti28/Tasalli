import type { CallLanguage, ReplyIntent } from '@tasalli/contracts';

export type PhraseTag =
  | 'romanized'      // Latin script, as some STT engines return
  | 'native'         // the language's own script
  | 'negative'       // a "not taken" reply; must never confirm
  | 'tricky'         // looks like a confirmation but is not (or vice versa)
  | 'code-mixed'     // mixes English / Hindi words
  | 'future'         // "I will take it": not a confirmation
  | 'noise';         // silence, greetings, filler

export interface PhraseCase {
  id: string;                   // '<lang>-<intent>-NNN', unique across the set
  text: string;                 // the transcript the matcher receives
  intent: ReplyIntent;          // expected intent
  alsoAccept?: ReplyIntent[];   // other acceptable intents (never 'confirm' unless intent is confirm)
  mustNot?: ReplyIntent[];      // intents that are a safety failure (confirm is implied for non-confirm cases)
  context?: 'reminder' | 'consent';  // default 'reminder'
  tags?: PhraseTag[];
  gloss?: string;               // English meaning, for reviewers
}

export interface PhraseSet {
  language: CallLanguage;
  /** Draft until a native speaker signs off (gate "Words match the data"). */
  review: { status: 'draft' | 'reviewed'; reviewer?: string; date?: string };
  phrases: PhraseCase[];
}
