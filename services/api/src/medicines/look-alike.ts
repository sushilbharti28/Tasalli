/**
 * Look-alike check (#28). Safety rule 2: this compares APPEARANCE ONLY.
 * The input types below deliberately have no name, strength or composition fields,
 * so this module cannot compare what is inside a medicine.
 */
export type MedicineKind = 'tablet' | 'capsule' | 'syrup' | 'other';

export interface AppearanceOnly {
  kind: MedicineKind;
  colourPrimary: string | null;
  colourSecondary: string | null;
  shape: string | null;
  size: string | null;
  marking: string | null;
  keptIn: string | null;
  packColour: string | null;
  printColour: string | null;
  capColour: string | null;
}

export interface LookAlikeCandidate {
  id: string;
  appearance: AppearanceOnly;
  /** The family's own disambiguation choices (not medicine content). */
  numberLabel: number | null;
  sayPrintedName: boolean;
}

export type AutoResolvedBy = 'pack_colour' | 'print_colour' | 'marking';
export type Recommendation = 'number_label' | 'say_printed_name' | 'print_colour';

export interface LookAlikeConflict {
  otherMedicineId: string;
  autoResolvedBy: AutoResolvedBy | null;
  recommended: Recommendation;
}

const norm = (v: string | null | undefined): string | null => {
  const t = v?.trim().toLowerCase();
  return t ? t : null;
};
/** Unknown counts as "could be the same": when in doubt, flag it. */
const sameOrUnknown = (a: string | null, b: string | null) => a === null || b === null || a === b;
const bothKnownAndDifferent = (a: string | null, b: string | null) => a !== null && b !== null && a !== b;

function normalise(a: AppearanceOnly): AppearanceOnly {
  return {
    kind: a.kind,
    colourPrimary: norm(a.colourPrimary),
    colourSecondary: norm(a.colourSecondary),
    shape: norm(a.shape),
    size: norm(a.size),
    marking: norm(a.marking) === 'unknown' ? null : norm(a.marking),
    keptIn: norm(a.keptIn),
    packColour: norm(a.packColour),
    printColour: norm(a.printColour),
    capColour: norm(a.capColour),
  };
}

/** Would the parent possibly mix these two up, judging by what they look like? */
export function looksAlike(x: AppearanceOnly, y: AppearanceOnly): boolean {
  const a = normalise(x);
  const b = normalise(y);
  if (a.kind !== b.kind) return false; // a syrup bottle never looks like a tablet; tablets and capsules differ
  if (a.kind === 'syrup') {
    return sameOrUnknown(a.packColour, b.packColour) && sameOrUnknown(a.capColour, b.capColour);
  }
  return (
    sameOrUnknown(a.colourPrimary, b.colourPrimary) &&
    sameOrUnknown(a.colourSecondary, b.colourSecondary) &&
    sameOrUnknown(a.shape, b.shape) &&
    sameOrUnknown(a.size, b.size)
  );
}

/**
 * For two look-alikes, a difference the call can mention: pack colour, then print
 * colour, then marking. Pack and print colour only help when neither is kept loose.
 */
export function autoResolve(x: AppearanceOnly, y: AppearanceOnly): AutoResolvedBy | null {
  const a = normalise(x);
  const b = normalise(y);
  const packaged = a.keptIn !== 'loose' && b.keptIn !== 'loose';
  if (a.kind !== 'syrup' && packaged && bothKnownAndDifferent(a.packColour, b.packColour)) return 'pack_colour';
  if (packaged && bothKnownAndDifferent(a.printColour, b.printColour)) return 'print_colour';
  if (a.kind !== 'syrup' && bothKnownAndDifferent(a.marking, b.marking)) return 'marking';
  return null;
}

/** Parent can read the printed name -> say it; otherwise (no / not sure) -> a number written on the strip. */
export function recommend(canReadStrip: 'yes' | 'no' | 'not_sure'): Recommendation {
  return canReadStrip === 'yes' ? 'say_printed_name' : 'number_label';
}

/** The family already told them apart: distinct numbers on both, or the printed name said for both. */
function resolvedByFamily(a: LookAlikeCandidate, b: LookAlikeCandidate): boolean {
  if (a.numberLabel !== null && b.numberLabel !== null && a.numberLabel !== b.numberLabel) return true;
  return a.sayPrintedName && b.sayPrintedName;
}

export function findLookAlikes(
  target: LookAlikeCandidate,
  others: LookAlikeCandidate[],
  canReadStrip: 'yes' | 'no' | 'not_sure',
): LookAlikeConflict[] {
  const out: LookAlikeConflict[] = [];
  for (const other of others) {
    if (other.id === target.id) continue;
    if (!looksAlike(target.appearance, other.appearance)) continue;
    if (resolvedByFamily(target, other)) continue;
    out.push({
      otherMedicineId: other.id,
      autoResolvedBy: autoResolve(target.appearance, other.appearance),
      recommended: recommend(canReadStrip),
    });
  }
  return out;
}
