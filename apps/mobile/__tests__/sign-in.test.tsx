import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import i18n from '@/i18n';
import SignIn, { RESEND_SECONDS } from '@/app/sign-in';
import { mockControl } from '@/api/mock/server';
import { maskPhone } from '@/lib/phone';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

const mockSignIn = jest.fn(async () => undefined);
jest.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ signIn: mockSignIn }) }));

const press = (id: string) => fireEvent.press(screen.getByTestId(id));

async function mount() {
  await render(<SignIn />);
  await act(async () => {});
}

async function toCodeScreen() {
  await mount();
  await fireEvent.changeText(screen.getByTestId('phone-input'), '98765 43210');
  await press('send-code');
  await act(async () => {});
}

it('masks all but the last 4 digits, splitting the country code correctly', () => {
  expect(maskPhone('+919876543210')).toBe('+91 ••••• •3210');
  expect(maskPhone('+971501234567')).toBe('+971 ••••• 4567');
  expect(maskPhone('+447911123456')).toBe('+44 ••••• •3456');
  expect(maskPhone('nonsense')).toBe('••••');
});

describe('sign-in', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await i18n.changeLanguage('en');
    mockControl.reset();
    mockSignIn.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('asks for a valid number, with India preselected and other codes behind the button', async () => {
    await mount();
    expect(screen.getByText('Your mobile number')).toBeTruthy();
    expect(
      screen.getByText("We'll text you a 6-digit code. We never share your number."),
    ).toBeTruthy();
    expect(screen.queryByTestId('cc-+44')).toBeNull();
    await press('cc-button');
    await press('cc-+44');
    expect(screen.getByText('+44')).toBeTruthy();
    expect(screen.queryByTestId('cc-+44')).toBeNull();
    await press('cc-button');
    await press('cc-+91');
    await fireEvent.changeText(screen.getByTestId('phone-input'), '12345');
    await press('send-code');
    expect(screen.getByText('Please enter a valid mobile number.')).toBeTruthy();
  });

  it('signs in as soon as the sixth digit is typed', async () => {
    await toCodeScreen();
    expect(screen.getByText('Enter the 6-digit code')).toBeTruthy();
    expect(screen.getByText('Sent to +91 ••••• •3210.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('code-input'), '12345');
    expect(mockSignIn).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('code-input'), '123456');
    await act(async () => {});
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('clears a wrong code and says so', async () => {
    await toCodeScreen();
    await fireEvent.changeText(screen.getByTestId('code-input'), '000000');
    await act(async () => {});
    expect(screen.getByText('That code is wrong or has expired.')).toBeTruthy();
    expect(screen.getByTestId('code-input').props.value).toBe('');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('lets the code be resent after the timer, and goes back to change the number', async () => {
    await toCodeScreen();
    expect(screen.getByTestId('resend-wait').props.children).toBe('Resend code in 0:30');
    expect(screen.queryByTestId('resend')).toBeNull();
    for (let i = 0; i < RESEND_SECONDS; i++) await act(async () => jest.advanceTimersByTime(1000));
    await press('resend');
    await act(async () => {});
    expect(screen.getByTestId('resend-wait').props.children).toBe('Resend code in 0:30');
    await press('change-number');
    expect(screen.getByText('Your mobile number')).toBeTruthy();
  });
});
