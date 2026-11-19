import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api, unwrap } from '@/api/client';
import type { PlanId } from '@/api/types';
import { AppText, Button, Card, LoadError, Loading, Screen } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { space } from '@/theme';

const PLANS: { id: PlanId; price: string; per: 'perMonth' | 'perYear' }[] = [
  { id: 'one_parent', price: '₹299', per: 'perMonth' },
  { id: 'two_parents', price: '₹499', per: 'perMonth' },
  { id: 'family_yearly', price: '₹4,999', per: 'perYear' },
];

/** Paywall. Only calls the API's /subscription; no payment SDK is bundled. */
export default function Plans() {
  const { t } = useTranslation();
  const { data: sub, error, reload } = useAsync(() => unwrap(api.GET('/subscription')), []);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<PlanId | null>(null);

  if (error) return <Screen><LoadError onRetry={reload} /></Screen>;
  if (!sub) return <Screen><Loading /></Screen>;

  const daysLeft = sub.trialEndsAt ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000)) : 7;

  async function choose(plan: PlanId) {
    setBusy(plan);
    try {
      await unwrap(api.POST('/subscription', { body: { plan } }));
      setNote(t('plans.started'));
      await reload();
    } catch {
      setNote(t('common.error'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen testID="plans">
      <AppText variant="title">{t('plans.title')}</AppText>
      <Card>
        <AppText style={{ fontWeight: '700' }}>
          {sub.status === 'trialing' ? (daysLeft > 0 ? t('plans.trial', { days: daysLeft }) : t('plans.trialEnded')) : t('plans.active', { plan: t(`plans.${sub.plan}`, { defaultValue: sub.plan }) })}
        </AppText>
      </Card>
      <View style={{ gap: space.md }}>
        {PLANS.map((p) => {
          const current = sub.status === 'active' && sub.plan === p.id;
          return (
            <Card key={p.id} testID={`plan-${p.id}`}>
              <AppText style={{ fontWeight: '700', fontSize: 18 }}>{t(`plans.${p.id}`)}</AppText>
              <AppText>{p.price}{t(`plans.${p.per}`)}</AppText>
              <AppText variant="muted">{t(`plans.${p.id}Desc`)}</AppText>
              <Button title={current ? t('plans.current') : t('plans.choose')} disabled={current} loading={busy === p.id} onPress={() => void choose(p.id)} />
            </Card>
          );
        })}
      </View>
      {note ? <AppText style={{ fontWeight: '600' }}>{note}</AppText> : null}
      <AppText variant="muted">{t('plans.note')}</AppText>
    </Screen>
  );
}
