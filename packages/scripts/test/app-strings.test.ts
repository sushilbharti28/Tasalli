import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCRIPTS_DIR } from '../src';

const load = (l: string) => JSON.parse(readFileSync(join(SCRIPTS_DIR, 'app-strings', `${l}.json`), 'utf8'));
function flat(o: unknown, p = ''): Record<string, string> {
  if (typeof o === 'string') return { [p]: o };
  return Object.entries(o as object).reduce((a, [k, v]) => ({ ...a, ...flat(v, p ? `${p}.${k}` : k) }), {});
}
const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('app strings', () => {
  const en = flat(load('en')), hi = flat(load('hi'));
  it('hi has exactly the keys of en', () => expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort()));
  it('hi uses the same {{variables}} as en, and no string is empty', () => {
    for (const k of Object.keys(en)) {
      expect(vars(hi[k]!), k).toEqual(vars(en[k]!));
      expect(hi[k]!.trim(), k).not.toBe('');
    }
  });
  it('hi is written in Devanagari, not left in English', () => {
    const same = Object.keys(en).filter((k) => en[k] === hi[k] && /[A-Za-z]{4,}/.test(en[k]!));
    expect(same.length).toBeLessThan(10);
  });
});
