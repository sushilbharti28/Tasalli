import { describe, expect, it } from 'vitest';
import { MissingValueError, render, spellOut, templateVariables, wordForm } from '../src';

describe('render', () => {
  it('inserts values verbatim, including spacing and symbols inside them', () => {
    const out = render('{a}: {b}', { a: 'BP  wali', b: '1 goli (5 mg) [aadhi nahi]' });
    expect(out).toBe('BP  wali: 1 goli (5 mg) [aadhi nahi]');
  });

  it('does not treat braces or brackets inside a value as template syntax', () => {
    expect(render('{x}', { x: '{child_name} [y]' })).toBe('{child_name} [y]');
  });

  it('drops an optional segment when a value inside it is empty', () => {
    const tpl = '{n}[, {food}].';
    expect(render(tpl, { n: 'X', food: 'khane ke baad' })).toBe('X, khane ke baad.');
    expect(render(tpl, { n: 'X', food: '' })).toBe('X.');
    expect(render(tpl, { n: 'X' })).toBe('X.');
  });

  it('throws when a required value is missing, or returns empty when not strict', () => {
    expect(() => render('Namaste {person_name} ji', {})).toThrow(MissingValueError);
    expect(render('{pack_colour} patte se', {}, { strict: false })).toBe('');
  });

  it('picks gendered forms and falls back to m, and leaves plain strings alone', () => {
    const yellow = { m: 'पीला', f: 'पीली', obl: 'पीले' };
    expect(render('{c|f} गोली', { c: yellow })).toBe('पीली गोली');
    expect(render('{c|obl} पत्ते', { c: yellow })).toBe('पीले पत्ते');
    expect(render('{c|n}', { c: yellow })).toBe('पीला');
    expect(render('{c|f} गोली', { c: 'लाल' })).toBe('लाल गोली');
    expect(wordForm({ f: 'x' })).toBe('x');
  });

  it('renders numbers', () => {
    expect(render('{number} नंबर वाली', { number: 2 })).toBe('2 नंबर वाली');
  });

  it('lists template variables', () => {
    expect(templateVariables('{a} [{b|f}] {c}')).toEqual(['a', 'b', 'c']);
  });
});

describe('spellOut', () => {
  it('spells the printed name letter by letter', () => {
    expect(spellOut('Amlodac')).toBe('A-M-L-O-D-A-C');
    expect(spellOut('Glycomet-GP 1')).toBe('G-L-Y-C-O-M-E-T-G-P-1');
  });
});
