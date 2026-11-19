import React from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, unwrap } from '@/api/client';
import type { Dose } from '@/api/types';
import { DoseCard } from '@/components/DoseCard';
import { PersonTabs } from '@/components/PersonTabs';
import { AppText, Button, Card, LoadError, Loading, Screen } from '@/components/ui';
import { doseDetail, weekSummary } from '@/features/doses/summary';
import { useAsync } from '@/hooks/useAsync';
import { addDays, dateInZone, DEFAULT_TIME_ZONE } from '@/lib/time';
import { usePeople } from '@/people/PeopleContext';
import { colors, space } from '@/theme';

export default function Today() {
  const { t } = useTranslation();
  const { people, selected, loading: peopleLoading, error: peopleError, reload: reloadPeople } = usePeople();
  const tz = selected?.timeZone ?? DEFAULT_TIME_ZONE;
  const personId = selected?.id;

  const { data, loading, error, reload } = useAsync(
    async () => {
      if (!personId) return null;
      const today = dateInZone(new Date(), tz);
      const [week, meds] = await Promise.all([
        unwrap(api.GET('/people/{personId}/doses', { params: { path: { personId }, query: { from: addDays(today, -6), to: today } } })),
        unwrap(api.GET('/people/{personId}/medicines', { params: { path: { personId } } })),
      ]);
      return { today, week, meds, todays: week.filter((d) => d.dueAt && dateInZone(new Date(d.dueAt), tz) === today) };
    },
    [personId, tz],
    { pollMs: 30000 },
  );

  useFocusEffect(
    React.useCallback(() => {
      void reloadPeople();
      void reload();
    }, [reloadPeople, reload]),
  );

  async function markTaken(dose: Dose) {
    if (!dose.id) return;
    await api.POST('/doses/{doseId}/mark-taken', { params: { path: { doseId: dose.id } } });
    await reload();
  }

  if (peopleLoading) return <Screen><Loading /></Screen>;
  if (peopleError) return <Screen><LoadError onRetry={reloadPeople} /></Screen>;

  if (!people.length) {
    return (
      <Screen testID="today">
        <Card>
          <AppText variant="title">{t('today.noPeople')}</AppText>
          <Button title={t('person.addPerson')} onPress={() => router.push('/person/new')} testID="add-person" />
        </Card>
      </Screen>
    );
  }

  const summary = data ? weekSummary(data.week) : null;

  return (
    <Screen testID="today">
      <PersonTabs />
      {selected && selected.consent !== 'consented' ? (
        <Card style={{ backgroundColor: colors.callingSoft }}>
          <AppText>{t('today.consentPending', { name: selected.nickname })}</AppText>
          <Button
            kind="secondary"
            title={t('consent.title', { name: selected.nickname })}
            onPress={() => router.push({ pathname: '/person/[id]/consent', params: { id: selected.id! } })}
          />
        </Card>
      ) : null}
      {summary && summary.total > 0 ? (
        <Card testID="week-summary">
          <AppText variant="label">{t('today.week', { done: summary.done, total: summary.total })}</AppText>
        </Card>
      ) : null}
      {loading && !data ? <Loading /> : null}
      {error ? <LoadError onRetry={reload} /> : null}
      {data && data.todays.length === 0 ? <AppText variant="muted">{t('today.empty')}</AppText> : null}
      <View style={{ gap: space.md }}>
        {data?.todays.map((d) => (
          <DoseCard
            key={d.id}
            dose={d}
            timeZone={tz}
            detail={doseDetail(d, data.meds, tz)}
            onMarkTaken={() => void markTaken(d)}
            onOpen={() => router.push({ pathname: '/dose/[id]', params: { id: d.id!, personId: personId! } })}
          />
        ))}
      </View>
      {selected ? (
        <View style={{ gap: space.sm }}>
          <Button
            kind="secondary"
            title={`${selected.nickname}: ${t('person.medicines')}`}
            onPress={() => router.push({ pathname: '/person/[id]', params: { id: selected.id! } })}
            testID="open-person"
          />
          {people.length < 4 ? <Button kind="link" title={t('person.addPerson')} onPress={() => router.push('/person/new')} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
