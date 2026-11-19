import { describe, expect, it } from 'vitest';
import { RULES } from '@tasalli/contracts';
import type { EngineFactory } from '../harness/engine';
import { MON_0900_IST, plusMinutes, useWorld } from './context';

/** Gate "Right call, right time" (no call before consent) and safety rule 3. */
export function consentScenarios(factory: EngineFactory): void {
  describe('consent gating (safety rule 3)', () => {
    const w = useWorld(factory);

    it('places no reminder call while consent is pending', async () => {
      const p = await w().person({ consent: 'pending' });
      await w().schedule(p, '09:00');
      await w().runUntil(plusMinutes(MON_0900_IST, 60));
      expect(w().callsTo(p.phone, 'reminder')).toHaveLength(0);
    });

    it('places a consent call for a pending parent, and none for a self-registered user', async () => {
      const parent = await w().person({ consent: 'pending' });
      const self = await w().person({ consent: 'pending', isSelf: true });
      await w().runMinutes(1);
      expect(w().callsTo(parent.phone, 'consent')).toHaveLength(1);
      expect(w().callsTo(self.phone, 'consent')).toHaveLength(0);
    });

    it('key 1 on the consent call consents, and reminders start after that', async () => {
      const p = await w().person({ consent: 'pending' });
      await w().schedule(p, '09:00');
      await w().runMinutes(1);
      await w().answerAndPress(w().lastCallTo(p.phone), '1');
      expect((await w().engine.getPerson(p.personId)).consent).toBe('consented');
      await w().runUntil(plusMinutes(MON_0900_IST, 1));
      expect(w().callsTo(p.phone, 'reminder')).toHaveLength(1);
    });

    it('"haan" on the consent call consents', async () => {
      const p = await w().person({ consent: 'pending' });
      await w().runMinutes(1);
      const call = w().lastCallTo(p.phone);
      await w().answer(call);
      await w().say(call, 'haan');
      expect((await w().engine.getPerson(p.personId)).consent).toBe('consented');
    });

    it('"nahi" on the consent call never consents', async () => {
      const p = await w().person({ consent: 'pending' });
      await w().schedule(p, '09:00');
      await w().runMinutes(1);
      const call = w().lastCallTo(p.phone);
      await w().answer(call);
      await w().say(call, 'nahi');
      await w().status(call, 'completed');
      expect((await w().engine.getPerson(p.personId)).consent).not.toBe('consented');
      await w().runUntil(plusMinutes(MON_0900_IST, 60));
      expect(w().callsTo(p.phone, 'reminder')).toHaveLength(0);
    });

    it('key 9 on the consent call blocks the number for every account', async () => {
      const p = await w().person({ consent: 'pending' });
      await w().runMinutes(1);
      await w().answerAndPress(w().lastCallTo(p.phone), '9');
      expect(await w().engine.isBlocked(p.phone)).toBe(true);
      const other = await w().account();
      const res = await w().engine.addPerson({ ...p, accountId: other, personId: w().id('person'), consent: 'consented' });
      expect(res).toEqual({ ok: false, reason: 'blocked' });
    });

    it(`an unanswered consent call is retried ${RULES.retryCount} times, ${RULES.retryGapMinutes} minutes apart, then stops`, async () => {
      const p = await w().person({ consent: 'pending' });
      for (let i = 0; i < 1 + RULES.retryCount; i++) {
        await w().runMinutes(i === 0 ? 1 : RULES.retryGapMinutes);
        const calls = w().callsTo(p.phone, 'consent');
        expect(calls).toHaveLength(i + 1);
        await w().status(calls[i]!, 'no_answer');
      }
      await w().runMinutes(120);
      expect(w().callsTo(p.phone, 'consent')).toHaveLength(1 + RULES.retryCount);
      expect((await w().engine.getPerson(p.personId)).consent).toBe('pending');
    });

    it('a paused person gets no reminder calls', async () => {
      const p = await w().person({ paused: true });
      await w().schedule(p, '09:00');
      await w().runUntil(plusMinutes(MON_0900_IST, 60));
      expect(w().callsTo(p.phone)).toHaveLength(0);
    });
  });
}
