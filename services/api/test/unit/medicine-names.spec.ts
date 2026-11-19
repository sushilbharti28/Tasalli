import { SEED_MEDICINE_NAMES, SeedMedicineNameSource } from '../../src/medicines/medicine-names';
import { FakeScriptPreviewer } from '../../src/medicines/script-previewer';

describe('medicine name autocomplete (seed list)', () => {
  const source = new SeedMedicineNameSource();

  it('filters by kind and puts prefix matches first', async () => {
    const out = await source.search('am', 'tablet', 20);
    expect(out.map((m) => m.name)).toEqual(['Amlodac', 'Amlong', 'Stamlo']);
    expect(out.every((m) => m.kind === 'tablet')).toBe(true);
  });

  it('is case-insensitive and respects the limit', async () => {
    expect((await source.search('DOLO', undefined, 20))[0].name).toBe('Dolo 650');
    expect(await source.search('o', undefined, 3)).toHaveLength(3);
  });

  it('holds names and kinds only, never composition (safety rule 2)', () => {
    for (const m of SEED_MEDICINE_NAMES) expect(Object.keys(m).sort()).toEqual(['kind', 'name']);
  });
});

describe('fake script preview', () => {
  it('repeats the family entries verbatim (safety rule 1)', async () => {
    const out = await new FakeScriptPreviewer().preview({
      personName: 'Papa', language: 'hi', spokenName: 'BP wali', amountText: '1 goli (aadhi nahi)', food: 'after',
      extraInstruction: 'Paani ke saath', disambiguator: { numberLabel: 1, sayPrintedName: false, stripName: 'Amlodac' },
    });
    expect(out.text).toContain('BP wali');
    expect(out.text).toContain('1 goli (aadhi nahi)');
    expect(out.text).toContain('Paani ke saath');
    expect(out.text).toContain('number 1');
  });
});
