import { buildPreviewText } from '@/features/medicine/preview';
import { AVAILABLE_CALL_LANGUAGES } from '@/api/types';
import en from '@/i18n/en';
import hi from '@/i18n/hi';

describe('wording that works for yourself and for someone you care for', () => {
  it('no screen text assumes the person is a parent', () => {
    for (const s of [en.person.parent, en.today.noPeople, en.plans.one_parent, en.plans.two_parents, en.settings.privacy]) {
      expect(s).not.toMatch(/\bparents?\b|family's/i);
    }
    for (const s of [hi.person.parent, hi.settings.privacy]) expect(s).not.toMatch(/माता-पिता|परिवार/);
    expect(en.person.nicknameSelf).toMatch(/you/);
  });

  it('only Hindi can be picked for calls today', () => {
    expect(AVAILABLE_CALL_LANGUAGES).toEqual(['hi']);
  });

  it('call preview matches the real call: greets by first name, no child, says "haan" not "le li", keeps the amount verbatim', () => {
    const text = buildPreviewText({
      fullName: 'Ramesh Sharma', language: 'hi',
      medicine: { kind: 'tablet', stripName: 'Amlodac', strengthText: '5 mg', spokenName: 'BP wali',
        appearance: { colourPrimary: 'white', shape: 'round', size: 'small', keptIn: 'strip', packColour: 'green' },
        schedules: [{ localTime: '09:00', amountText: '1 tablet', food: 'after' }] },
    });
    expect(text).toMatch(/^Namaste Ramesh ji\. Hum Tasalli app se bol rahe hain\./);
    expect(text).toContain('Aapki dawai, 1 tablet Amlodac 5 mg ki hai. Ise aap BP wali kehte hain.');
    expect(text).toContain('Yeh ek chhoti si safed gol goli hai. Iska patta hari hai.');
    expect(text).toMatch(/"haan" boliye, ya 1 dabaiye\.$/);
    expect(text).not.toMatch(/le li|taraf se|Papa/);
  });
});
