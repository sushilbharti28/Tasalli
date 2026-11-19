import { describe, expect, it } from 'vitest';
import type { ReplyMatcher } from '../reference/reference-matcher';
import { LANGUAGES, PHRASE_SETS, acceptable, forbiddenIntents } from './phrase-set';

export interface SpeechSuiteOptions {
  /** Minimum share of confirm phrases recognised (gate "Speech accuracy"). Default 0.9. */
  confirmAccuracy?: number;
  /** Minimum share of all cases that land on an acceptable intent. Default 0.9. */
  overallAccuracy?: number;
}

/**
 * Run the speech test set against a reply matcher.
 * - Safety (hard fail, every case): no forbidden intent; non-confirm cases never confirm.
 * - Accuracy (thresholds): confirm phrases and all phrases land on an acceptable intent.
 */
export function describeSpeechMatcher(name: string, matcher: ReplyMatcher, opts: SpeechSuiteOptions = {}): void {
  const confirmBar = opts.confirmAccuracy ?? 0.9;
  const overallBar = opts.overallAccuracy ?? 0.9;

  describe(`speech test set: ${name}`, () => {
    for (const language of LANGUAGES) {
      describe(language, () => {
        const set = PHRASE_SETS[language];

        describe('safety: never a false confirmation or false stop (rule 4)', () => {
          for (const c of set.phrases) {
            const forbidden = forbiddenIntents(c);
            if (!forbidden.length) continue;
            it(`${c.id} "${c.text}" is never ${forbidden.join('/')}`, async () => {
              const got = await matcher(c.text, { language, purpose: c.context ?? 'reminder' });
              expect(forbidden, `${c.id} "${c.text}" -> ${got}`).not.toContain(got);
            });
          }
        });

        it(`recognises at least ${confirmBar * 100}% of confirm phrases`, async () => {
          const cases = set.phrases.filter((c) => c.intent === 'confirm');
          const misses: string[] = [];
          for (const c of cases) {
            const got = await matcher(c.text, { language, purpose: c.context ?? 'reminder' });
            if (got !== 'confirm') misses.push(`${c.id} "${c.text}" -> ${got}`);
          }
          const rate = (cases.length - misses.length) / cases.length;
          expect(rate, `misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(confirmBar);
        });

        it(`lands on an acceptable intent for at least ${overallBar * 100}% of cases`, async () => {
          const misses: string[] = [];
          for (const c of set.phrases) {
            const got = await matcher(c.text, { language, purpose: c.context ?? 'reminder' });
            if (!acceptable(c).includes(got)) misses.push(`${c.id} "${c.text}" expected ${acceptable(c).join('|')} got ${got}`);
          }
          const rate = (set.phrases.length - misses.length) / set.phrases.length;
          expect(rate, `misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(overallBar);
        });
      });
    }
  });
}
