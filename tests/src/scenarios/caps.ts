import { describe, expect, it } from 'vitest';
import { RULES } from '@tasalli/contracts';
import type { EngineFactory } from '../harness/engine';
import { localDateOf } from '../harness/time';
import { testPhone } from '../harness/world';
import { useWorld } from './context';

const TIMES_A = ['06:00', '08:00', '10:00', '12:00'];
const TIMES_B = ['14:00', '16:00', '18:00', '20:00'];

/** Gate "Caps and opt-out" and safety rule 5. */
export function capScenarios(factory: EngineFactory): void {
  describe('caps (safety rule 5)', () => {
    const w = useWorld(factory, '2027-01-17T18:00:00.000Z'); // 23:30 IST Sunday

    it(`at most ${RULES.maxCallsPerNumberPerDay} calls a day to one number across two accounts`, async () => {
      const phone = testPhone();
      const a = await w().person({ phone });
      const b = await w().person({ phone });
      for (const t of TIMES_A) await w().schedule(a, t);
      for (const t of TIMES_B) await w().schedule(b, t);
      await w().runUntil('2027-01-18T18:00:00.000Z'); // through Monday 23:30 IST
      const monday = w().callsTo(phone).filter((c) => localDateOf(new Date(c.placedAt), 'Asia/Kolkata') === '2027-01-18');
      expect(monday.length).toBeLessThanOrEqual(RULES.maxCallsPerNumberPerDay);
      expect(monday.length).toBeGreaterThan(0);
    });

    it('retries count toward the daily cap', async () => {
      const phone = testPhone();
      const a = await w().person({ phone });
      for (const t of TIMES_A) await w().schedule(a, t);
      // Never answer: 4 doses x 3 attempts would be 12 calls.
      const end = Date.parse('2027-01-18T18:00:00.000Z');
      while (w().clock.now().getTime() < end) {
        await w().runMinutes(1);
        for (const c of w().callsTo(phone)) {
          if (!answered.has(c.providerCallId)) {
            answered.add(c.providerCallId);
            await w().status(c, 'no_answer');
          }
        }
      }
      expect(w().callsTo(phone).length).toBeLessThanOrEqual(RULES.maxCallsPerNumberPerDay);
    });
    const answered = new Set<string>();

    it('the cap resets on the parent\'s next local day', async () => {
      const phone = testPhone();
      const a = await w().person({ phone });
      for (const t of [...TIMES_A, ...TIMES_B]) await w().schedule(a, t);
      await w().runUntil('2027-01-19T18:00:00.000Z'); // through Tuesday
      const tuesday = w().callsTo(phone).filter((c) => localDateOf(new Date(c.placedAt), 'Asia/Kolkata') === '2027-01-19');
      expect(tuesday.length).toBeGreaterThan(0);
      expect(tuesday.length).toBeLessThanOrEqual(RULES.maxCallsPerNumberPerDay);
    });

    it(`an account can have at most ${RULES.maxPeoplePerAccount} people`, async () => {
      const acct = await w().account();
      for (let i = 0; i < RULES.maxPeoplePerAccount; i++) await w().person({ accountId: acct });
      const res = await w().engine.addPerson({
        accountId: acct, personId: w().id('person'), phone: testPhone(), language: 'hi', timeZone: 'Asia/Kolkata', consent: 'consented',
      });
      expect(res).toEqual({ ok: false, reason: 'limit_reached' });
    });
  });
}
