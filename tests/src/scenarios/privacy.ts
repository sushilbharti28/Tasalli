import { describe, expect, it } from 'vitest';
import type { EngineFactory } from '../harness/engine';
import { leakedPhones } from '../harness/mask';
import { MON_0900_IST, plusMinutes, useWorld } from './context';

/** Gate "Privacy" (safety rule 8): phone numbers are masked in logs. */
export function privacyScenarios(factory: EngineFactory): void {
  describe('phone numbers are masked in engine logs (safety rule 8)', () => {
    const w = useWorld(factory, plusMinutes(MON_0900_IST, -5));

    it('a full day of consent, reminder, retry, snooze and stop never logs a full number', async () => {
      if (!w().engine.logs) return; // engine cannot expose logs: covered by the security review instead
      const a = await w().person({ consent: 'pending' });
      const b = await w().person();
      await w().schedule(b, '09:00');
      await w().runMinutes(1);
      await w().answerAndPress(w().lastCallTo(a.phone), '1');
      await w().runUntil(MON_0900_IST);
      await w().answerAndPress(w().lastCallTo(b.phone), '2');
      await w().runMinutes(16);
      await w().status(w().lastCallTo(b.phone), 'no_answer');
      await w().runMinutes(11);
      await w().answerAndPress(w().lastCallTo(b.phone), '9');
      const text = w().engine.logs!().join('\n');
      expect(text.length).toBeGreaterThan(0);
      expect(leakedPhones(text, [a.phone, b.phone])).toEqual([]);
    });
  });
}
