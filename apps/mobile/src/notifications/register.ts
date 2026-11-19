/**
 * Push registration (issue #50). The backend sends Firebase (FCM) pushes for missed doses,
 * so we register the native device token, not an Expo push token, and POST it to /devices.
 * Needs google-services.json from the founder's Firebase project for real builds.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/api/client';

export const MISSED_DOSE_CHANNEL = 'missed-dose';

export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export type PushResult = 'registered' | 'denied' | 'unavailable';

export async function registerForPush(channelName: string): Promise<PushResult> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(MISSED_DOSE_CHANNEL, {
        name: channelName,
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return 'denied';
    const token = await Notifications.getDevicePushTokenAsync();
    const value = typeof token.data === 'string' ? token.data : JSON.stringify(token.data);
    const { response } = await api.POST('/devices', { body: { token: value } });
    return response.ok ? 'registered' : 'unavailable';
  } catch {
    // Emulator without Play services, missing google-services.json, offline: the app still works.
    return 'unavailable';
  }
}

/** Notification payloads carry { doseId } for a missed dose; open its detail screen. */
export function doseIdFrom(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { doseId?: unknown } | undefined;
  return typeof data?.doseId === 'string' ? data.doseId : null;
}
