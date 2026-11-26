import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import i18n from '@/i18n';
import Welcome from '@/app/welcome';
import { StoryProvider, useStory } from '@/features/onboarding/StoryContext';
import {
  autoNext,
  CALL,
  callDisplay,
  captionWords,
  DWELL,
  speaking,
  wordsSaid,
} from '@/features/onboarding/story';
import en from '@/i18n/en';
import { KEYS, removeItem } from '@/lib/storage';
import hi from '@/i18n/hi';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

describe('story timeline', () => {
  it('reveals caption words one by one over the line', () => {
    const line = { start: 1000, dur: 1000 };
    expect(wordsSaid(4, line, 999)).toBe(0);
    expect(wordsSaid(4, line, 1000)).toBe(1);
    expect(wordsSaid(4, line, 1500)).toBe(3);
    expect(wordsSaid(4, line, 5000)).toBe(4);
    expect(speaking(line, 500)).toBe('idle');
    expect(speaking(line, 1500)).toBe('talking');
    expect(speaking(line, 2000)).toBe('done');
  });

  it('rings, then counts call seconds up to the end of the scene', () => {
    expect(callDisplay(0)).toEqual({ state: 'calling' });
    expect(callDisplay(CALL.connectAt)).toEqual({ state: 'onCall', time: '00:01' });
    expect(callDisplay(CALL.connectAt + 2500)).toEqual({ state: 'onCall', time: '00:03' });
    expect(callDisplay(60_000)).toEqual({ state: 'onCall', time: '00:09' });
  });

  it('moves on after each dwell, never leaves the last scene, and stays put without auto', () => {
    expect(autoNext(0, DWELL.worry - 1, true)).toBeNull();
    expect(autoNext(0, DWELL.worry, true)).toBe(1);
    expect(autoNext(1, DWELL.call, true)).toBe(2);
    expect(autoNext(2, 1e9, true)).toBeNull();
    expect(autoNext(0, 1e9, false)).toBeNull();
  });

  it('uses a blank, not a real name, in both languages', () => {
    for (const m of [en, hi]) {
      expect(captionWords(m.story.call.say)).toContain('{blank}');
      expect(m.story.call.say).not.toMatch(/\{\{/);
    }
  });
});

function SeenProbe() {
  const { seen } = useStory();
  return <>{seen ? <WelcomeDone /> : <Welcome />}</>;
}
function WelcomeDone() {
  const { Text } = jest.requireActual('react-native');
  return <Text>story-done</Text>;
}

async function mount() {
  await render(
    <StoryProvider>
      <SeenProbe />
    </StoryProvider>,
  );
  await act(async () => {});
}

describe('story screen', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await i18n.changeLanguage('en');
    await removeItem(KEYS.storySeen);
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('plays the three scenes by itself, then waits for Get started', async () => {
    await mount();
    expect(screen.queryByText('Did Papa take his BP tablet today?')).toBeNull();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(screen.getByText('Did Papa take his BP tablet today?')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(DWELL.worry));
    expect(screen.getByText("Papa's phone")).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(DWELL.call + 200));
    expect(screen.getByText('always know')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(30_000));
    expect(screen.getByText('Papa missed his 9 PM tablet')).toBeTruthy();
    expect(screen.getByText('Get started')).toBeTruthy();
    expect(screen.queryByTestId('story-skip')).toBeNull();
    await fireEvent.press(screen.getByTestId('story-next'));
    expect(screen.getByText('story-done')).toBeTruthy();
  });

  it('Skip ends the story and is remembered', async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('story-skip'));
    expect(screen.getByText('story-done')).toBeTruthy();
    // A fresh provider reads the saved flag.
    await screen.unmount();
    await mount();
    expect(screen.getByText('story-done')).toBeTruthy();
  });

  it('with reduced motion it shows each scene finished and does not move on by itself', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await mount();
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(screen.getByText("I can't call him every morning…")).toBeTruthy();
    await fireEvent.press(screen.getByTestId('story-next'));
    expect(screen.getByText(/On call/)).toBeTruthy();
    expect(screen.getByText('"Yes, I took it."')).toBeTruthy();
  });
});
