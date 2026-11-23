import { describe, expect, it } from 'vitest';
import { numberToWords, speakNumbers } from '../src/scripts/spoken-numbers.js';

const r = (t: string) => speakNumbers(t, 'roman');
const d = (t: string) => speakNumbers(t, 'devanagari');

describe('speakNumbers (speech only)', () => {
  it('the examples from the brief', () => {
    expect(r('1 capsule')).toBe('ek capsule');
    expect(r('Allegra 120mg')).toBe('Allegra ek sau bees milligram');
    expect(r('1 chammach (5 ml)')).toBe('ek chammach (paanch milli litre)');
    expect(r('Glycomet 500')).toBe('Glycomet paanch sau');
    expect(r('Telma 40')).toBe('Telma chaalees');
    expect(r('120')).toBe('ek sau bees');
  });
  it('halves and decimals', () => {
    expect(r('0.5 goli')).toBe('aadha goli');
    expect(r('½ goli')).toBe('aadha goli');
    expect(r('1/2 goli')).toBe('aadha goli');
    expect(r('half goli')).toBe('aadha goli');
    expect(r('1.5 goli')).toBe('dedh goli');
    expect(r('1½ goli')).toBe('dedh goli');
    expect(r('1 1/2 goli')).toBe('dedh goli');
    expect(r('2.5 goli')).toBe('dhaai goli');
    expect(r('2.5 ml')).toBe('dhaai milli litre');
    expect(r('3.5 ml')).toBe('teen point paanch milli litre');
    expect(r('0.25 mg')).toBe('zero point do paanch milligram');
  });
  it('units', () => {
    expect(r('500 mg')).toBe('paanch sau milligram');
    expect(r('10 mcg')).toBe('das microgram');
    expect(r('5 g')).toBe('paanch gram');
    expect(r('1000 IU')).toBe('ek hazaar unit');
    expect(r('5 ml')).toBe('paanch milli litre');
    expect(r('1 goli')).toBe('ek goli'); // "g" of goli is not a unit
    expect(r('2 gram')).toBe('do gram');
  });
  it('Devanagari', () => {
    expect(d('1 capsule')).toBe('एक capsule');
    expect(d('Allegra 120mg')).toBe('Allegra एक सौ बीस मिलीग्राम');
    expect(d('5 ml')).toBe('पाँच मिली लीटर');
    expect(d('1.5 गोली')).toBe('डेढ़ गोली');
    expect(d('2.5 गोली')).toBe('ढाई गोली');
    expect(d('0.5')).toBe('आधा');
    expect(d('1 दबाइए')).toBe('एक दबाइए');
    expect(d('40')).toBe('चालीस');
  });
  it('leaves no digit behind, in sentences too', () => {
    const t = r('Pehli dawai: Telma 40. Le li ho to 1 dabaiye, ya 0 dabaiye. B12, 2 number wali, 10 minute baad. 123456');
    expect(t).not.toMatch(/\d/);
    expect(t).toContain('B baarah');
    expect(t).toContain('do number wali');
    expect(t).toContain('das minute');
  });
  it('text without numbers is unchanged', () => {
    const t = 'Le li ho to "le li" ya "haan" boliye. Dobara sunne ke liye "phir se" boliye.';
    expect(r(t)).toBe(t);
    expect(d('नमस्ते Mummy जी।')).toBe('नमस्ते Mummy जी।');
  });
  it('is idempotent (applying it twice changes nothing)', () => {
    const once = r('Telma 40, 1.5 goli, 5 ml');
    expect(r(once)).toBe(once);
  });
});

describe('numberToWords keeps the value: every number 1..999 has its own words', () => {
  for (const script of ['roman', 'devanagari'] as const) {
    it(script, () => {
      const seen = new Map<string, number>();
      for (let n = 0; n <= 999; n++) {
        const w = numberToWords(n, script);
        expect(w, `${n}`).not.toMatch(/\d/);
        expect(seen.get(w), `${n} and ${seen.get(w)} sound the same`).toBeUndefined();
        seen.set(w, n);
      }
    });
  }
  it('spot checks 1..99 and hundreds', () => {
    const roman: Record<number, string> = { 1: 'ek', 2: 'do', 3: 'teen', 11: 'gyaarah', 21: 'ikkees', 40: 'chaalees', 75: 'pachhattar', 99: 'ninyaanave',
      100: 'ek sau', 120: 'ek sau bees', 500: 'paanch sau', 999: 'nau sau ninyaanave', 1000: 'ek hazaar', 2500: 'do hazaar paanch sau' };
    for (const [n, w] of Object.entries(roman)) expect(numberToWords(Number(n), 'roman')).toBe(w);
    expect(numberToWords(120, 'devanagari')).toBe('एक सौ बीस');
  });
  it('very large or zero-padded numbers are read digit by digit, never changed', () => {
    expect(numberToWords('123456', 'roman')).toBe('ek do teen chaar paanch chhah');
    expect(numberToWords('007', 'roman')).toBe('zero zero saat');
  });
});
