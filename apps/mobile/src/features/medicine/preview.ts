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

export interface PreviewInput {
  medicine: MedicineCreate;
  /** The person's full name; calls greet them by its first word ("Namaste Ramesh ji"), never by the nickname. */
  fullName: string;
  language: CallLanguage;
  scheduleIndex?: number;
}

/**
 * v1.8: mirrors the one-medicine-at-a-time call (services/call-engine, Hindi v1.6 wording): greeting, who is calling,
 * the medicine with its name and look, then the question. Only Hindi calls exist today; other languages show the same.
 */
export function buildPreviewText({ medicine: m, fullName, scheduleIndex = 0 }: PreviewInput): string {
  const s = m.schedules[scheduleIndex] ?? m.schedules[0];
  const a = m.appearance ?? {};
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  const colour = (c?: string) => (c ? (HI_COLOUR[c] ?? c) : '');
  const look =
    m.kind === 'tablet' || m.kind === 'capsule'
      ? ` Yeh ek ${[a.size && HI_SIZE[a.size], colour(a.colourPrimary), m.kind === 'tablet' && a.shape ? HI_SHAPE[a.shape] : ''].filter(Boolean).join(' ')} ${HI_KIND[m.kind]} hai.`
      : '';
  const pack =
    a.keptIn === 'strip' && a.packColour ? ` Iska patta ${colour(a.packColour)} hai.`
      : a.keptIn === 'bottle' && a.packColour ? ` Iski bottle ${colour(a.packColour)} hai.`
        : a.keptIn === 'loose' ? ' Yeh dibbe mein khuli rakhi hai.' : '';
  const dis = m.numberLabel != null ? ` Iske patte par ${m.numberLabel} number likha hai.` : m.sayPrintedName ? ` Iske patte par ${spell(m.stripName)} likha hai.` : '';
  const food = s && HI_FOOD[s.food] ? ` ${HI_FOOD[s.food]}.` : '';
  const extra = m.extraInstruction ? ` ${m.extraInstruction}.` : '';
  const strength = m.strengthText ? ` ${m.strengthText}` : '';
  return `Namaste ${first} ji. Hum Tasalli app se bol rahe hain. Aapki dawai, ${s?.amountText ?? ''} ${m.stripName}${strength} ki hai. Ise aap ${m.spokenName} kehte hain.${look}${pack}${dis}${food}${extra} Dawai lene ke baad, "haan" boliye, ya 1 dabaiye.`;
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
