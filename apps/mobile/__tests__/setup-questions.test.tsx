import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import i18n from '@/i18n';
import Setup from '@/app/setup';
import { api, setAuthToken, unwrap } from '@/api/client';
import { mockControl } from '@/api/mock/server';
import {
  canContinue,
  dayTimes,
  EMPTY_DRAFT,
  personBody,
  takeAfterSetup,
  timeProblems,
  timesFor,
  type SetupDraft,
} from '@/features/onboarding/setup';
import { canStep, inWindow, MEAL_WINDOWS, stepTime } from '@/lib/meals';
import { KEYS, removeItem } from '@/lib/storage';
import { toCallableE164 } from '@/lib/phone';
import { MEAL_WINDOWS as CONTRACT_WINDOWS } from '../../../packages/contracts/src/meals';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

const mockReload = jest.fn(async () => undefined);
const mockSelect = jest.fn();
jest.mock('@/people/PeopleContext', () => ({
  usePeople: () => ({
    reload: mockReload,
    select: mockSelect,
    people: [],
    loading: false,
    error: false,
    selectedId: null,
    selected: undefined,
  }),
}));

const draft = (p: Partial<SetupDraft>): SetupDraft => ({ ...EMPTY_DRAFT, ...p });

describe('meal windows and time steps', () => {
  it('match the contracts package', () => {
    expect(MEAL_WINDOWS).toEqual(CONTRACT_WINDOWS);
  });

  it('never step a time out of its window, including bedtime across midnight', () => {
    const b = MEAL_WINDOWS.breakfast;
    expect(stepTime(b, '11:15', 15)).toBe('11:30');
    expect(stepTime(b, '11:30', 15)).toBe('11:30');
    expect(canStep(b, '11:30', 15)).toBe(false);
    expect(stepTime(b, '05:00', -15)).toBe('05:00');
    const bed = MEAL_WINDOWS.bedtime;
    expect(stepTime(bed, '23:45', 15)).toBe('00:00');
    expect(stepTime(bed, '01:45', 15)).toBe('02:00');
    expect(stepTime(bed, '02:00', 15)).toBe('02:00');
    expect(stepTime(bed, '20:00', -15)).toBe('20:00');
    expect(inWindow(bed, '00:30')).toBe(true);
    expect(inWindow(bed, '03:00')).toBe(false);
  });

  it('needs "before" earlier than "after", and at least one time', () => {
    expect(canContinue(draft({}), 'when')).toBe(false);
    expect(timeProblems(draft({ slots: { bb: '09:00', ab: '09:00' } }))).toEqual([
      { kind: 'order', meal: 'breakfast' },
    ]);
    expect(timeProblems(draft({ slots: { bl: '10:00' } }))).toEqual([
      { kind: 'window', meal: 'lunch' },
    ]);
    expect(canContinue(draft({ slots: { bb: '08:00', ab: '09:00' } }), 'when')).toBe(true);
  });

  it('lists the day from morning to bedtime after midnight', () => {
    const d = draft({
      slots: { bt: '00:30', ab: '09:00' },
      extra: [{ id: 1, time: '06:00', food: 'before' }],
    });
    expect(dayTimes(d).map((x) => x.time)).toEqual(['06:00', '09:00', '00:30']);
    expect(dayTimes(d)[2]).toMatchObject({ meal: 'bedtime', food: 'any' });
  });

  it('greets by the full name; the relation word is only the family label', () => {
    const b = personBody(
      draft({ who: 'loved', name: ' Ramesh   Sharma ', rel: 'papa' }),
      'Papa',
      '+919876543210',
    );
    expect(b).toMatchObject({
      isSelf: false,
      nickname: 'Papa',
      fullName: 'Ramesh Sharma',
      phone: '+919876543210',
    });
    const me = personBody(draft({ who: 'me', name: 'Rahul Verma' }), null, '+919876543210');
    expect(me).toMatchObject({ isSelf: true, nickname: 'Rahul', fullName: 'Rahul Verma' });
    expect(me.phone).toBeUndefined();
  });
});

async function signInNewAccount() {
  mockControl.reset();
  const session = await unwrap(
    api.POST('/auth/otp/verify', { body: { phone: '+919876541111', code: '123456' } }),
  );
  setAuthToken(session.token!);
  expect(await unwrap(api.GET('/people'))).toEqual([]);
}

async function mount() {
  await render(<Setup />);
  await act(async () => {});
}
const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const disabled = (id: string) => screen.getByTestId(id).props.accessibilityState?.disabled === true;

describe('setup screen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    await removeItem(KEYS.setupDraft);
    mockReload.mockClear();
    mockSelect.mockClear();
    takeAfterSetup();
    await signInNewAccount();
  });

  it('for yourself: name, Hindi only, meal times in order, then saves and opens your medicines', async () => {
    await mount();
    expect(screen.getByText('Who should we remind?')).toBeTruthy();
    expect(screen.getByText(/We always take their consent before any reminder call/)).toBeTruthy();
    await press('who-me');
    expect(screen.getByText('What is your name?')).toBeTruthy();
    expect(screen.queryByTestId('rel-papa')).toBeNull();
    expect(disabled('setup-next')).toBe(true);
    await fireEvent.changeText(screen.getByTestId('setup-name'), 'Rahul Verma');
    await press('setup-next');

    expect(screen.getByText('Which language should your calls be in?')).toBeTruthy();
    expect(screen.getByTestId('lang-hi').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('lang-ta').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await press('setup-next');

    expect(screen.getByText('When do you take medicines?')).toBeTruthy();
    expect(disabled('setup-next')).toBe(true);
    await press('slot-ab');
    expect(screen.getByTestId('time-ab').props.children).toBe('9:00 AM');
    await press('slot-bb');
    for (let i = 0; i < 4; i++) await press('time-bb-up'); // 8:00 -> 9:00, same as "after"
    expect(screen.getByTestId('time-problem').props.children).toBe(
      'The before-breakfast time has to be earlier than the after-breakfast time.',
    );
    expect(disabled('setup-next')).toBe(true);
    await press('time-bb-down');
    expect(screen.queryByTestId('time-problem')).toBeNull();
    expect(screen.getByText('Save and add medicines')).toBeTruthy();
    await press('setup-next');
    await act(async () => {});

    const people = mockControl.db.people;
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      isSelf: true,
      fullName: 'Rahul Verma',
      nickname: 'Rahul',
      language: 'hi',
      consent: 'consented',
    });
    expect(await timesFor(people[0]!.id)).toEqual({
      slots: { ab: '09:00', bb: '08:45' },
      extra: [],
    });
    expect(takeAfterSetup()).toEqual({ pathname: '/person/[id]', params: { id: people[0]!.id } });
    expect(mockReload).toHaveBeenCalled();
  });

  it('for a loved one: relation label in the questions, then their number places the consent call', async () => {
    await mount();
    await press('who-loved');
    expect(screen.getByText('What is their name?')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('setup-name'), 'Ramesh Sharma');
    await press('rel-papa');
    await press('setup-next');
    expect(screen.getByText("Which language should Papa's calls be in?")).toBeTruthy();
    await press('setup-next');
    expect(screen.getByText('When does Papa take medicines?')).toBeTruthy();
    await press('slot-bt');
    expect(screen.getByTestId('time-bt').props.children).toBe('10:30 PM');
    await press('setup-next');

    expect(screen.getByText("What is Papa's mobile number?")).toBeTruthy();
    expect(mockControl.db.people).toHaveLength(0); // nothing saved, no call, until the number is given
    expect(disabled('setup-next')).toBe(true);
    await fireEvent.changeText(screen.getByTestId('setup-phone'), '98765 43210');
    await press('setup-next');
    await act(async () => {});

    const p = mockControl.db.people[0]!;
    expect(p).toMatchObject({
      isSelf: false,
      nickname: 'Papa',
      fullName: 'Ramesh Sharma',
      phone: '+919876543210',
      consent: 'pending',
    });
    expect(takeAfterSetup()).toEqual({ pathname: '/person/[id]/consent', params: { id: p.id } });
  });

  it('takes their own family word with "Other", and falls back to the name when it is left empty', async () => {
    await mount();
    await press('who-loved');
    await fireEvent.changeText(screen.getByTestId('setup-name'), 'Suresh Kumar');
    expect(screen.queryByTestId('rel-custom')).toBeNull();
    await press('rel-other');
    await press('setup-next');
    expect(screen.getByText("Which language should Suresh ji's calls be in?")).toBeTruthy();
    await press('setup-back');
    await fireEvent.changeText(screen.getByTestId('rel-custom'), '  Chacha ');
    await press('setup-next');
    expect(screen.getByText("Which language should Chacha's calls be in?")).toBeTruthy();
    await press('setup-next');
    await press('slot-ab');
    await press('setup-next');
    await fireEvent.changeText(screen.getByTestId('setup-phone'), '9876543210');
    await press('setup-next');
    await act(async () => {});
    expect(mockControl.db.people[0]).toMatchObject({
      nickname: 'Chacha',
      fullName: 'Suresh Kumar',
    });
  });

  it('only takes Indian mobile numbers for a loved one', async () => {
    expect(toCallableE164('98765 43210')).toBe('+919876543210');
    expect(toCallableE164('+44 7911 123456')).toBeNull(); // a pasted UK number is refused
    await mount();
    await press('who-loved');
    await fireEvent.changeText(screen.getByTestId('setup-name'), 'Ramesh');
    await press('setup-next');
    await press('setup-next');
    await press('slot-ab');
    await press('setup-next');
    expect(screen.getByText('+91')).toBeTruthy();
    expect(
      screen.getByText('Reminder calls go to Indian mobile numbers (+91) for now.'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('setup-phone'), '12345 67890');
    expect(disabled('setup-next')).toBe(true);
  });

  it('keeps the answers when the app is closed and reopened', async () => {
    await mount();
    await press('who-loved');
    await fireEvent.changeText(screen.getByTestId('setup-name'), 'Sunita');
    await act(async () => {});
    await screen.unmount();
    await mount();
    expect(screen.getByTestId('setup-name').props.value).toBe('Sunita');
    await press('setup-back');
    expect(screen.getByTestId('who-loved').props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('stops at 6 times a day', async () => {
    await mount();
    await press('who-me');
    await fireEvent.changeText(screen.getByTestId('setup-name'), 'Rahul');
    await press('setup-next');
    await press('setup-next');
    for (const k of ['bb', 'ab', 'bl', 'al', 'bd']) await press(`slot-${k}`);
    expect(screen.queryByTestId('time-cap')).toBeNull();
    await press('add-time');
    expect(screen.getByTestId('time-cap')).toBeTruthy();
    expect(disabled('add-time')).toBe(true);
    expect(disabled('slot-ad')).toBe(true);
    expect(disabled('slot-bb')).toBe(false); // a picked slot can still be removed
    expect(disabled('setup-next')).toBe(false);
  });

  it('uses Hindi when the app is in Hindi', async () => {
    await i18n.changeLanguage('hi');
    await mount();
    expect(screen.getByText('किसे याद दिलाएँ?')).toBeTruthy();
    await press('who-loved');
    await fireEvent.changeText(screen.getByTestId('setup-name'), 'Ramesh');
    await press('rel-maa');
    await press('setup-next');
    expect(screen.getByText('माँ के कॉल किस भाषा में हों?')).toBeTruthy();
  });
});
