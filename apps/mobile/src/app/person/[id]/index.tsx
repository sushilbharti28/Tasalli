import React from 'react';
import { View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, unwrap } from '@/api/client';
import { AppText, Button, Card, LoadError, Loading, Screen } from '@/components/ui';
import { consentView } from '@/features/consent/state';
import { useAsync } from '@/hooks/useAsync';
import { displayHhmm } from '@/lib/time';
import { space } from '@/theme';

export default function PersonDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { data, error, reload } = useAsync(async () => {
    const [person, meds] = await Promise.all([
      unwrap(api.GET('/people/{personId}', { params: { path: { personId: id } } })),
      unwrap(api.GET('/people/{personId}/medicines', { params: { path: { personId: id } } })),
    ]);
    return { person, meds };
  }, [id]);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (error) return <Screen><LoadError onRetry={reload} /></Screen>;
  if (!data) return <Screen><Loading /></Screen>;
  const { person, meds } = data;
  const view = consentView(person);

  return (
    <Screen testID="person-detail">
      <Stack.Screen options={{ title: person.nickname ?? '' }} />
      {view !== 'confirmed' ? (
        <Card>
          <AppText>{t('today.consentPending', { name: person.nickname })}</AppText>
          <Button kind="secondary" title={t('consent.title', { name: person.nickname })} onPress={() => router.push({ pathname: '/person/[id]/consent', params: { id } })} />
        </Card>
      ) : null}
      <AppText variant="title">{t('person.medicines')}</AppText>
      {meds.length === 0 ? <AppText variant="muted">{t('person.noMedicines')}</AppText> : null}
      <View style={{ gap: space.md }}>
        {meds.map((m) => (
          <Card key={m.id} testID={`medicine-${m.stripName}`}>
            <AppText style={{ fontWeight: '700', fontSize: 18 }}>{m.spokenName}</AppText>
            <AppText variant="muted">
              {t(`med.kind.${m.kind}`)} · {m.stripName}
              {m.strengthText ? ` ${m.strengthText}` : ''}
              {m.numberLabel != null ? ` · #${m.numberLabel}` : ''}
            </AppText>
            {m.schedules.map((s, i) => (
              <AppText key={i}>
                {displayHhmm(s.localTime)} · {s.amountText} · {t(`med.foods.${s.food}`)}
              </AppText>
            ))}
          </Card>
        ))}
      </View>
      <Button title={t('person.addMedicine')} onPress={() => router.push({ pathname: '/person/[id]/medicine/new', params: { id } })} testID="add-medicine" />
    </Screen>
  );
}
