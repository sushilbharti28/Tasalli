import { DEFAULT_TIME_ZONE } from '@/lib/time';
import React, { useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, unwrap } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import {
  AppText,
  Button,
  Card,
  ErrorText,
  Field,
  LoadError,
  Loading,
  Screen,
} from '@/components/ui';
import { consentView, noteConsentCall, type ConsentView } from '@/features/consent/state';
import { useAsync } from '@/hooks/useAsync';
import { toCallableE164 } from '@/lib/phone';
import { forgetPerson, rememberPhone } from '@/lib/storage';
import { usePeople } from '@/people/PeopleContext';
import { colors, space } from '@/theme';

const LOOK: Record<ConsentView, { icon: string; fg: string; bg: string }> = {
  calling: { icon: '☎', fg: colors.calling, bg: colors.callingSoft },
  waiting: { icon: '⏳', fg: colors.upcoming, bg: colors.upcomingSoft },
  confirmed: { icon: '✓', fg: colors.confirmed, bg: colors.confirmedSoft },
  declined: { icon: '✕', fg: colors.missed, bg: colors.missedSoft },
  opted_out: { icon: '⛔', fg: colors.missed, bg: colors.missedSoft },
};

export default function ConsentStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { reload: reloadPeople, select } = usePeople();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [local, setLocal] = useState('');

  const {
    data: person,
    error,
    reload,
  } = useAsync(
    () => unwrap(api.GET('/people/{personId}', { params: { path: { personId: id } } })),
    [id],
    {
      pollMs: 4000,
    },
  );

  if (error)
    return (
      <Screen>
        <LoadError onRetry={reload} />
      </Screen>
    );
  if (!person)
    return (
      <Screen>
        <Loading />
      </Screen>
    );

  const view = consentView(person);
  const name = person.nickname ?? '';
  const look = LOOK[view];
  const titleKey = {
    calling: 'consent.calling',
    waiting: 'consent.waiting',
    confirmed: 'consent.confirmed',
    declined: 'consent.declined',
    opted_out: 'consent.optedOut',
  }[view];
  const hintKey = {
    calling: 'consent.callingHint',
    waiting: 'consent.waitingHint',
    confirmed: 'consent.confirmedHint',
    declined: 'consent.declinedHint',
    opted_out: 'consent.optedOutHint',
  }[view];

  async function retry() {
    setBusy(true);
    setMsg(null);
    try {
      const { response } = await api.POST('/people/{personId}/consent-call', {
        params: { path: { personId: id } },
      });
      if (response.ok) noteConsentCall(id);
      else if (response.status !== 409) setMsg(t('common.error'));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  /** No phone field in PersonUpdate yet: replace the (unconsented) person with the new number. */
  async function changeNumber() {
    const phone = toCallableE164(local);
    if (!phone) return setMsg(t('signIn.invalidPhone'));
    setBusy(true);
    setMsg(null);
    try {
      const { data, response } = await api.POST('/people', {
        body: {
          isSelf: false,
          nickname: person!.nickname ?? '',
          fullName: person!.fullName ?? '', // required since v1.6; people added before it may have none (the API then says what is missing)
          phone,
          language: person!.language ?? 'hi',
          timeZone: person!.timeZone ?? DEFAULT_TIME_ZONE,
          canReadStrip: person!.canReadStrip,
        },
      });
      if (!response.ok || !data?.id)
        return setMsg(response.status === 409 ? t('person.blocked') : t('common.error'));
      await api.DELETE('/people/{personId}', { params: { path: { personId: id } } });
      await forgetPerson(id);
      await rememberPhone(data.id, phone);
      noteConsentCall(data.id);
      await reloadPeople();
      select(data.id);
      router.replace({ pathname: '/person/[id]/consent', params: { id: data.id } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="consent">
      <Stack.Screen options={{ title: t('consent.title', { name }) }} />
      <Card
        style={{ backgroundColor: look.bg, borderColor: look.fg, borderWidth: 2 }}
        testID={`consent-${view}`}
      >
        <AppText variant="hero" style={{ color: look.fg }} accessibilityElementsHidden>
          {look.icon}
        </AppText>
        <AppText variant="title" style={{ color: look.fg }} accessibilityLiveRegion="polite">
          {t(titleKey, { name })}
        </AppText>
        <AppText>{t(hintKey)}</AppText>
        <AppText variant="muted">{person.phoneMasked}</AppText>
      </Card>

      {view === 'calling' || view === 'waiting' ? (
        <AppText variant="muted">{t('consent.whatTheyHear', { child: user?.name ?? '' })}</AppText>
      ) : null}

      {msg ? <ErrorText>{msg}</ErrorText> : null}

      <View style={{ gap: space.sm }}>
        {view === 'confirmed' ? (
          <Button
            title={t('consent.addMedicine')}
            onPress={() =>
              router.replace({ pathname: '/person/[id]/medicine/new', params: { id } })
            }
            testID="add-first-medicine"
          />
        ) : null}
        {view === 'waiting' || view === 'declined' ? (
          <Button
            title={t('consent.retry')}
            onPress={retry}
            loading={busy}
            testID="consent-retry"
          />
        ) : null}
        {view !== 'confirmed' ? (
          changing ? (
            <Card>
              <Field
                label={t('consent.newNumber')}
                hint={t('person.indiaOnly')}
                value={local}
                onChangeText={setLocal}
                keyboardType="phone-pad"
                maxLength={15}
                testID="new-number"
              />
              <Button
                title={t('common.save')}
                onPress={changeNumber}
                loading={busy}
                testID="save-number"
              />
              <Button kind="link" title={t('common.cancel')} onPress={() => setChanging(false)} />
            </Card>
          ) : (
            <Button
              kind="secondary"
              title={t('consent.changeNumber')}
              onPress={() => setChanging(true)}
              testID="change-number"
            />
          )
        ) : null}
      </View>
    </Screen>
  );
}
