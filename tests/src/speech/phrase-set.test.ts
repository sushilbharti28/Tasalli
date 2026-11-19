import { describe, expect, it } from 'vitest';
import { CONSENT_KEYS, REMINDER_KEYS } from '@tasalli/contracts';
import { LANGUAGES, PHRASE_SETS } from './phrase-set';

const INTENTS = new Set([...Object.values(REMINDER_KEYS), ...Object.values(CONSENT_KEYS), 'decline', 'unwell', 'unclear']);

describe('speech test set is well formed', () => {
  it('covers all 6 call languages', () => {
    expect(LANGUAGES.sort()).toEqual(['bn', 'en', 'hi', 'mr', 'ta', 'te']);
  });

  it('has unique ids', () => {
    const ids = LANGUAGES.flatMap((l) => PHRASE_SETS[l].phrases.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const l of LANGUAGES) {
    describe(l, () => {
      const set = PHRASE_SETS[l];
      it('declares its language and only valid intents', () => {
        expect(set.language).toBe(l);
        for (const p of set.phrases) {
          expect(INTENTS.has(p.intent), p.id).toBe(true);
          for (const a of p.alsoAccept ?? []) expect(INTENTS.has(a), p.id).toBe(true);
        }
      });
      it('never lists confirm as an alternative for a non-confirm case', () => {
        for (const p of set.phrases) if (p.intent !== 'confirm') expect(p.alsoAccept ?? []).not.toContain('confirm');
      });
      it('has enough negatives, tricky cases, future-tense cases, silence and consent cases', () => {
        const ps = set.phrases;
        expect(ps.filter((p) => p.intent === 'confirm').length).toBeGreaterThanOrEqual(5);
        expect(ps.filter((p) => p.tags?.includes('negative')).length).toBeGreaterThanOrEqual(5);
        expect(ps.filter((p) => p.tags?.includes('tricky')).length).toBeGreaterThanOrEqual(3);
        expect(ps.some((p) => p.tags?.includes('future'))).toBe(true);
        expect(ps.some((p) => p.text === '')).toBe(true);
        expect(ps.some((p) => p.context === 'consent' && p.intent === 'confirm')).toBe(true);
        expect(ps.some((p) => p.context === 'consent' && p.intent !== 'confirm')).toBe(true);
      });
    });
  }
});
