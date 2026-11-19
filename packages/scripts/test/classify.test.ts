import { describe, expect, it } from 'vitest';
import { LANGUAGES, classifyReply, containsPhrase, loadScript, normalise } from '../src';

describe('normalise / containsPhrase', () => {
  it('ignores case, punctuation, nukta and chandrabindu/anusvara', () => {
    expect(normalise('Haan, LE LI!')).toBe('haan le li');
    expect(normalise('नहीं।')).toBe(normalise('नही'));
    expect(normalise('ख़त्म')).toBe(normalise('खत्म'));
    expect(normalise('हाँ')).toBe(normalise('हां'));
  });
  it('matches whole words in order only', () => {
    expect(containsPhrase('haan le li ji', 'le li')).toBe(true);
    expect(containsPhrase('leli', 'le li')).toBe(false);
    expect(containsPhrase('li le', 'le li')).toBe(false);
    expect(containsPhrase('nahin', 'nahi')).toBe(false);
  });
});

describe.each(LANGUAGES)('%s replies (safety rule 4: "no" beats "yes")', (lang) => {
  const { replies } = loadScript(lang);
  const r = (t: string | null) => classifyReply(t, replies, 'reminder');

  it('silence, empty and unknown speech are unclear, never confirm', () => {
    expect(r(null)).toBe('unclear');
    expect(r('')).toBe('unclear');
    expect(r('   ...  ')).toBe('unclear');
    expect(r('xyzzy plugh')).toBe('unclear');
  });

  it('every confirm phrase on its own is a confirmation', () => {
    for (const p of replies.confirm) expect(r(p), p).toBe('confirm');
  });

  it('no negative phrase is ever a confirmation, alone or mixed with a confirm phrase', () => {
    for (const neg of replies.negative) {
      expect(r(neg), neg).not.toBe('confirm');
      for (const yes of replies.confirm) {
        expect(r(`${yes} ${neg}`), `${yes} ${neg}`).not.toBe('confirm');
        expect(r(`${neg} ${yes}`), `${neg} ${yes}`).not.toBe('confirm');
        expect(r(`${neg}, ${yes}.`), `${neg}, ${yes}.`).not.toBe('confirm');
      }
    }
  });

  it('snooze, repeat, doctor_changed, unwell and stop each win over confirm', () => {
    const yes = replies.confirm[0]!;
    for (const list of ['snooze', 'repeat', 'doctor_changed', 'unwell', 'stop'] as const) {
      for (const p of replies[list]) {
        expect(r(p), `${list}: ${p}`).toBe(list);
        expect(r(`${yes} ${p}`), `${yes} ${p}`).not.toBe('confirm');
      }
    }
  });

  it('a stop phrase always stops, even with other words around it', () => {
    for (const p of replies.stop) {
      for (const other of [...replies.confirm, ...replies.snooze, ...replies.negative]) {
        expect(r(`${other} ${p}`), `${other} ${p}`).toBe('stop');
      }
    }
  });

  it('consent: stop, then no, then yes; anything else is unclear', () => {
    const c = (t: string) => classifyReply(t, replies, 'consent');
    for (const p of replies.consent_yes) expect(c(p), p).toBe('confirm');
    for (const p of replies.consent_no) expect(c(p), p).toBe('decline');
    for (const p of replies.stop) expect(c(p), p).toBe('stop');
    for (const no of replies.consent_no) {
      for (const yes of replies.consent_yes) expect(c(`${yes} ${no}`)).not.toBe('confirm');
    }
    expect(c('xyzzy')).toBe('unclear');
  });
});

describe('specific phrases', () => {
  const hi = loadScript('hi').replies;
  const en = loadScript('en').replies;
  const te = loadScript('te').replies;
  const r = (t: string, rep = hi) => classifyReply(t, rep, 'reminder');

  it('Hindi', () => {
    expect(r('haan le li')).toBe('confirm');
    expect(r('हाँ, ले ली है')).toBe('confirm');
    expect(r('ले ली ना')).toBe('confirm'); // "na" as a tag is not a no
    expect(r('nahi li')).toBe('decline');
    expect(r('नहीं ली अभी')).toBe('decline');
    expect(r('abhi nahi')).toBe('decline');
    expect(r('baad mein')).toBe('snooze');
    expect(r('dawai khatam ho gayi')).not.toBe('confirm'); // ran out
    expect(r('ख़त्म हो गया')).not.toBe('confirm');
    expect(r('samajh nahi aaya')).toBe('repeat');
    expect(r('doctor ne badli')).toBe('doctor_changed');
    expect(r('band karo')).toBe('stop');
    expect(r('mat karo phone')).toBe('stop');
    expect(r('tabiyat theek nahi hai')).toBe('unwell');
  });

  it('English', () => {
    expect(r('Yes, I took it.', en)).toBe('confirm');
    expect(r("I haven't taken it", en)).toBe('decline');
    expect(r('No, not yet', en)).toBe('decline');
    expect(r('The medicine is finished', en)).not.toBe('confirm');
    expect(r("Don't call me", en)).toBe('stop');
  });

  it('Telugu: "ayipoyindi" (ran out / done) is never a confirmation', () => {
    expect(r('మందు అయిపోయింది', te)).not.toBe('confirm');
    expect(r('వేసుకున్నాను', te)).toBe('confirm');
    expect(r('ఇంకా వేసుకోలేదు', te)).toBe('decline');
  });
});
