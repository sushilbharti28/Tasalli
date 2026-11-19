import { describe, expect, it } from 'vitest';
import { RULES } from '@tasalli/contracts';
import type { EngineFactory } from '../harness/engine';
import { MON_0900_IST, plusMinutes, useWorld } from './context';

/** Scope item 6: "2 snooze once (15 min)". */
export function snoozeScenarios(factory: EngineFactory): void {
  describe('snooze once', () => {
    const w = useWorld(factory, plusMinutes(MON_0900_IST, -5));

    it(`key 2 calls back after ${RULES.snoozeMinutes} minutes, not before`, async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().runUntil(MON_0900_IST);
      await w().answerAndPress(w().lastCallTo(p.phone), '2');
      await w().runMinutes(RULES.snoozeMinutes - 1);
      expect(w().callsTo(p.phone)).toHaveLength(1);
      await w().runMinutes(2);
      expect(w().callsTo(p.phone)).toHaveLength(2);
      expect((await w().doses(p))[0]!.status).not.toBe('confirmed');
    });

    it('a second snooze for the same dose is not honoured', async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().runUntil(MON_0900_IST);
      await w().answerAndPress(w().lastCallTo(p.phone), '2');
      await w().runMinutes(RULES.snoozeMinutes + 1);
      const second = w().lastCallTo(p.phone);
      await w().answer(second);
      const next = await w().press(second, '2');
      expect(next?.action === 'play' ? next.step.listen?.keys ?? [] : []).not.toContain('2');
      await w().status(second, 'completed');
      const before = w().callsTo(p.phone).length;
      const t0 = Date.parse(w().clock.nowIso());
      await w().runMinutes(RULES.snoozeMinutes + 1);
      const snoozeLike = w().callsTo(p.phone).slice(before)
        .filter((c) => Math.abs(Date.parse(c.placedAt) - (t0 + RULES.snoozeMinutes * 60_000)) <= 60_000);
      expect(snoozeLike).toHaveLength(0);
      expect((await w().doses(p))[0]!.status).not.toBe('confirmed');
    });

    it('confirming on the snoozed call confirms the dose', async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().runUntil(MON_0900_IST);
      await w().answerAndPress(w().lastCallTo(p.phone), '2');
      await w().runMinutes(RULES.snoozeMinutes + 1);
      await w().answerAndPress(w().lastCallTo(p.phone), '1');
      expect((await w().doses(p))[0]!.status).toBe('confirmed');
    });
  });
}
