import { describe, expect, it } from 'vitest';
import {
  LANGUAGES, loadScript, reminderFull, reminderShort, sundayLine, medicineItem,
  appearancePhrase, packPhrase, disambiguatorPhrase, render,
  type MedicineForCall,
} from '../src';

const people = { personName: 'Kamla Devi', childName: 'Ravi' };

// Family entries, deliberately in mixed scripts: they must come out exactly as typed.
const meds: MedicineForCall[] = [
  {
    kind: 'tablet', spokenName: 'BP वाली', stripName: 'Amlodac', amountText: '1 गोली',
    food: 'after', colourPrimary: 'white', shape: 'round', size: 'small', marking: 'line',
    keptIn: 'strip', packColour: 'red', numberLabel: 1, extraInstruction: 'Paani ke saath lena',
  },
  {
    kind: 'capsule', spokenName: 'sugar wali', stripName: 'Glycomet', amountText: '1 capsule',
    food: 'before', colourPrimary: 'red', colourSecondary: 'yellow', size: 'large',
    keptIn: 'strip', packColour: 'silver', printColour: 'green', sayPrintedName: true,
  },
  {
    kind: 'syrup', spokenName: 'khansi ki dawai', stripName: 'Benadryl', amountText: '1 chammach (5 ml)',
    food: 'any', keptIn: 'bottle', packColour: 'brown', capColour: 'orange',
  },
  {
    kind: 'tablet', spokenName: 'thyroid', stripName: 'Thyronorm', amountText: 'aadhi goli',
    food: 'with', colourPrimary: 'Halka neela', keptIn: 'loose',
  },
];

describe.each(LANGUAGES)('%s composition', (lang) => {
  const script = loadScript(lang);

  it('full reminder says every family value verbatim and leaves no template syntax behind', () => {
    const lines = reminderFull(script, people, meds);
    const all = lines.join('\n');
    for (const m of meds) {
      expect(all).toContain(m.spokenName);
      expect(all).toContain(m.amountText);
    }
    expect(all).toContain('Paani ke saath lena');
    expect(all).toContain('Halka neela'); // unknown colour is spoken as typed
    expect(all).toContain('G-L-Y-C-O-M-E-T');
    expect(all).toContain(people.personName);
    expect(all).toContain(people.childName);
    expect(all).not.toMatch(/[{}[\]]|undefined|null|NaN/);
    for (const line of lines) expect(line.trim()).not.toBe('');
    expect(all).toContain(script.blocks.counts[3]!); // "4 medicines"
    expect(lines).toHaveLength(2 + meds.length + 2);
  });

  it('one medicine uses the singular count line', () => {
    const lines = reminderFull(script, people, [meds[0]!]);
    expect(lines[1]).toBe(script.templates.reminder_full.count_one);
  });

  it('builds every appearance, pack and disambiguator combination without gaps', () => {
    for (const m of meds) {
      const item = medicineItem(script, m, 0);
      expect(item).not.toMatch(/,\s*,|\s{2,}|^\s|\s$/);
    }
    expect(appearancePhrase(script, meds[2]!)).toBe(''); // syrup: appearance comes from the bottle
    const withCap = packPhrase(script, meds[2]!);
    const noCap = packPhrase(script, { ...meds[2]!, capColour: null });
    expect(withCap).not.toContain('{');
    expect(withCap.length).toBeGreaterThan(noCap.length); // the cap colour is spoken only when the family entered one
    expect(withCap.startsWith(noCap.replace(/[,\s]+$/, ''))).toBe(true);
    expect(packPhrase(script, { ...meds[0]!, keptIn: null })).toBe('');
    expect(packPhrase(script, { ...meds[0]!, packColour: null })).toBe('');
    expect(disambiguatorPhrase(script, { ...meds[0]!, numberLabel: null, sayPrintedName: false })).toBe('');
  });

  it('short reminder: single and grouped', () => {
    const single = reminderShort(script, people, [meds[0]!]).join(' ');
    expect(single).toContain('BP वाली');
    expect(single).toContain('1 गोली');
    expect(single).toContain(script.blocks.food.after);
    const any = reminderShort(script, people, [meds[2]!]).join(' ');
    expect(any).toContain('1 chammach (5 ml)');
    expect(any).not.toMatch(/,\s*[.।]/);
    const group = reminderShort(script, people, meds);
    expect(group).toHaveLength(meds.length + 2);
  });

  it('Sunday line names the medicine and the number, only for numbered strips', () => {
    const line = sundayLine(script, meds[0]!);
    expect(line).toContain('BP वाली');
    expect(line).toContain('1');
    expect(sundayLine(script, meds[1]!)).toBe('');
  });

  it('every fixed template renders with sample names', () => {
    const v = { person_name: 'Kamla Devi', child_name: 'Ravi', relation_phrase: 'aapke bete' };
    for (const group of ['consent', 'reply_ack', 'unclear', 'repeat', 'test_call'] as const) {
      for (const tpl of Object.values(script.templates[group])) {
        expect(render(tpl, v)).not.toBe('');
      }
    }
  });
});

describe('Hindi matches the docs/call-scripts.md example', () => {
  const hi = loadScript('hi');
  it('builds the first medicine line', () => {
    expect(medicineItem(hi, meds[0]!, 0)).toBe(
      'पहली दवाई, BP वाली: 1 गोली, सफ़ेद गोल गोली, छोटी, बीच में लाइन, लाल पत्ते वाली, 1 नंबर वाली। खाने के बाद। Paani ke saath lena',
    );
  });
  it('agrees colour with the noun', () => {
    expect(appearancePhrase(hi, { ...meds[0]!, colourPrimary: "yellow", shape: null })).toContain("पीली गोली");
    expect(packPhrase(hi, { ...meds[0]!, packColour: 'yellow' })).toBe('पीले पत्ते वाली');
    expect(packPhrase(hi, meds[2]!)).toBe('भूरी बोतल वाली, नारंगी ढक्कन');
  });
});
