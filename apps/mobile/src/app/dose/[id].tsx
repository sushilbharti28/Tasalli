import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, pendingApi, unwrap } from '@/api/client';
import { AppText, Button, Card, LoadError, Loading, Screen } from '@/components/ui';
import { StatusBadge } from '@/components/DoseCard';
import { useAsync } from '@/hooks/useAsync';
import { addDays, dateInZone, DEFAULT_TIME_ZONE, displayInstant } from '@/lib/time';
import { usePeople } from '@/people/PeopleContext';
import { space } from '@/theme';

export default function MissedDose() {
  const { id, personId } = useLocalSearchParams<{ id: string; personId?: string }>();
  const { t } = useTranslation();
  const { people, selected } = usePeople();
  const person = people.find((p) => p.id === personId) ?? selected;
  const tz = person?.timeZone ?? DEFAULT_TIME_ZONE;
  const [note, setNote] = useState<string | null>(null);

  const { data, error, reload } = useAsync(async () => {
    const [calls, doses] = await Promise.all([
      unwrap(api.GET('/doses/{doseId}/calls', { params: { path: { doseId: id } } })),
      person?.id
        ? unwrap(api.GET('/people/{personId}/doses', { params: { path: { personId: person.id }, query: { from: addDays(dateInZone(new Date(), tz), -7), to: dateInZone(new Date(), tz) } } }))
        : Promise.resolve([]),
    ]);
    return { calls, dose: doses.find((d) => d.id === id) };
  }, [id, person?.id]);

  if (error) return <Screen><LoadError onRetry={reload} /></Screen>;
  if (!data) return <Screen><Loading /></Screen>;
  const { calls, dose } = data;

  async function markTaken() {
    await api.POST('/doses/{doseId}/mark-taken', { params: { path: { doseId: id } } });
    setNote(t('missed.marked'));
    await reload();
  }
  async function remind() {
    const r = await pendingApi.remindAgain(id);
    setNote(r === 'queued' ? t('missed.oneMoreSent') : t('common.error'));
  }

  return (
    <Screen testID="missed-dose">
      {dose ? (
        <Card>
          <AppText variant="title">{dose.spokenName}</AppText>
          {dose.dueAt ? <AppText>{t('missed.due', { time: displayInstant(dose.dueAt, tz) })}</AppText> : null}
          <StatusBadge dose={dose} timeZone={tz} />
        </Card>
      ) : null}
      <AppText variant="label">{t('missed.attempts')}</AppText>
      {calls.length === 0 ? <AppText variant="muted">{t('missed.noAttempts')}</AppText> : null}
      <View style={{ gap: space.sm }}>
        {calls.map((c) => (
          <Card key={c.id}>
            <AppText style={{ fontWeight: '600' }}>
              {t('missed.attempt', { n: c.attempt ?? 1 })}
              {c.startedAt ? ` · ${displayInstant(c.startedAt, tz)}` : ''}
            </AppText>
            <AppText variant="muted">{c.result ? t(`missed.result.${c.result}`, { defaultValue: c.result }) : (c.status ?? '')}</AppText>
          </Card>
        ))}
      </View>
      {note ? <AppText style={{ fontWeight: '600' }}>{note}</AppText> : null}
      {dose?.status !== 'confirmed' ? <Button title={t('missed.markTaken')} onPress={() => void markTaken()} testID="mark-taken" /> : null}
      <Button kind="secondary" title={t('missed.oneMore')} onPress={() => void remind()} />
      <Button kind="link" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
