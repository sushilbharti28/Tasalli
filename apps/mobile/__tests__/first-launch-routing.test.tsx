import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import i18n from '@/i18n';
import { KEYS, removeItem, setItem } from '@/lib/storage';

async function open() {
  await renderRouter('./src/app');
  for (let i = 0; i < 5; i++) await act(async () => {});
}

describe('signed-out routing', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    await removeItem(KEYS.token);
  });

  it('a fresh install shows the story, then sign-in after Skip', async () => {
    await removeItem(KEYS.storySeen);
    await open();
    expect(screen).toHavePathname('/welcome');
    expect(screen.getByTestId('story')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('story-skip'));
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(screen).toHavePathname('/sign-in');
  });

  it('once the story was seen, opens sign-in straight away', async () => {
    await setItem(KEYS.storySeen, '1');
    await open();
    expect(screen).toHavePathname('/sign-in');
  });
});
