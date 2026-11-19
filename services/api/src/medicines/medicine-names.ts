import { Injectable } from '@nestjs/common';
import { MedicineKind } from './look-alike';

export const MEDICINE_NAME_SOURCE = Symbol('MEDICINE_NAME_SOURCE');

export interface MedicineName {
  name: string;
  kind: MedicineKind;
}

/**
 * Autocomplete source (#30). Names only: no composition, no equivalence (safety rule 2).
 * FOLLOW-UP: replace the seed list with an import of the government drug-code data
 * once its licence has been confirmed for this use.
 */
export interface MedicineNameSource {
  search(q: string, kind: MedicineKind | undefined, limit: number): Promise<MedicineName[]>;
}

/** A small seed list of common names on Indian strips and bottles. */
export const SEED_MEDICINE_NAMES: MedicineName[] = [
  ['Amlodac', 'tablet'], ['Amlong', 'tablet'], ['Atorva', 'tablet'], ['Azithral', 'tablet'], ['Calpol', 'tablet'],
  ['Cardace', 'tablet'], ['Concor', 'tablet'], ['Crocin', 'tablet'], ['Dolo 650', 'tablet'], ['Ecosprin', 'tablet'],
  ['Eltroxin', 'tablet'], ['Galvus', 'tablet'], ['Gemer', 'tablet'], ['Glycomet', 'tablet'], ['Janumet', 'tablet'],
  ['Losar', 'tablet'], ['Met XL', 'tablet'], ['Pan 40', 'tablet'], ['Rosuvas', 'tablet'], ['Shelcal', 'tablet'],
  ['Stamlo', 'tablet'], ['Telma', 'tablet'], ['Thyronorm', 'tablet'], ['Zyloric', 'tablet'],
  ['Becosules', 'capsule'], ['Evion', 'capsule'], ['Omez', 'capsule'], ['Pantocid DSR', 'capsule'], ['Rabekind DSR', 'capsule'],
  ['Revital', 'capsule'], ['Uprise D3', 'capsule'],
  ['Ascoril', 'syrup'], ['Benadryl', 'syrup'], ['Cremaffin', 'syrup'], ['Cuff-off', 'syrup'], ['Digene', 'syrup'],
  ['Duphalac', 'syrup'], ['Grilinctus', 'syrup'], ['Liv 52', 'syrup'], ['Mucaine', 'syrup'],
].map(([name, kind]) => ({ name, kind: kind as MedicineKind }));

@Injectable()
export class SeedMedicineNameSource implements MedicineNameSource {
  async search(q: string, kind: MedicineKind | undefined, limit: number): Promise<MedicineName[]> {
    const needle = q.trim().toLowerCase();
    const matches = SEED_MEDICINE_NAMES.filter((m) => (!kind || m.kind === kind) && m.name.toLowerCase().includes(needle));
    // Prefix matches first, then alphabetical.
    matches.sort((a, b) => {
      const pa = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const pb = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
      return pa - pb || a.name.localeCompare(b.name);
    });
    return matches.slice(0, limit);
  }
}
