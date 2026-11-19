import { describe, expect, it } from 'vitest';
import { RULES } from '@tasalli/contracts';
import type { EngineFactory } from '../harness/engine';
import { MON_0900_IST, plusMinutes, useWorld } from './context';

/** Scope item 6: doses within 30 minutes grouped into one call. */
export function groupingScenarios(factory: EngineFactory): void {
  describe(`grouping within ${RULES.groupWindowMinutes} minutes`, () => {
    const w = useWorld(factory, plusMinutes(MON_0900_IST, -5));

    it('two doses 20 minutes apart are one call, and one key 1 confirms both', async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().schedule(p, '09:20', { spokenName: 'sugar wali' });
      await w().runUntil(plusMinutes(MON_0900_IST, 25));
      expect(w().callsTo(p.phone)).toHaveLength(1);
      await w().answerAndPress(w().lastCallTo(p.phone), '1');
      await w().runUntil(plusMinutes(MON_0900_IST, 90));
      expect(w().callsTo(p.phone)).toHaveLength(1);
      const doses = (await w().doses(p)).filter((d) => d.dueAt < plusMinutes(MON_0900_IST, 60));
      expect(doses.map((d) => d.status)).toEqual(['confirmed', 'confirmed']);
    });

    it('the grouped call rings at the earliest dose time, never early', async () => {
      const p = await w().person();
      await w().schedule(p, '09:20');
      await w().schedule(p, '09:00');
      await w().runUntil(plusMinutes(MON_0900_IST, 25));
      const calls = w().callsTo(p.phone);
      expect(calls).toHaveLength(1);
      expect(Date.parse(calls[0]!.placedAt)).toBeGreaterThanOrEqual(Date.parse(MON_0900_IST));
      expect(Date.parse(calls[0]!.placedAt)).toBeLessThan(Date.parse(MON_0900_IST) + 2 * 60_000);
    });

    it('two doses 45 minutes apart are two calls', async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().schedule(p, '09:45');
      await w().runUntil(MON_0900_IST);
      await w().answerAndPress(w().lastCallTo(p.phone), '1');
      await w().runUntil(plusMinutes(MON_0900_IST, 46));
      expect(w().callsTo(p.phone)).toHaveLength(2);
    });

    it('doses of two different people at the same time are never merged', async () => {
      const acct = await w().account();
      const mum = await w().person({ accountId: acct });
      const dad = await w().person({ accountId: acct });
      await w().schedule(mum, '09:00');
      await w().schedule(dad, '09:00');
      await w().runUntil(plusMinutes(MON_0900_IST, 1));
      expect(w().callsTo(mum.phone)).toHaveLength(1);
      expect(w().callsTo(dad.phone)).toHaveLength(1);
      await w().answerAndPress(w().lastCallTo(mum.phone), '1');
      expect((await w().doses(dad)).some((d) => d.status === 'confirmed')).toBe(false);
    });
  });
}
