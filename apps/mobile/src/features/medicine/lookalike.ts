/**
 * Look-alike check. Safety rule 2: compares APPEARANCE FIELDS ONLY. It never looks at the
 * name, strength or anything about what is inside a medicine.
 *
 * Used by the check screen to preview a likely conflict before saving, and by the mock API.
 * The real API's `lookAlike` response is authoritative after saving.
 */
import type { CanReadStrip, LookAlikeConflict, MedicineCreate } from '@/api/types';

type Comparable = Pick<MedicineCreate, 'kind' | 'appearance' | 'numberLabel' | 'sayPrintedName'> & { id?: string };

const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();

/** Same body: colour(s), shape and size all known and equal. */
function sameBody(a: Comparable, b: Comparable): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'syrup') {
    const pa = norm(a.appearance?.packColour);
    const pb = norm(b.appearance?.packColour);
    return !!pa && pa === pb && norm(a.appearance?.capColour) === norm(b.appearance?.capColour);
  }
  if (a.kind === 'other') return false; // free description: no reliable fields to compare
  const keys = ['colourPrimary', 'colourSecondary', 'shape', 'size'] as const;
  const fa = a.appearance ?? {};
  const fb = b.appearance ?? {};
  if (!norm(fa.colourPrimary) || !fa.size) return false;
  return keys.every((k) => norm(fa[k]) === norm(fb[k]));
}

/** Already told apart by numbers or by printed names. */
function alreadyDisambiguated(a: Comparable, b: Comparable): boolean {
  if (a.numberLabel != null && b.numberLabel != null && a.numberLabel !== b.numberLabel) return true;
  if (a.sayPrintedName && b.sayPrintedName) return true;
  return false;
}

function differs(x?: string | null, y?: string | null) {
  return !!norm(x) && !!norm(y) && norm(x) !== norm(y);
}

export function findLookAlikes(
  candidate: Comparable,
  others: Comparable[],
  canReadStrip: CanReadStrip | undefined,
): LookAlikeConflict[] {
  const conflicts: LookAlikeConflict[] = [];
  for (const other of others) {
    if (other.id && other.id === candidate.id) continue;
    if (!sameBody(candidate, other) || alreadyDisambiguated(candidate, other)) continue;
    const a = candidate.appearance ?? {};
    const b = other.appearance ?? {};
    let autoResolvedBy: LookAlikeConflict['autoResolvedBy'] = null;
    if (a.keptIn === 'strip' && b.keptIn === 'strip' && differs(a.packColour, b.packColour)) autoResolvedBy = 'pack_colour';
    else if (differs(a.printColour, b.printColour)) autoResolvedBy = 'print_colour';
    else if (a.marking && b.marking && a.marking !== 'unknown' && b.marking !== 'unknown' && a.marking !== b.marking)
      autoResolvedBy = 'marking';
    conflicts.push({
      otherMedicineId: other.id,
      autoResolvedBy,
      recommended: canReadStrip === 'yes' ? 'say_printed_name' : 'number_label',
    });
  }
  return conflicts;
}

/** Smallest positive number label not used by this person's medicines. */
export function nextNumberLabel(used: (number | null | undefined)[], skip: number[] = []): number {
  const taken = new Set([...used.filter((n): n is number => typeof n === 'number'), ...skip]);
  let n = 1;
  while (taken.has(n)) n += 1;
  return n;
}
