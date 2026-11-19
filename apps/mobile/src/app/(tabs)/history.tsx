import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api, unwrap } from '@/api/client';
import { PersonTabs } from '@/components/PersonTabs';
import { AppText, Card, LoadError, Loading, Screen } from '@/components/ui';
import { dayStates, perMedicineRates, type DayState } from '@/features/doses/summary';
import { useAsync } from '@/hooks/useAsync';
import { addDays, dateInZone, DEFAULT_TIME_ZONE } from '@/lib/time';
import { usePeople } from '@/people/PeopleContext';
import { colors, radius, space } from '@/theme';

const LOOK: Record<DayState | 'none', { bg: string; fg: string; icon: string }> = {
  all: { bg: colors.confirmedSoft, fg: colors.confirmed, icon: '✓' },
  some_missed: { bg: colors.missedSoft, fg: colors.missed, icon: '✕' },
  pending: { bg: colors.upcomingSoft, fg: colors.upcoming, icon: '○' },
  none: { bg: colors.surface, fg: colors.inkMuted, icon: '–' },
};

export default function History() {
  const { t } = useTranslation();
  const { selected } = usePeople();
  const tz = selected?.timeZone ?? DEFAULT_TIME_ZONE;
  const personId = selected?.id;
  const { data, error, reload } = useAsync(async () => {
    if (!personId) return null;
    const today = dateInZone(new Date(), tz);
    const doses = await unwrap(api.GET('/people/{personId}/doses', { params: { path: { personId }, query: { from: addDays(today, -29), to: today } } }));
    return { today, doses };
  }, [personId, tz]);

  if (error) return <Screen><LoadError onRetry={reload} /></Screen>;
  if (personId && !data) return <Screen><Loading /></Screen>;
  const days = data ? Array.from({ length: 30 }, (_, i) => addDays(data.today, i - 29)) : [];
  const states = data ? dayStates(data.doses, tz) : {};
  const rates = data ? perMedicineRates(data.doses) : [];

  return (
    <Screen testID="history">
      <PersonTabs />
      <AppText variant="title">{t('history.title')}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {days.map((day) => {
          const l = LOOK[states[day] ?? 'none'];
          return (
            <View key={day} accessible accessibilityLabel={`${day} ${states[day] ?? 'none'}`} style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: l.bg, borderWidth: 1, borderColor: l.fg, alignItems: 'center', justifyContent: 'center' }}>
              <AppText variant="small" style={{ color: l.fg }}>{day.slice(8)}</AppText>
              <AppText variant="small" style={{ color: l.fg, fontWeight: '700' }}>{l.icon}</AppText>
            </View>
          );
        })}
      </View>
      <AppText variant="muted">✓ {t('history.legendAll')}   ✕ {t('history.legendSome')}   – {t('history.legendNone')}</AppText>
      <AppText variant="label">{t('history.perMedicine')}</AppText>
      <View style={{ gap: space.sm }}>
        {rates.map((r) => (
          <Card key={r.medicineId}>
            <AppText style={{ fontWeight: '700' }}>{r.spokenName}</AppText>
            <AppText variant="muted">{t('history.rate', { pct: r.pct, done: r.done, total: r.total })}</AppText>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
