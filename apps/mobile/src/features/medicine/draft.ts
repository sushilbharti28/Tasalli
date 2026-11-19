/**
 * Add-medicine wizard logic (pure, unit tested). One question per screen.
 *
 * Safety rule 1: nothing here computes, suggests or changes a dose. Amount chips are just
 * pre-typed text; whatever the family picks or types is sent verbatim as `amountText`.
 * Syrup amounts are never converted between chammach and ml.
 */
import type { CallLanguage, MedicineCreate, MedicineKind, ScheduleInput } from '@/api/types';
import { addDays } from '@/lib/time';

export type StepId = 'kind' | 'name' | 'looks' | 'kept' | 'amount' | 'check';
export type Slot = 'morning' | 'afternoon' | 'evening' | 'night';
export type Food = ScheduleInput['food'];
export type Shape = 'round' | 'oval' | 'long' | 'square';
export type Size = 'rai' | 'dal' | 'matar' | 'badam' | 'bigger';
export type Marking = 'plain' | 'line' | 'letters' | 'unknown';
export type KeptIn = 'strip' | 'loose' | 'bottle';
export type MeasuredWith = 'spoon' | 'cap' | 'cup' | 'syringe';
export type BottleSize = 'small' | 'medium' | 'large';

/** Version 1 kinds, in display order. Drops / inhaler / injection / cream are designed but hidden. */
export const V1_KINDS: MedicineKind[] = ['tablet', 'capsule', 'syrup', 'other'];
export const HIDDEN_KINDS = ['drops', 'inhaler', 'injection', 'cream'] as const;

export const COLOURS = ['white', 'yellow', 'orange', 'pink', 'red', 'brown', 'green', 'blue', 'purple', 'black', 'silver', 'gold', 'clear'] as const;
export const SHAPES: Shape[] = ['round', 'oval', 'long', 'square'];
export const SIZES: Size[] = ['rai', 'dal', 'matar', 'badam', 'bigger'];
export const MARKINGS: Marking[] = ['plain', 'line', 'letters', 'unknown'];
export const SLOTS: Slot[] = ['morning', 'afternoon', 'evening', 'night'];
export const FOODS: Food[] = ['before', 'after', 'with', 'any'];
export const DEFAULT_SLOT_TIME: Record<Slot, string> = { morning: '08:00', afternoon: '13:00', evening: '18:00', night: '21:00' };

export interface SlotDraft {
  slot: Slot;
  time: string; // "HH:mm" in the PARENT's time zone (safety rule 7)
}

export interface MedicineDraft {
  kind?: MedicineKind;
  // name
  stripName: string;
  strengthText: string;
  spokenName: string;
  // looks: tablet / capsule
  colourPrimary?: string;
  colourSecondary?: string;
  shape?: Shape;
  size?: Size;
  marking?: Marking;
  // looks: syrup
  bottleColour?: string;
  capColour?: string;
  labelColour?: string;
  bottleSize?: BottleSize;
  // looks: something else
  description: string;
  // kept
  keptIn?: KeptIn;
  stripColour?: string;
  photoUri?: string;
  // amount and when
  amountText: string;
  syrupQty: string;
  syrupUnit: 'chammach' | 'ml';
  measuredWith?: MeasuredWith;
  shakeFirst: boolean;
  slots: SlotDraft[];
  food?: Food;
  days: 'every' | 'some';
  daysOfWeek: number[];
  durationDays: number | null;
  startDate: string;
  extraInstruction: string;
  // set by the look-alike screen
  numberLabel?: number | null;
  sayPrintedName?: boolean;
  printColour?: string;
}

export function emptyDraft(startDate: string): MedicineDraft {
  return {
    stripName: '',
    strengthText: '',
    spokenName: '',
    description: '',
    amountText: '',
    syrupQty: '',
    syrupUnit: 'chammach',
    shakeFirst: false,
    slots: [],
    days: 'every',
    daysOfWeek: [],
    durationDays: null,
    startDate,
    extraInstruction: '',
  };
}

/** The steps shown for a kind. Syrup skips "how it's kept" (always a bottle). */
export function stepsFor(kind: MedicineKind | undefined): StepId[] {
  if (kind === 'syrup') return ['kind', 'name', 'looks', 'amount', 'check'];
  return ['kind', 'name', 'looks', 'kept', 'amount', 'check'];
}

export function nextStep(step: StepId, kind: MedicineKind | undefined): StepId | null {
  const steps = stepsFor(kind);
  const i = steps.indexOf(step);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
}

export function prevStep(step: StepId, kind: MedicineKind | undefined): StepId | null {
  const steps = stepsFor(kind);
  const i = steps.indexOf(step);
  return i > 0 ? steps[i - 1] : null;
}

export function progress(step: StepId, kind: MedicineKind | undefined) {
  const steps = stepsFor(kind);
  const index = Math.max(steps.indexOf(step), 0) + 1;
  return { index, total: steps.length, fraction: index / steps.length };
}

/** Choosing a kind clears appearance and keeping answers that belong to another kind. */
export function setKind(d: MedicineDraft, kind: MedicineKind): MedicineDraft {
  if (d.kind === kind) return d;
  return {
    ...d,
    kind,
    colourPrimary: undefined,
    colourSecondary: undefined,
    shape: undefined,
    size: undefined,
    marking: undefined,
    bottleColour: undefined,
    capColour: undefined,
    labelColour: undefined,
    bottleSize: undefined,
    description: '',
    keptIn: kind === 'syrup' ? 'bottle' : undefined,
    stripColour: undefined,
    amountText: '',
    syrupQty: '',
    measuredWith: undefined,
    shakeFirst: false,
  };
}

export type StepError = 'required' | 'pickOne';
export type StepErrors = Partial<Record<string, StepError>>;

export function validateStep(step: StepId, d: MedicineDraft): StepErrors {
  const e: StepErrors = {};
  const need = (field: string, ok: unknown, kind: StepError = 'pickOne') => {
    if (!ok) e[field] = kind;
  };
  switch (step) {
    case 'kind':
      need('kind', d.kind);
      break;
    case 'name':
      need('stripName', d.stripName.trim().length >= 2, 'required');
      need('spokenName', d.spokenName.trim(), 'required');
      break;
    case 'looks':
      if (d.kind === 'tablet') {
        need('colourPrimary', d.colourPrimary);
        need('shape', d.shape);
        need('size', d.size);
      } else if (d.kind === 'capsule') {
        need('colourPrimary', d.colourPrimary);
        need('colourSecondary', d.colourSecondary);
        need('size', d.size);
      } else if (d.kind === 'syrup') {
        need('bottleColour', d.bottleColour);
      } else {
        need('description', d.description.trim(), 'required');
      }
      break;
    case 'kept':
      need('keptIn', d.keptIn);
      if (d.keptIn === 'strip') need('stripColour', d.stripColour);
      break;
    case 'amount':
      if (d.kind === 'syrup') need('syrupQty', d.syrupQty.trim(), 'required');
      else need('amountText', d.amountText.trim(), 'required');
      need('slots', d.slots.length > 0);
      need('food', d.food);
      if (d.days === 'some') need('daysOfWeek', d.daysOfWeek.length > 0);
      break;
    case 'check':
      for (const s of stepsFor(d.kind).filter((x) => x !== 'check')) Object.assign(e, validateStep(s, d));
      break;
  }
  return e;
}

export const isStepValid = (step: StepId, d: MedicineDraft) => Object.keys(validateStep(step, d)).length === 0;

/** Amount chips: pre-typed text only, in the call language's everyday word. Never a suggestion. */
export function amountChips(kind: MedicineKind | undefined, language: CallLanguage | undefined): string[] {
  const hi = language === 'hi' || language === undefined;
  if (kind === 'tablet') return hi ? ['½ goli', '1 goli', '2 goli'] : ['½ tablet', '1 tablet', '2 tablets'];
  if (kind === 'capsule') return ['1 capsule', '2 capsule'];
  return [];
}

// Stopgap until the contract has fields for these (requested in the PR): spoken via extraInstruction.
const MEASURED_PHRASE: Record<MeasuredWith, string> = {
  spoon: 'ghar ke chammach se',
  cap: 'bottle ke dhakkan se',
  cup: 'naap wale cup se',
  syringe: 'syringe se',
};

/** The amount text exactly as entered. For syrup: the number and unit the family chose, unconverted. */
export function amountTextOf(d: MedicineDraft): string {
  if (d.kind === 'syrup') return `${d.syrupQty.trim()} ${d.syrupUnit}`;
  return d.amountText.trim();
}

export function toMedicineCreate(d: MedicineDraft): MedicineCreate {
  if (!d.kind) throw new Error('kind is required');
  const kind = d.kind;
  const appearance: NonNullable<MedicineCreate['appearance']> = {};
  if (kind === 'tablet') {
    Object.assign(appearance, { colourPrimary: d.colourPrimary, shape: d.shape, size: d.size, marking: d.marking ?? 'unknown' });
  } else if (kind === 'capsule') {
    Object.assign(appearance, { colourPrimary: d.colourPrimary, colourSecondary: d.colourSecondary, size: d.size, marking: d.marking ?? 'unknown' });
  } else if (kind === 'syrup') {
    Object.assign(appearance, { packColour: d.bottleColour, capColour: d.capColour, colourPrimary: d.labelColour });
  }
  if (kind === 'syrup') appearance.keptIn = 'bottle';
  else if (d.keptIn) appearance.keptIn = d.keptIn;
  if (d.keptIn === 'strip' && kind !== 'syrup') appearance.packColour = d.stripColour;
  if (d.printColour) appearance.printColour = d.printColour;

  const extras: string[] = [];
  if (kind === 'other' && d.description.trim()) extras.push(d.description.trim());
  if (kind === 'syrup' && d.measuredWith) extras.push(`${MEASURED_PHRASE[d.measuredWith]} naapiye.`);
  if (kind === 'syrup' && d.shakeFirst) extras.push('Pehle bottle hilaiye.');
  if (d.extraInstruction.trim()) extras.push(d.extraInstruction.trim());

  const endDate = d.durationDays && d.durationDays > 0 ? addDays(d.startDate, d.durationDays - 1) : null;
  const amountText = amountTextOf(d);
  const schedules: ScheduleInput[] = [...d.slots]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((s) => ({
      localTime: s.time,
      amountText,
      food: d.food ?? 'any',
      ...(d.days === 'some' ? { daysOfWeek: [...d.daysOfWeek].sort() } : {}),
      startDate: d.startDate,
      endDate,
    }));

  return {
    kind,
    stripName: d.stripName.trim(),
    ...(d.strengthText.trim() ? { strengthText: d.strengthText.trim() } : {}),
    spokenName: d.spokenName.trim(),
    appearance: stripUndefined(appearance),
    numberLabel: d.numberLabel ?? null,
    sayPrintedName: d.sayPrintedName ?? false,
    ...(extras.length ? { extraInstruction: extras.join(' ') } : {}),
    schedules,
  };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

export function toggleSlot(d: MedicineDraft, slot: Slot): MedicineDraft {
  const has = d.slots.some((s) => s.slot === slot);
  return {
    ...d,
    slots: has ? d.slots.filter((s) => s.slot !== slot) : [...d.slots, { slot, time: DEFAULT_SLOT_TIME[slot] }],
  };
}
