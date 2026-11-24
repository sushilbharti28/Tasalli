import { STATUS_ICON, canMarkTaken } from '@/features/doses/summary';
import type { components } from '@/api/schema';

type Dose = components['schemas']['Dose'];
const past = new Date(Date.now() - 60_000).toISOString();
const dose = (status: Dose['status']): Dose => ({ id: 'd', status, dueAt: past } as Dose);

describe('dose status (contracts: upcoming, calling, confirmed, missed, skipped_paused, cancelled)', () => {
  it('every status has an icon', () => {
    for (const s of ['upcoming', 'calling', 'confirmed', 'missed', 'skipped_paused', 'cancelled'] as const) expect(STATUS_ICON[s]).toBeTruthy();
  });
  it('"mark as taken" is not offered for confirmed, paused or stopped (cancelled) doses', () => {
    expect(canMarkTaken(dose('confirmed'))).toBe(false);
    expect(canMarkTaken(dose('skipped_paused'))).toBe(false);
    expect(canMarkTaken(dose('cancelled'))).toBe(false);
    expect(canMarkTaken(dose('missed'))).toBe(true);
    expect(canMarkTaken(dose('calling'))).toBe(true);
  });
});
