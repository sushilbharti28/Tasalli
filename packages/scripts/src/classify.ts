import type { ReplyIntent } from '@tasalli/contracts';
import type { ReplyListName, ScriptReplies } from './types';

/**
 * Reference reply classifier for the phrase lists in the YAML files.
 *
 * Safety rule 4 ("no" beats "yes"): every non-confirm list is checked before
 * `confirm`, so a transcript that contains any negative, snooze, stop or other
 * phrase is never a confirmation. Empty or unmatched speech is 'unclear', and
 * the call falls back to the keypad.
 *
 * Matching is whole-word: a phrase matches when its words appear next to each
 * other, in order, anywhere in the transcript ("haan le li" matches "le li").
 */

const NUKTA = /[़়਼઼଼಼]/g;
// Devanagari candrabindu/anusvara and Bengali candrabindu: speech engines drop them inconsistently.
const NASAL = /[ँंঁ]/g;
const JOINERS = /[​‌‍﻿]/g;

export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(NUKTA, '')
    .replace(NASAL, '')
    .replace(JOINERS, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  const n = normalise(text);
  return n ? n.split(' ') : [];
}

export function containsPhrase(transcript: string, phrase: string): boolean {
  const t = words(transcript);
  const p = words(phrase);
  if (p.length === 0 || p.length > t.length) return false;
  for (let i = 0; i + p.length <= t.length; i++) {
    if (p.every((w, j) => t[i + j] === w)) return true;
  }
  return false;
}

function matches(transcript: string, list: string[] | undefined): boolean {
  return (list ?? []).some((p) => containsPhrase(transcript, p));
}

/** Order matters: first match wins, and confirm is always last. */
export const REMINDER_ORDER: ReadonlyArray<[ReplyListName, ReplyIntent]> = [
  ['stop', 'stop'],
  ['doctor_changed', 'doctor_changed'],
  ['unwell', 'unwell'],
  ['repeat', 'repeat'],
  ['snooze', 'snooze'],
  ['negative', 'decline'], // "not taken": the dose stays unconfirmed
  ['confirm', 'confirm'],
];

export const CONSENT_ORDER: ReadonlyArray<[ReplyListName, ReplyIntent]> = [
  ['stop', 'stop'],
  ['consent_no', 'decline'],
  ['consent_yes', 'confirm'],
];

export function classifyReply(
  transcript: string | null | undefined,
  replies: ScriptReplies,
  context: 'reminder' | 'consent',
): ReplyIntent {
  if (!transcript || !normalise(transcript)) return 'unclear';
  const order = context === 'consent' ? CONSENT_ORDER : REMINDER_ORDER;
  for (const [list, intent] of order) {
    if (matches(transcript, replies[list])) return intent;
  }
  return 'unclear';
}
