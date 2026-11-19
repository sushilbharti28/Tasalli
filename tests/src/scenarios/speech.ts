import { describe, expect, it } from 'vitest';
import type { CallLanguage } from '@tasalli/contracts';
import type { EngineFactory } from '../harness/engine';
import { safetyNegatives } from '../speech/phrase-set';
import { MON_0900_IST, plusMinutes, useWorld } from './context';

/** Gate '"Nahi li" is never a yes' end to end through the engine (safety rule 4). */
export function speechScenarios(factory: EngineFactory): void {
  describe('spoken replies on a reminder call (safety rule 4)', () => {
    const w = useWorld(factory, plusMinutes(MON_0900_IST, -5));

    async function liveCall(language: CallLanguage = 'hi') {
      const p = await w().person({ language });
      await w().schedule(p, '09:00');
      await w().runUntil(MON_0900_IST);
      const call = w().lastCallTo(p.phone);
      await w().answer(call);
      return { p, call };
    }

    it('"le li" confirms by speech', async () => {
      const { p, call } = await liveCall();
      await w().say(call, 'le li');
      const d = (await w().doses(p))[0]!;
      expect(d.status).toBe('confirmed');
      expect(d.confirmedVia).toBe('speech');
    });

    it('"nahi li" never confirms', async () => {
      const { p, call } = await liveCall();
      await w().say(call, 'nahi li');
      await w().status(call, 'completed');
      expect((await w().doses(p))[0]!.status).not.toBe('confirmed');
    });

    it('silence never confirms, and the dose is retried', async () => {
      const { p, call } = await liveCall();
      await w().say(call, '');
      await w().say(call, undefined);
      await w().status(call, 'completed');
      expect((await w().doses(p))[0]!.status).not.toBe('confirmed');
      await w().runMinutes(11);
      expect(w().callsTo(p.phone).length).toBe(2);
    });

    it('unclear speech is asked once more, then falls back to the keypad', async () => {
      const { p, call } = await liveCall();
      const first = await w().say(call, 'kaun bol raha hai');
      expect(first?.action).toBe('play');
      if (first?.action === 'play') expect(first.step.listen?.keys).toContain('1');
      const second = await w().say(call, 'hmm');
      expect(second?.action).toBe('play');
      if (second?.action === 'play') {
        expect(second.step.listen?.keys).toContain('1');
        expect(second.step.listen?.speech).toBe(false);
      }
      expect((await w().doses(p))[0]!.status).not.toBe('confirmed');
    });

    it('a negative then key 1 confirms (keypad is authoritative)', async () => {
      const { p, call } = await liveCall();
      await w().say(call, 'abhi nahi');
      await w().press(call, '1');
      expect((await w().doses(p))[0]!.confirmedVia).toBe('key');
    });

    describe('no negative or unclear phrase in the speech test set confirms a dose', () => {
      for (const c of safetyNegatives()) {
        it(`${c.id} "${c.text}"`, async () => {
          const { p, call } = await liveCall(c.language);
          await w().say(call, c.text);
          await w().status(call, 'completed');
          expect((await w().doses(p))[0]!.status).not.toBe('confirmed');
        });
      }
    });
  });
}
