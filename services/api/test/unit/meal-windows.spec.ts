import { CALL_LANGUAGES, isCallLanguageAvailable, isInMealWindow, minutesOf } from '@tasalli/contracts';

describe('meal windows (packages/contracts)', () => {
  it.each([
    ['breakfast', '05:00', true], ['breakfast', '11:30', true], ['breakfast', '04:59', false], ['breakfast', '20:00', false],
    ['lunch', '11:00', true], ['lunch', '16:00', true], ['lunch', '16:01', false],
    ['dinner', '16:14', false], ['dinner', '16:15', true], ['dinner', '23:30', true], ['dinner', '23:31', false],
    ['bedtime', '19:59', false], ['bedtime', '20:00', true], ['bedtime', '23:59', true], ['bedtime', '00:30', true], ['bedtime', '02:00', true], ['bedtime', '02:01', false],
  ] as const)('%s at %s -> %s', (meal, t, ok) => expect(isInMealWindow(meal, t)).toBe(ok));

  it('reads HH:MM and HH:MM:SS, rejects anything else', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('09:30:00')).toBe(570);
    expect(minutesOf('9:30')).toBeNaN();
    expect(isInMealWindow('breakfast', 'soon')).toBe(false);
  });

  it('only Hindi calls are available; the other five are coming soon', () => {
    expect(CALL_LANGUAGES.map((l) => l.code).sort()).toEqual(['bn', 'en', 'hi', 'mr', 'ta', 'te']);
    expect(isCallLanguageAvailable('hi')).toBe(true);
    expect(['en', 'bn', 'mr', 'ta', 'te'].some(isCallLanguageAvailable)).toBe(false);
  });
});
