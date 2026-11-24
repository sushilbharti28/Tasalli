import type { Dose, DoseStatus, Medicine } from '@/api/types';
import { dateInZone, hhmmInZone } from '@/lib/time';

/** Doses whose outcome is known (excludes upcoming, in-progress and paused). */
const settled = (d: Dose) => d.status === 'confirmed' || d.status === 'missed';

export function weekSummary(doses: Dose[]) {
  const s = doses.filter(settled);
  return { done: s.filter((d) => d.status === 'confirmed').length, total: s.length };
}

export type DayState = 'all' | 'some_missed' | 'none' | 'pending';

/** Per calendar day in the parent's time zone. */
export function dayStates(doses: Dose[], timeZone: string): Record<string, DayState> {
  const byDay: Record<string, Dose[]> = {};
  for (const d of doses) {
    if (!d.dueAt) continue;
    const day = dateInZone(new Date(d.dueAt), timeZone);
    (byDay[day] ??= []).push(d);
  }
  const out: Record<string, DayState> = {};
  for (const [day, list] of Object.entries(byDay)) {
    if (list.some((d) => d.status === 'missed')) out[day] = 'some_missed';
    else if (list.every((d) => d.status === 'confirmed')) out[day] = 'all';
    else out[day] = 'pending';
  }
  return out;
}

export function perMedicineRates(doses: Dose[]) {
  const map = new Map<string, { medicineId: string; spokenName: string; done: number; total: number }>();
  for (const d of doses.filter(settled)) {
    const key = d.medicineId ?? '';
    const cur = map.get(key) ?? { medicineId: key, spokenName: d.spokenName ?? '', done: 0, total: 0 };
    cur.total += 1;
    if (d.status === 'confirmed') cur.done += 1;
    map.set(key, cur);
  }
  return [...map.values()].map((r) => ({ ...r, pct: r.total ? Math.round((r.done / r.total) * 100) : 0 }));
}

/** Icon + colour pair for each status. The icon and word carry the meaning; colour is extra. */
export const STATUS_ICON: Record<DoseStatus, string> = {
  upcoming: '○',
  calling: '☎',
  confirmed: '✓',
  missed: '✕',
  skipped_paused: '‖',
  cancelled: '–',
};

/** Manual "mark as taken" is offered for doses that are not yet confirmed and not in the future. */
export function canMarkTaken(d: Dose, nowMs = Date.now()): boolean {
  if (d.status === 'confirmed' || d.status === 'skipped_paused' || d.status === 'cancelled') return false; // a stopped medicine cannot be marked taken
  if (d.status === 'upcoming') return !!d.dueAt && new Date(d.dueAt).getTime() <= nowMs;
  return true;
}

/** The amount and food text the family entered for this dose's schedule (shown verbatim). */
export function doseDetail(dose: Dose, medicines: Medicine[], timeZone: string): string | undefined {
  const m = medicines.find((x) => x.id === dose.medicineId);
  if (!m || !dose.dueAt) return undefined;
  const hhmm = hhmmInZone(new Date(dose.dueAt), timeZone);
  const s = m.schedules.find((x) => x.localTime === hhmm) ?? m.schedules[0];
  return [s?.amountText, m.stripName].filter(Boolean).join(' · ');
}

