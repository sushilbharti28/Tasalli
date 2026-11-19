import { referenceMatcher } from '../reference/reference-matcher';
import { describeSpeechMatcher } from './suite';

// Proves the suite and the phrase set agree with a matcher that follows rule 4.
describeSpeechMatcher('reference matcher', referenceMatcher);

import { describe, expect, it } from 'vitest';
import type { ReplyMatcher } from '../reference/reference-matcher';
import { LANGUAGES, PHRASE_SETS, forbiddenIntents } from './phrase-set';

/** A matcher that checks positives first: the bug rule 4 exists to prevent. */
const positiveFirst: ReplyMatcher = (t) => (/(le li|haan|yes|taken|ho|kheyechi|aamaa|avunu|ghetli|हाँ|ले ली)/i.test(t ?? '') ? 'confirm' : 'unclear');

describe('the safety suite bites', () => {
  it('a positive-first matcher produces false confirmations on the set', async () => {
    let failures = 0;
    for (const l of LANGUAGES) {
      for (const c of PHRASE_SETS[l].phrases) {
        const got = await positiveFirst(c.text, { language: l, purpose: 'reminder' });
        if (forbiddenIntents(c).includes(got)) failures += 1;
      }
    }
    expect(failures).toBeGreaterThanOrEqual(10);
  });
});
