import '@/i18n';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { PeopleProvider, usePeople } from '@/people/PeopleContext';
import { StoryProvider, useStory } from '@/features/onboarding/StoryContext';
import { takeAfterSetup } from '@/features/onboarding/setup';
import { Loading } from '@/components/ui';
import {
  configureNotificationHandler,
  doseIdFrom,
  registerForPush,
} from '@/notifications/register';
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

  if (!ready || !story.loaded) return <Splash />;

  return token ? (
    <PeopleProvider>
      <PushSetup />
      <AppStack signedIn storySeen={story.seen} />
    </PeopleProvider>
  ) : (
    <AppStack signedIn={false} storySeen={story.seen} />
  );
}

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <Loading />
    </View>
  );
}

function AppStack({ signedIn, storySeen }: { signedIn: boolean; storySeen: boolean }) {
  return signedIn ? (
    <SignedInStack />
  ) : (
    <Routes signedIn={false} storySeen={storySeen} needsSetup={false} />
  );
}

/**
 * Signed in: while the account has nobody added, the setup questions open instead of the tabs.
 * If the list can't be loaded, the tabs open and show their own error with a retry.
 */
function SignedInStack() {
  const { people, loading, error } = usePeople();
  const needsSetup = !error && people.length === 0;

  // Setup has just saved the first person: open what it asked for (their consent call, or your first medicine).
  useEffect(() => {
    if (loading || needsSetup) return;
    const to = takeAfterSetup();
    if (!to) return;
    // Wait one tick so the stack has applied the new guards; before that the screen is still locked.
    const id = setTimeout(() => router.push(to as never), 0);
    return () => clearTimeout(id);
  }, [loading, needsSetup]);

  if (loading) return <Splash />;
  return <Routes signedIn storySeen needsSetup={needsSetup} />;
}

function Routes({
  signedIn,
  storySeen,
  needsSetup,
}: {
  signedIn: boolean;
  storySeen: boolean;
  needsSetup: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
      }}
    >
      <Stack.Protected guard={!signedIn && !storySeen}>
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
      </Stack.Protected>
      {/* Sign-in opens only after the story. When "/" is locked, expo-router falls back to the first open screen by
          file name ("sign-in" sorts before "welcome"), so leaving both open skipped the story on a fresh install. */}
      <Stack.Protected guard={!signedIn && storySeen}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && needsSetup}>
        <Stack.Screen name="setup" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !needsSetup}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="person/new" options={{ title: t('person.addPerson') }} />
        <Stack.Screen name="person/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="person/[id]/consent" options={{ title: '' }} />
        <Stack.Screen
          name="person/[id]/medicine/new"
          options={{ title: t('person.addMedicine') }}
        />
        <Stack.Screen name="person/[id]/look-alike" options={{ title: '' }} />
        <Stack.Screen name="dose/[id]" options={{ title: t('missed.title') }} />
      </Stack.Protected>
    </Stack>
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
