import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Dose, DoseStatus } from '@/api/types';
import { AppText, Button } from '@/components/ui';
import { STATUS_ICON, canMarkTaken } from '@/features/doses/summary';
import { displayInstant } from '@/lib/time';
import { colors, radius, space, touch } from '@/theme';

const PALETTE: Record<DoseStatus, { fg: string; bg: string }> = {
  upcoming: { fg: colors.upcoming, bg: colors.upcomingSoft },
  calling: { fg: colors.calling, bg: colors.callingSoft },
  confirmed: { fg: colors.confirmed, bg: colors.confirmedSoft },
  missed: { fg: colors.missed, bg: colors.missedSoft },
  skipped_paused: { fg: colors.upcoming, bg: colors.upcomingSoft },
  cancelled: { fg: colors.upcoming, bg: colors.upcomingSoft }, // the family stopped the medicine
};

export function StatusBadge({ dose, timeZone }: { dose: Dose; timeZone: string }) {
  const { t } = useTranslation();
  const status = dose.status ?? 'upcoming';
  const p = PALETTE[status];
  const time = dose.confirmedAt ? displayInstant(dose.confirmedAt, timeZone) : '';
  const label = t(`today.status.${status}`, { time });
  return (
    <View style={[styles.badge, { backgroundColor: p.bg, borderColor: p.fg }]} accessibilityLabel={label}>
      <AppText style={{ color: p.fg, fontWeight: '700' }}>
        {STATUS_ICON[status]} {label}
      </AppText>
    </View>
  );
}

export function DoseCard({
  dose,
  timeZone,
  detail,
  onMarkTaken,
  onOpen,
}: {
  dose: Dose;
  timeZone: string;
  detail?: string;
  onMarkTaken: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const status = dose.status ?? 'upcoming';
  const due = dose.dueAt ? displayInstant(dose.dueAt, timeZone) : '';
  return (
    <View style={[styles.card, { borderLeftColor: PALETTE[status].fg }]} testID={`dose-${dose.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${due}, ${dose.spokenName}`}
        onPress={onOpen}
        style={{ minHeight: touch, gap: space.xs }}
      >
        <AppText variant="small" style={{ color: colors.inkMuted }}>
          {due}
        </AppText>
        <AppText style={{ fontWeight: '700', fontSize: 18 }}>{dose.spokenName}</AppText>
        {detail ? <AppText variant="muted">{detail}</AppText> : null}
      </Pressable>
      <StatusBadge dose={dose} timeZone={timeZone} />
      {dose.confirmedVia ? <AppText variant="muted">{t(`today.via.${dose.confirmedVia}`)}</AppText> : null}
      {canMarkTaken(dose) ? <Button kind="secondary" title={t('today.markTaken')} onPress={onMarkTaken} testID={`mark-${dose.id}`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 6,
  },
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.xs },
});
