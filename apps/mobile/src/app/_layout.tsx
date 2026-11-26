import '@/i18n';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { PeopleProvider } from '@/people/PeopleContext';
import { StoryProvider, useStory } from '@/features/onboarding/StoryContext';
import { Loading } from '@/components/ui';
import { configureNotificationHandler, doseIdFrom, registerForPush } from '@/notifications/register';
import { colors } from '@/theme';

configureNotificationHandler();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <StoryProvider>
          <RootNavigator />
        </StoryProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { ready, token } = useAuth();
  const story = useStory();
  const { t } = useTranslation();

  if (!ready || !story.loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <Loading />
      </View>
    );
  }

  const stack = (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
      }}
    >
      <Stack.Protected guard={!token && !story.seen}>
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="person/new" options={{ title: t('person.addPerson') }} />
        <Stack.Screen name="person/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="person/[id]/consent" options={{ title: '' }} />
        <Stack.Screen name="person/[id]/medicine/new" options={{ title: t('person.addMedicine') }} />
        <Stack.Screen name="person/[id]/look-alike" options={{ title: '' }} />
        <Stack.Screen name="dose/[id]" options={{ title: t('missed.title') }} />
      </Stack.Protected>
    </Stack>
  );

  return token ? (
    <PeopleProvider>
      <PushSetup />
      {stack}
    </PeopleProvider>
  ) : (
    stack
  );
}

/** Registers the push token once signed in and opens a missed dose when its notification is tapped. */
function PushSetup() {
  const { t } = useTranslation();
  useEffect(() => {
    void registerForPush(t('push.channel'));
    const open = (resp: Notifications.NotificationResponse | null) => {
      const doseId = doseIdFrom(resp);
      if (doseId) router.push({ pathname: '/dose/[id]', params: { id: doseId } });
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [t]);
  return null;
}
