import { describe, expect, it } from 'vitest';
import { RULES } from '@tasalli/contracts';
import type { EngineFactory } from '../harness/engine';
import type { CallStatus } from '../harness/fake-telephony';
import { MON_0900_IST, plusMinutes, useWorld } from './context';

/** Gate "Retries and alerts": 2 retries, then missed, then exactly one alert. */
export function retryScenarios(factory: EngineFactory): void {
  describe('retries and alerts', () => {
    const w = useWorld(factory, plusMinutes(MON_0900_IST, -5));

    for (const outcome of ['no_answer', 'busy', 'failed'] as CallStatus[]) {
      it(`${outcome}: retries ${RULES.retryCount} times ${RULES.retryGapMinutes} min apart, then missed with one alert`, async () => {
        const p = await w().person();
        await w().schedule(p, '09:00');
        await w().runUntil(MON_0900_IST);
        for (let i = 0; i <= RULES.retryCount; i++) {
          const calls = w().callsTo(p.phone);
          expect(calls).toHaveLength(i + 1);
          const expectedAt = plusMinutes(MON_0900_IST, i * RULES.retryGapMinutes);
          expect(Date.parse(calls[i]!.placedAt)).toBeGreaterThanOrEqual(Date.parse(expectedAt));
          expect(Date.parse(calls[i]!.placedAt)).toBeLessThanOrEqual(Date.parse(expectedAt) + 60_000 * (i + 1));
          await w().status(calls[i]!, outcome);
          if (i < RULES.retryCount) {
            await w().runMinutes(RULES.retryGapMinutes - 1);
            expect(w().callsTo(p.phone)).toHaveLength(i + 1); // not early
            await w().runMinutes(1);
          }
        }
        await w().runMinutes(120);
        expect(w().callsTo(p.phone)).toHaveLength(1 + RULES.retryCount);
        const doses = (await w().doses(p)).filter((d) => d.dueAt === MON_0900_IST);
        expect(doses.map((d) => d.status)).toEqual(['missed']);
        const alerts = await w().engine.listAlerts(p.personId);
        expect(alerts.filter((a) => a.kind === 'missed_dose')).toHaveLength(1);
      });
    }

    it('answered but hung up without a reply counts as not confirmed and is retried', async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().runUntil(MON_0900_IST);
      const call = w().lastCallTo(p.phone);
      await w().answer(call);
      await w().status(call, 'completed');
      expect((await w().doses(p))[0]!.status).not.toBe('confirmed');
      await w().runMinutes(RULES.retryGapMinutes);
      expect(w().callsTo(p.phone)).toHaveLength(2);
    });

    it('confirming on the second attempt stops further retries and sends no alert', async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().runUntil(MON_0900_IST);
      await w().status(w().lastCallTo(p.phone), 'no_answer');
      await w().runMinutes(RULES.retryGapMinutes);
      await w().answerAndPress(w().lastCallTo(p.phone), '1');
      await w().runMinutes(120);
      expect(w().callsTo(p.phone)).toHaveLength(2);
      expect((await w().doses(p))[0]!.status).toBe('confirmed');
      expect(await w().engine.listAlerts(p.personId)).toHaveLength(0);
    });

    it('a provider error on placeCall does not lose the call and does not double it', async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      w().telephony.failNextPlaceCalls(1);
      await w().runUntil(plusMinutes(MON_0900_IST, RULES.retryGapMinutes - 1));
      expect(w().callsTo(p.phone)).toHaveLength(1);
    });
  });
}
