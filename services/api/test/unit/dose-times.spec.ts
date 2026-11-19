import { computeDueTimes, localDateRangeToUtc, ScheduleForGeneration } from '../../src/doses/dose-times';

const daily = (localTime: string, over: Partial<ScheduleForGeneration> = {}): ScheduleForGeneration => ({
  id: 's1', localTime, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate: '2026-01-01', endDate: null, ...over,
});

describe('dose times in the parent time zone (safety rule 7)', () => {
  it('09:00 in Asia/Kolkata is 03:30 UTC', () => {
    const now = new Date('2026-11-19T00:00:00Z'); // 05:30 IST
    const out = computeDueTimes([daily('09:00')], 'Asia/Kolkata', now, 2);
    expect(out.map((d) => d.dueAt.toISOString())).toEqual(['2026-11-19T03:30:00.000Z', '2026-11-20T03:30:00.000Z']);
  });

  it('uses the parent date, not the UTC date: 21:00 IST on the 19th is 15:30Z on the 19th', () => {
    const now = new Date('2026-11-18T20:00:00Z'); // already 01:30 on the 19th in India
    const out = computeDueTimes([daily('21:00')], 'Asia/Kolkata', now, 1);
    expect(out).toEqual([{ scheduleId: 's1', localDate: '2026-11-19', dueAt: new Date('2026-11-19T15:30:00Z') }]);
  });

  it('never creates doses in the past', () => {
    const now = new Date('2026-11-19T05:00:00Z'); // 10:30 IST
    const out = computeDueTimes([daily('09:00'), daily('21:00', { id: 's2' })], 'Asia/Kolkata', now, 1);
    expect(out.map((d) => d.scheduleId)).toEqual(['s2']);
  });

  it('follows DST for a parent in New York (EDT -> EST on 1 Nov 2026)', () => {
    const now = new Date('2026-10-31T10:00:00Z');
    const out = computeDueTimes([daily('09:00')], 'America/New_York', now, 3);
    expect(out.map((d) => d.dueAt.toISOString())).toEqual([
      '2026-10-31T13:00:00.000Z', // EDT, UTC-4
      '2026-11-01T14:00:00.000Z', // EST, UTC-5
      '2026-11-02T14:00:00.000Z',
    ]);
  });

  it('respects days of week (ISO, 1 = Monday) and start/end dates', () => {
    const now = new Date('2026-11-15T18:30:00Z'); // Monday 16 Nov 00:00 IST
    const mondaysOnly = computeDueTimes([daily('09:00', { daysOfWeek: [1] })], 'Asia/Kolkata', now, 7);
    expect(mondaysOnly.map((d) => d.localDate)).toEqual(['2026-11-16']);
    const window = computeDueTimes([daily('09:00', { startDate: '2026-11-18', endDate: '2026-11-19' })], 'Asia/Kolkata', now, 7);
    expect(window.map((d) => d.localDate)).toEqual(['2026-11-18', '2026-11-19']);
  });

  it('local date ranges convert to UTC bounds in the parent zone', () => {
    expect(localDateRangeToUtc('2026-11-19', '2026-11-19', 'Asia/Kolkata')).toEqual({
      start: new Date('2026-11-18T18:30:00Z'),
      end: new Date('2026-11-19T18:30:00Z'),
    });
  });
});
