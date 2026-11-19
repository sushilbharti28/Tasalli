import { emptyDraft, nextStep, progress, setKind, stepsFor, toMedicineCreate, validateStep } from '@/features/medicine/draft';
import { findLookAlikes } from '@/features/medicine/lookalike';

describe('medicine steps branch by kind', () => {
  it('syrup skips "how it is kept"; other kinds keep it', () => {
    expect(stepsFor('syrup')).toEqual(['kind', 'name', 'looks', 'amount', 'check']);
    for (const k of ['tablet', 'capsule', 'other'] as const) expect(stepsFor(k)).toContain('kept');
    expect(nextStep('looks', 'syrup')).toBe('amount');
    expect(nextStep('looks', 'tablet')).toBe('kept');
    expect(nextStep('check', 'tablet')).toBeNull();
  });
  it('progress total follows the kind', () => {
    expect(progress('amount', 'syrup')).toMatchObject({ index: 4, total: 5 });
    expect(progress('amount', 'tablet')).toMatchObject({ index: 5, total: 6 });
  });
  it('changing kind clears answers of the old kind', () => {
    const d = { ...emptyDraft('2027-01-18'), kind: 'tablet' as const, colourPrimary: 'white', shape: 'round' as const };
    const s = setKind(d, 'syrup');
    expect(s.kind).toBe('syrup');
    expect(s.colourPrimary).toBeUndefined();
    expect(s.shape).toBeUndefined();
  });
  it('requires a kind and a name before moving on', () => {
    const d = emptyDraft('2027-01-18');
    expect(Object.keys(validateStep('kind', d)).length).toBeGreaterThan(0);
    expect(Object.keys(validateStep('name', { ...d, kind: 'tablet' })).length).toBeGreaterThan(0);
  });
  it('syrup is saved as a bottle with the amount exactly as entered', () => {
    const d = {
      ...emptyDraft('2027-01-18'), kind: 'syrup' as const, stripName: 'Cough syrup', spokenName: 'khansi ki dawa',
      bottleColour: 'brown', capColour: 'white', syrupQty: '2', syrupUnit: 'chammach' as const,
      slots: [{ slot: 'morning' as const, time: '08:00' }],
    };
    const m = toMedicineCreate(d);
    expect(m.appearance?.keptIn).toBe('bottle');
    expect(m.schedules[0].amountText).toBe('2 chammach');
    expect(m.schedules[0].localTime).toBe('08:00');
  });
});

describe('look-alike (appearance only)', () => {
  const tab = (packColour: string, extra = {}) => ({
    kind: 'tablet' as const,
    appearance: { colourPrimary: 'white', shape: 'round' as const, size: 'matar' as const, keptIn: 'strip' as const, packColour, ...extra },
  });
  it('resolves automatically when strip colour differs', () => {
    const [c] = findLookAlikes(tab('red'), [{ id: 'x', ...tab('blue') }], 'no');
    expect(c.autoResolvedBy).toBe('pack_colour');
  });
  it('recommends numbers when they cannot read, printed name when they can', () => {
    const same = [{ id: 'x', ...tab('red') }];
    expect(findLookAlikes(tab('red'), same, 'no')[0]).toMatchObject({ autoResolvedBy: null, recommended: 'number_label' });
    expect(findLookAlikes(tab('red'), same, 'yes')[0].recommended).toBe('say_printed_name');
  });
});
