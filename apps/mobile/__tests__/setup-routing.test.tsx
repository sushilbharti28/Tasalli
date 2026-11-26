import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import i18n from '@/i18n';
import { api, unwrap } from '@/api/client';
import { mockControl } from '@/api/mock/server';
import { KEYS, removeItem, setItem } from '@/lib/storage';

jest.setTimeout(20_000);

async function signedInAs(phone: string) {
  mockControl.reset();
  const session = await unwrap(api.POST('/auth/otp/verify', { body: { phone, code: '123456' } }));
  await setItem(KEYS.token, session.token!);
  await removeItem(KEYS.setupDraft);
}

async function open() {
  await renderRouter('./src/app');
  for (let i = 0; i < 5; i++) await act(async () => {});
}

describe('signed-in routing', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('opens the setup questions when the account has nobody added, then your medicines once saved', async () => {
    await signedInAs('+919876541111');
    await open();
    expect(screen.getByTestId('setup')).toBeTruthy();
    expect(screen).toHavePathname('/setup');

    await fireEvent.press(screen.getByTestId('who-me'));
    await fireEvent.changeText(screen.getByTestId('setup-name'), 'Rahul');
    await fireEvent.press(screen.getByTestId('setup-next'));
    await fireEvent.press(screen.getByTestId('setup-next'));
    await fireEvent.press(screen.getByTestId('slot-ab'));
    await fireEvent.press(screen.getByTestId('setup-next'));
    for (let i = 0; i < 5; i++) await act(async () => {});
    await act(async () => jest.advanceTimersByTime(50));

    const me = mockControl.db.people[0]!;
    expect(screen).toHavePathname(`/person/${me.id}`);
  });

  it('opens the tabs when the account already has people', async () => {
    await signedInAs('+919876543210');
    await open();
    expect(screen.queryByTestId('setup')).toBeNull();
    expect(screen).toHavePathname('/');
  });
});
