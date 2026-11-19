import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, unwrap } from '@/api/client';
import type { Medicine, MedicineCreate } from '@/api/types';
import { AppText, Button, Card, ChipGroup, ErrorText, LoadError, Loading, Screen } from '@/components/ui';
import { COLOURS } from '@/features/medicine/draft';
import { nextNumberLabel } from '@/features/medicine/lookalike';
import { useAsync } from '@/hooks/useAsync';
import { space } from '@/theme';

type Option = 'number_label' | 'say_printed_name' | 'print_colour';

const body = (m: Medicine): MedicineCreate => {
  const { id: _id, active: _active, ...rest } = m;
  return rest;
};

/** Shown only when the new medicine looks like another one and nothing already tells them apart. */
export default function LookAlike() {
  const { id, medicineId, otherId } = useLocalSearchParams<{ id: string; medicineId: string; otherId: string }>();
  const { t } = useTranslation();
  const { data, error, reload } = useAsync(async () => {
    const [person, meds] = await Promise.all([
      unwrap(api.GET('/people/{personId}', { params: { path: { personId: id } } })),
      unwrap(api.GET('/people/{personId}/medicines', { params: { path: { personId: id } } })),
    ]);
    return { person, meds };
  }, [id]);
  const [choice, setChoice] = useState<Option | undefined>();
  const [printColour, setPrintColour] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  if (error) return <Screen><LoadError onRetry={reload} /></Screen>;
  if (!data) return <Screen><Loading /></Screen>;
  const { person, meds } = data;
  const a = meds.find((m) => m.id === medicineId);
  const b = meds.find((m) => m.id === otherId);
  if (!a || !b) return <Screen><LoadError onRetry={reload} /></Screen>;
  const name = person.nickname ?? '';
  const numA = nextNumberLabel(meds.map((m) => m.numberLabel));
  const numB = nextNumberLabel(meds.map((m) => m.numberLabel), [numA]);
  // Recommendation follows the "can they read the strip" answer.
  const recommended: Option = person.canReadStrip === 'yes' ? 'say_printed_name' : 'number_label';
  const options: Option[] = recommended === 'say_printed_name' ? ['say_printed_name', 'number_label', 'print_colour'] : ['number_label', 'say_printed_name', 'print_colour'];

  async function patch(m: Medicine, changes: Partial<MedicineCreate>) {
    await unwrap(api.PATCH('/medicines/{medicineId}', { params: { path: { medicineId: m.id! } }, body: { ...body(m), ...changes } }));
  }

  async function apply() {
    if (!choice) return;
    setSaving(true);
    setFailed(false);
    try {
      if (choice === 'number_label') {
        await patch(a!, { numberLabel: numA });
        await patch(b!, { numberLabel: numB });
      } else if (choice === 'say_printed_name') {
        await patch(a!, { sayPrintedName: true });
        await patch(b!, { sayPrintedName: true });
      } else if (printColour) {
        await patch(a!, { appearance: { ...a!.appearance, printColour } });
      }
      router.replace({ pathname: '/person/[id]', params: { id } });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const hint = (o: Option) => (o === 'number_label' ? t('med.optNumberHint', { a: numA, b: numB }) : o === 'say_printed_name' ? t('med.optPrintedHint') : t('med.optPrintColourHint'));
  const title = (o: Option) => (o === 'number_label' ? t('med.optNumber') : o === 'say_printed_name' ? t('med.optPrinted') : t('med.optPrintColour'));

  return (
    <Screen testID="look-alike">
      <AppText variant="title">{t('med.lookAlikeTitle', { a: a.spokenName, b: b.spokenName })}</AppText>
      <AppText>{t('med.lookAlikeBody', { name })}</AppText>
      <View style={{ gap: space.md }}>
        {options.map((o) => (
          <Card key={o} style={choice === o ? { borderColor: '#0F6E64', borderWidth: 2 } : undefined}>
            <AppText style={{ fontWeight: '700' }}>
              {title(o)}
              {o === recommended ? `  (${t('med.recommended')})` : ''}
            </AppText>
            <AppText variant="muted">{hint(o)}</AppText>
            <Button kind={choice === o ? 'primary' : 'secondary'} title={choice === o ? `✓ ${t('common.selected')}` : t('common.choose')} onPress={() => setChoice(o)} testID={`option-${o}`} />
            {o === 'print_colour' && choice === o ? (
              <ChipGroup label={t('med.printColour')} options={COLOURS} value={printColour as (typeof COLOURS)[number] | undefined} onChange={setPrintColour} labelOf={(c) => t(`colours.${c}`)} />
            ) : null}
          </Card>
        ))}
      </View>
      {failed ? <ErrorText>{t('common.error')}</ErrorText> : null}
      <Button title={t('common.save')} onPress={() => void apply()} loading={saving} disabled={!choice || (choice === 'print_colour' && !printColour)} testID="apply-lookalike" />
      <Button kind="link" title={t('med.keepAsIs')} onPress={() => router.replace({ pathname: '/person/[id]', params: { id } })} />
    </Screen>
  );
}
