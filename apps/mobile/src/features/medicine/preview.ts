/**
 * Local text preview of what the reminder call will say, for the check screen (before the
 * medicine exists on the server). Follows docs/call-scripts.md. Safety rule 1: every variable
 * part (name, amount, extra instruction) is inserted VERBATIM as the family typed it; the
 * template never adds, converts or computes an amount.
 *
 * After saving, GET /medicines/{id}/preview (server, recorded voice) is authoritative.
 */
import type { CallLanguage, MedicineCreate } from '@/api/types';

const HI_COLOUR: Record<string, string> = {
  white: 'safed', yellow: 'peeli', orange: 'narangi', pink: 'gulabi', red: 'laal', brown: 'bhoori',
  green: 'hari', blue: 'neeli', purple: 'baingani', black: 'kaali', silver: 'chaandi rang ki', gold: 'sunehri', clear: 'saaf',
};
const HI_SIZE: Record<string, string> = { very_small: 'bahut chhoti si', small: 'chhoti si', large: 'badi si' };
const HI_SHAPE: Record<string, string> = { round: 'gol', oval: 'andaakaar', long: 'lambi', square: 'chaukor' };
const HI_KIND: Record<string, string> = { tablet: 'goli', capsule: 'capsule', syrup: 'syrup', other: 'dawai' };
const HI_FOOD: Record<string, string> = { before: 'khane se pehle', after: 'khane ke baad', with: 'khane ke saath', any: '' };
const EN_FOOD: Record<string, string> = { before: 'before food', after: 'after food', with: 'with food', any: '' };

export interface PreviewInput {
  medicine: MedicineCreate;
  personName: string;
  childName: string;
  language: CallLanguage;
  scheduleIndex?: number;
}

export function buildPreviewText({ medicine: m, personName, childName, language, scheduleIndex = 0 }: PreviewInput): string {
  const s = m.schedules[scheduleIndex] ?? m.schedules[0];
  const a = m.appearance ?? {};
  const amount = s?.amountText ?? '';
  const extra = m.extraInstruction ? ` ${m.extraInstruction}` : '';
  if (language === 'hi') {
    const looks = [a.size && HI_SIZE[a.size], a.colourPrimary && (HI_COLOUR[a.colourPrimary] ?? a.colourPrimary), a.shape && HI_SHAPE[a.shape], HI_KIND[m.kind]]
      .filter(Boolean)
      .join(' ');
    const pack =
      a.keptIn === 'strip' && a.packColour
        ? `, ${HI_COLOUR[a.packColour] ?? a.packColour} patte se`
        : m.kind === 'syrup' && a.packColour
          ? `, ${HI_COLOUR[a.packColour] ?? a.packColour} bottle wali${a.capColour ? `, ${HI_COLOUR[a.capColour] ?? a.capColour} dhakkan` : ''}`
          : '';
    const dis = m.numberLabel != null ? `, ${m.numberLabel} number wali` : m.sayPrintedName ? `, jis patte par ${spell(m.stripName)} likha hai` : '';
    const food = s ? HI_FOOD[s.food] : '';
    return `Namaste ${personName} ji, ${childName} ki taraf se dawai ka samay. ${m.spokenName}: ${amount}${looks ? `, ${looks}` : ''}${pack}${dis}.${food ? ` ${food}.` : ''}${extra} Dawai le lein, phir boliye "le li", ya 1 dabaiye.`;
  }
  const looks = [a.colourPrimary, a.shape, m.kind === 'other' ? '' : m.kind].filter(Boolean).join(' ');
  const pack = a.keptIn === 'strip' && a.packColour ? `, from the ${a.packColour} strip` : '';
  const dis = m.numberLabel != null ? `, the one marked number ${m.numberLabel}` : m.sayPrintedName ? `, the strip that says ${spell(m.stripName)}` : '';
  const food = s ? EN_FOOD[s.food] : '';
  return `Namaste ${personName} ji, medicine time, from ${childName}. ${m.spokenName}: ${amount}${looks ? `, ${looks}` : ''}${pack}${dis}.${food ? ` ${food}.` : ''}${extra} After taking it, say "le li" or press 1.`;
}

/** "Amlodac" -> "A-M-L-O-D-A-C" (letters of the printed name, as in docs/call-scripts.md). */
export function spell(name: string): string {
  return name
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .split('')
    .join('-');
}

export function speechLocale(language: CallLanguage): string {
  return { hi: 'hi-IN', en: 'en-IN', bn: 'bn-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN' }[language];
}
