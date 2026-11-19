import { describe, expect, it } from 'vitest';
import { RULES } from '@tasalli/contracts';
import type { EngineFactory } from '../harness/engine';
import { MON_0900_IST, plusMinutes, useWorld } from './context';

/** Gate "Never twice" (safety rule 6) and the webhook part of gate "Privacy". */
export function idempotencyScenarios(factory: EngineFactory): void {
  describe('duplicate and unsigned webhooks (safety rule 6)', () => {
    const w = useWorld(factory, plusMinutes(MON_0900_IST, -5));

    async function dueCall() {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().runUntil(MON_0900_IST);
      const call = w().lastCallTo(p.phone);
      await w().answer(call);
      return { p, call };
    }

    it('the same key-1 webhook delivered twice confirms once and gets the same reply', async () => {
      const { p, call } = await dueCall();
      const ev = w().telephony.keyEvent(call, '1');
      const first = await w().deliver(ev);
      const firstDoses = await w().doses(p);
      w().clock.advanceMinutes(1);
      const second = await w().deliver(ev);
      expect(second.status).toBeLessThan(300);
      expect(second.next).toEqual(first.next);
      const doses = await w().doses(p);
      expect(doses.filter((d) => d.status === 'confirmed')).toHaveLength(1);
      expect(doses[0]!.confirmedAt).toBe(firstDoses[0]!.confirmedAt);
    });

    it('concurrent duplicate deliveries have one effect', async () => {
      const { p, call } = await dueCall();
      const ev = w().telephony.keyEvent(call, '2'); // snooze: a second effect would schedule two calls
      await Promise.all([w().deliver(ev), w().deliver(ev), w().deliver(ev)]);
      await w().deliver(w().telephony.statusEvent(call, 'completed'));
      await w().runMinutes(RULES.snoozeMinutes + 1);
      expect(w().callsTo(p.phone)).toHaveLength(2);
    });

    it('a repeated no_answer webhook schedules only one retry', async () => {
      const { p, call } = await dueCall();
      const ev = w().telephony.statusEvent(call, 'no_answer');
      await w().deliver(ev);
      await w().deliver(ev);
      await w().runMinutes(RULES.retryGapMinutes + 1);
      expect(w().callsTo(p.phone)).toHaveLength(2);
    });

    it('a repeated final no_answer webhook sends exactly one missed-dose alert', async () => {
      const p = await w().person();
      await w().schedule(p, '09:00');
      await w().runUntil(MON_0900_IST);
      let last;
      for (let i = 0; i < 1 + RULES.retryCount; i++) {
        last = w().lastCallTo(p.phone);
        await w().status(last, 'no_answer');
        if (i < RULES.retryCount) await w().runMinutes(RULES.retryGapMinutes);
      }
      const final = w().telephony.statusEvent(last!, 'no_answer');
      await w().deliver(final);
      await w().deliver(final);
      await w().runMinutes(60);
      expect(await w().engine.listAlerts(p.personId)).toHaveLength(1);
    });

    it('rejects an unsigned webhook with no effect', async () => {
      const { p, call } = await dueCall();
      const res = await w().engine.handleWebhook(...args(w().telephony.unsigned(w().telephony.keyEvent(call, '1'))));
      expect([401, 403]).toContain(res.status);
      expect((await w().doses(p)).some((d) => d.status === 'confirmed')).toBe(false);
    });

    it('rejects a webhook whose body was changed after signing', async () => {
      const { p, call } = await dueCall();
      const ev = w().telephony.keyEvent(call, '2');
      const res = await w().engine.handleWebhook(...args(w().telephony.tampered(ev, { value: '1' } as never)));
      expect([401, 403]).toContain(res.status);
      expect((await w().doses(p)).some((d) => d.status === 'confirmed')).toBe(false);
    });

    it('a stop (key 9) webhook replayed later does not resurrect or double-block', async () => {
      const { p, call } = await dueCall();
      const ev = w().telephony.keyEvent(call, '9');
      await w().deliver(ev);
      await w().deliver(ev);
      expect(await w().engine.isBlocked(p.phone)).toBe(true);
      await w().runMinutes(60 * 24);
      expect(w().callsTo(p.phone)).toHaveLength(1);
    });
  });
}

function args(x: { headers: Record<string, string>; body: unknown }): [Record<string, string>, unknown] {
  return [x.headers, x.body];
}
