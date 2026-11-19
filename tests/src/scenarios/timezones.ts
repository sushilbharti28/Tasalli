import { describe, expect, it } from 'vitest';
import type { EngineFactory } from '../harness/engine';
import { localTimeOf } from '../harness/time';
import { useWorld } from './context';

/** Gate "Right call, right time" and safety rule 7: dose times are the parent's local time. */
export function timeZoneScenarios(factory: EngineFactory): void {
  describe('time zones (safety rule 7)', () => {
    const w = useWorld(factory, '2027-01-17T12:00:00.000Z');

    async function firstCallAt(tz: string, localTime: string, untilIso: string, accountTz?: string, days?: number[]) {
      const acct = await w().account(accountTz);
      const p = await w().person({ accountId: acct, timeZone: tz });
      await w().schedule(p, localTime, days ? { daysOfWeek: days } : {});
      await w().runUntil(untilIso);
      const call = w().callsTo(p.phone)[0];
      if (!call) throw new Error('no call placed');
      return { call, p };
    }

    it('09:00 for a parent in India rings at 03:30 UTC', async () => {
      const { call } = await firstCallAt('Asia/Kolkata', '09:00', '2027-01-18T04:00:00.000Z');
      expect(call.placedAt.slice(11, 16)).toBe('03:30');
    });

    it('a child abroad (account in Los Angeles) does not shift the parent\'s IST time', async () => {
      const { call } = await firstCallAt('Asia/Kolkata', '08:00', '2027-01-18T03:00:00.000Z', 'America/Los_Angeles');
      expect(localTimeOf(new Date(call.placedAt), 'Asia/Kolkata')).toBe('08:00');
    });

    it('half-hour-plus-quarter zones work (Kathmandu +05:45)', async () => {
      const { call } = await firstCallAt('Asia/Kathmandu', '09:00', '2027-01-18T04:00:00.000Z');
      expect(call.placedAt.slice(11, 16)).toBe('03:15');
    });

    it('days of week are the parent\'s local days (Monday 02:00 IST is Sunday in UTC)', async () => {
      const { call } = await firstCallAt('Asia/Kolkata', '02:00', '2027-01-19T00:00:00.000Z', undefined, [1]);
      expect(call.placedAt.slice(0, 16)).toBe('2027-01-17T20:30');
    });
  });

  describe('daylight saving for a parent abroad', () => {
    // UK clocks go forward on Sunday 28 March 2027.
    const w = useWorld(factory, '2027-03-26T12:00:00.000Z');

    it('09:00 Europe/London stays 09:00 local across the DST change', async () => {
      const p = await w().person({ timeZone: 'Europe/London', language: 'en' });
      await w().schedule(p, '09:00');
      const end = Date.parse('2027-03-30T12:00:00.000Z');
      while (w().clock.now().getTime() < end) {
        await w().runMinutes(30);
        for (const c of w().callsTo(p.phone)) if (!done.has(c.callId)) { done.add(c.callId); await w().answerAndPress(c, '1'); }
      }
      const calls = w().callsTo(p.phone);
      expect(calls.length).toBeGreaterThanOrEqual(4);
      for (const c of calls) expect(localTimeOf(new Date(c.placedAt), 'Europe/London')).toBe('09:00');
      expect(new Set(calls.map((c) => c.placedAt.slice(11, 16)))).toEqual(new Set(['09:00', '08:00']));
    });
    const done = new Set<string>();
  });
}
