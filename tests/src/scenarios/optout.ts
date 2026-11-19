import { describe, expect, it } from 'vitest';
import type { EngineFactory } from '../harness/engine';
import { testPhone } from '../harness/world';
import { MON_0900_IST, plusMinutes, useWorld } from './context';

/** Gate "Caps and opt-out": key 9 blocks across all accounts at once (safety rule 3). */
export function optOutScenarios(factory: EngineFactory): void {
  describe('key 9 and stop phrases block the number everywhere', () => {
    const w = useWorld(factory, plusMinutes(MON_0900_IST, -5));

    async function sharedNumber() {
      const phone = testPhone();
      const a = await w().person({ phone });
      const b = await w().person({ phone });
      await w().schedule(a, '09:00');
      await w().schedule(b, '13:00');
      await w().schedule(a, '21:00');
      return { phone, a, b };
    }

    it('key 9 on a reminder blocks the number and cancels every account\'s pending calls', async () => {
      const { phone, a, b } = await sharedNumber();
      await w().runUntil(MON_0900_IST);
      await w().answerAndPress(w().lastCallTo(phone), '9');
      expect(await w().engine.isBlocked(phone)).toBe(true);
      await w().runUntil(plusMinutes(MON_0900_IST, 60 * 36));
      expect(w().callsTo(phone)).toHaveLength(1);
      for (const p of [a, b]) {
        expect((await w().engine.getPerson(p.personId)).consent).toBe('opted_out');
        expect((await w().doses(p)).some((d) => d.status === 'confirmed')).toBe(false);
      }
    });

    for (const phrase of ['band karo', 'mat karo phone', 'बंद करो']) {
      it(`stop phrase "${phrase}" blocks the number`, async () => {
        const { phone } = await sharedNumber();
        await w().runUntil(MON_0900_IST);
        const call = w().lastCallTo(phone);
        await w().answer(call);
        await w().say(call, phrase);
        await w().status(call, 'completed');
        expect(await w().engine.isBlocked(phone)).toBe(true);
        await w().runUntil(plusMinutes(MON_0900_IST, 60 * 36));
        expect(w().callsTo(phone)).toHaveLength(1);
      });
    }

    it('a blocked number cannot be added by another account', async () => {
      const { phone, a } = await sharedNumber();
      await w().runUntil(MON_0900_IST);
      await w().answerAndPress(w().lastCallTo(phone), '9');
      const res = await w().engine.addPerson({ ...a, accountId: await w().account(), personId: w().id('person') });
      expect(res).toEqual({ ok: false, reason: 'blocked' });
    });

    it('blocking one number does not affect a different number', async () => {
      const { phone } = await sharedNumber();
      const other = await w().person();
      await w().schedule(other, '13:00');
      await w().runUntil(MON_0900_IST);
      await w().answerAndPress(w().lastCallTo(phone), '9');
      await w().runUntil(plusMinutes(MON_0900_IST, 4 * 60 + 1));
      expect(w().callsTo(other.phone)).toHaveLength(1);
    });
  });
}
