import type { ReplyIntent } from '@tasalli/contracts';
import type { ContextPhrases, MatchIntent, PhraseBook } from './phrases.js';

export type ReplyContext = 'reminder' | 'consent';

/** Minimum STT confidence. Anything lower is unclear and can never confirm. */
export const MIN_CONFIDENCE = 0.6;

/**
 * Non-confirm intents in priority order (ties on match length). Stop always wins.
 * Every one of these is checked before 'confirm' (safety rule 4: "no" beats "yes").
 */
const NON_CONFIRM_ORDER: MatchIntent[] = ['stop', 'doctor_changed', 'unwell', 'snooze', 'repeat', 'decline'];

const ALLOWED: Record<ReplyContext, MatchIntent[]> = {
  reminder: ['stop', 'doctor_changed', 'unwell', 'snooze', 'repeat', 'decline', 'confirm'],
  consent: ['stop', 'repeat', 'decline', 'confirm'],
};

export function normalise(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function findPhrase(tokens: string[], phrase: string): boolean {
  const p = normalise(phrase);
  if (p.length === 0 || p.length > tokens.length) return false;
  for (let i = 0; i + p.length <= tokens.length; i++) {
    if (p.every((t, j) => tokens[i + j] === t)) return true;
  }
  return false;
}

export interface IntentResult {
  intent: ReplyIntent;
  matched?: string;
}

/**
 * Interpret a spoken reply.
 * 1. Empty, or below MIN_CONFIDENCE -> unclear.
 * 2. A stop phrase anywhere -> stop.
 * 3. Otherwise the longest non-confirm phrase (doctor_changed, unwell, snooze, repeat, decline).
 * 4. Only then confirm, and only if no negation word appears anywhere in the reply.
 * A non-confirm intent that the context does not handle becomes unclear, never confirm.
 */
export function matchIntent(transcript: string | undefined, book: PhraseBook, context: ReplyContext, confidence = 1): IntentResult {
  if (!transcript || confidence < MIN_CONFIDENCE) return { intent: 'unclear' };
  const tokens = normalise(transcript);
  if (tokens.length === 0) return { intent: 'unclear' };
  const phrases: ContextPhrases = book[context];

  let best: { intent: MatchIntent; phrase: string; len: number } | null = null;
  for (const intent of NON_CONFIRM_ORDER) {
    for (const phrase of phrases[intent] ?? []) {
      if (!findPhrase(tokens, phrase)) continue;
      if (intent === 'stop') return result('stop', phrase, context);
      const len = normalise(phrase).length;
      if (!best || len > best.len) best = { intent, phrase, len };
    }
  }
  if (best) return result(best.intent, best.phrase, context);

  const negated = book.negationWords.some((w) => findPhrase(tokens, w));
  if (negated) return { intent: 'unclear' };
  for (const phrase of phrases.confirm ?? []) {
    if (findPhrase(tokens, phrase)) return result('confirm', phrase, context);
  }
  return { intent: 'unclear' };
}

function result(intent: MatchIntent, matched: string, context: ReplyContext): IntentResult {
  return ALLOWED[context].includes(intent) ? { intent, matched } : { intent: 'unclear', matched };
}

/**
 * Merge extra phrases (from packages/scripts) into a base book. Lists are unioned.
 * A confirm phrase that contains a negation word or any non-confirm phrase is dropped
 * (returned in `rejected`) so a content mistake can never turn "no" into "yes".
 */
export function mergePhraseBooks(base: PhraseBook, extra: Partial<PhraseBook> | undefined): { book: PhraseBook; rejected: string[] } {
  const book: PhraseBook = structuredClone(base);
  if (extra) {
    book.negationWords = union(book.negationWords, extra.negationWords);
    for (const ctx of ['reminder', 'consent'] as const) {
      for (const [intent, list] of Object.entries(extra[ctx] ?? {})) {
        const k = intent as MatchIntent;
        book[ctx][k] = union(book[ctx][k], list);
      }
    }
  }
  const rejected: string[] = [];
  for (const ctx of ['reminder', 'consent'] as const) {
    const negatives = NON_CONFIRM_ORDER.flatMap((i) => book[ctx][i] ?? []);
    book[ctx].confirm = (book[ctx].confirm ?? []).filter((phrase) => {
      const tokens = normalise(phrase);
      const bad = book.negationWords.some((w) => findPhrase(tokens, w)) || negatives.some((n) => findPhrase(tokens, n));
      if (bad) rejected.push(`${ctx}.confirm: ${phrase}`);
      return !bad;
    });
  }
  return { book, rejected };
}

function union(a: string[] | undefined, b: string[] | undefined): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}
