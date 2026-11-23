import { AppearanceOnly, autoResolve, findLookAlikes, LookAlikeCandidate, looksAlike, recommend } from '../../src/medicines/look-alike';

const tablet = (over: Partial<AppearanceOnly> = {}): AppearanceOnly => ({
  kind: 'tablet', colourPrimary: 'white', colourSecondary: null, shape: 'round', size: 'small', marking: 'plain',
  keptIn: 'strip', packColour: null, printColour: null, capColour: null, ...over,
});
const cand = (id: string, appearance: AppearanceOnly, extra: Partial<LookAlikeCandidate> = {}): LookAlikeCandidate => ({
  id, appearance, numberLabel: null, sayPrintedName: false, ...extra,
});

describe('look-alike check (appearance only, safety rule 2)', () => {
  it('two small white round tablets look alike', () => {
    expect(looksAlike(tablet(), tablet())).toBe(true);
  });

  it('colour comparison ignores case and spaces', () => {
    expect(looksAlike(tablet({ colourPrimary: ' White ' }), tablet({ colourPrimary: 'white' }))).toBe(true);
  });

  it('a different colour, shape or size means no look-alike', () => {
    expect(looksAlike(tablet(), tablet({ colourPrimary: 'pink' }))).toBe(false);
    expect(looksAlike(tablet(), tablet({ shape: 'oval' }))).toBe(false);
    expect(looksAlike(tablet(), tablet({ size: 'large' }))).toBe(false);
  });

  it('unknown fields are treated as possibly the same (flag when in doubt)', () => {
    expect(looksAlike(tablet({ shape: null, size: null }), tablet())).toBe(true);
  });

  it('different kinds are never compared', () => {
    expect(looksAlike(tablet(), { ...tablet(), kind: 'capsule' })).toBe(false);
  });

  it('syrups compare bottle and cap colour', () => {
    const syrup = (pack: string, cap: string): AppearanceOnly => ({ ...tablet(), kind: 'syrup', colourPrimary: null, shape: null, size: null, marking: null, keptIn: 'bottle', packColour: pack, capColour: cap });
    expect(looksAlike(syrup('brown', 'orange'), syrup('brown', 'orange'))).toBe(true);
    expect(looksAlike(syrup('brown', 'orange'), syrup('brown', 'white'))).toBe(false);
  });

  it('auto-resolves by pack colour first, then print colour, then marking', () => {
    expect(autoResolve(tablet({ packColour: 'red' }), tablet({ packColour: 'silver' }))).toBe('pack_colour');
    expect(autoResolve(tablet({ printColour: 'green' }), tablet({ printColour: 'blue' }))).toBe('print_colour');
    expect(autoResolve(tablet({ marking: 'line' }), tablet({ marking: 'plain' }))).toBe('marking');
    expect(autoResolve(tablet(), tablet())).toBeNull();
  });

  it('pack and print colour do not help for loose tablets; unknown marking never resolves', () => {
    expect(autoResolve(tablet({ keptIn: 'loose', packColour: 'red' }), tablet({ packColour: 'silver' }))).toBeNull();
    expect(autoResolve(tablet({ marking: 'unknown' }), tablet({ marking: 'line' }))).toBeNull();
  });

  it('recommends saying the printed name only when the parent can read the strip', () => {
    expect(recommend('yes')).toBe('say_printed_name');
    expect(recommend('no')).toBe('number_label');
    expect(recommend('not_sure')).toBe('number_label');
  });

  it('findLookAlikes reports conflicts with the recommendation', () => {
    const out = findLookAlikes(cand('new', tablet()), [cand('a', tablet()), cand('b', tablet({ colourPrimary: 'yellow' }))], 'no');
    expect(out).toEqual([{ otherMedicineId: 'a', autoResolvedBy: null, recommended: 'number_label' }]);
  });

  it('already told apart by the family (distinct numbers, or printed names on both) is not reported', () => {
    expect(findLookAlikes(cand('n', tablet(), { numberLabel: 1 }), [cand('a', tablet(), { numberLabel: 2 })], 'no')).toEqual([]);
    expect(findLookAlikes(cand('n', tablet(), { sayPrintedName: true }), [cand('a', tablet(), { sayPrintedName: true })], 'yes')).toEqual([]);
    // Only one side numbered: still a conflict.
    expect(findLookAlikes(cand('n', tablet(), { numberLabel: 1 }), [cand('a', tablet())], 'no')).toHaveLength(1);
  });

  it('the comparison input has no name, strength or composition fields at all', () => {
    // Type-level guarantee checked at runtime too: only appearance keys exist.
    const keys = Object.keys(tablet()).sort();
    expect(keys).toEqual(['capColour', 'colourPrimary', 'colourSecondary', 'keptIn', 'kind', 'marking', 'packColour', 'printColour', 'shape', 'size']);
  });
});
