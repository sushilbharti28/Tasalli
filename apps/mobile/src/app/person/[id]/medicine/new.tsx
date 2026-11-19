import React, { useCallback, useMemo, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, unwrap } from '@/api/client';
import type { MedicineKind } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { Button, ErrorText, LoadError, Loading, ProgressBar, Screen } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import {
  emptyDraft,
  nextStep,
  prevStep,
  progress,
  setKind,
  toMedicineCreate,
  validateStep,
  type MedicineDraft,
  type StepErrors,
  type StepId,
} from '@/features/medicine/draft';
import { findLookAlikes } from '@/features/medicine/lookalike';
import { AmountStep, CheckStep, KeptStep, KindStep, LooksStep, NameStep, previewFor, type StepProps } from '@/features/medicine/steps';
import { dateInZone, DEFAULT_TIME_ZONE } from '@/lib/time';

/** One question per screen. The step list depends on the kind (syrup skips "how it's kept"). */
export default function AddMedicine() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, error, reload } = useAsync(async () => {
    const [person, meds] = await Promise.all([
      unwrap(api.GET('/people/{personId}', { params: { path: { personId: id } } })),
      unwrap(api.GET('/people/{personId}/medicines', { params: { path: { personId: id } } })),
    ]);
    return { person, meds };
  }, [id]);

  const [draft, setDraft] = useState<MedicineDraft | null>(null);
  const [step, setStep] = useState<StepId>('kind');
  const [errors, setErrors] = useState<StepErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const current = useMemo<MedicineDraft | null>(() => {
    if (draft) return draft;
    if (!data) return null;
    return emptyDraft(dateInZone(new Date(), data.person.timeZone ?? DEFAULT_TIME_ZONE));
  }, [draft, data]);

  const goBack = useCallback(() => {
    if (!current) return false;
    const prev = prevStep(step, current.kind);
    if (prev) {
      setStep(prev);
      setErrors({});
      return true;
    }
    return false; // first step: let the system go back
  }, [current, step]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
      return () => sub.remove();
    }, [goBack]),
  );

  if (error) return <Screen><LoadError onRetry={reload} /></Screen>;
  if (!data || !current) return <Screen><Loading /></Screen>;
  const { person, meds } = data;
  const d = current;

  const update: StepProps['update'] = (patch) => {
    setDraft((cur) => {
      const base = cur ?? d;
      return typeof patch === 'function' ? patch(base) : { ...base, ...patch };
    });
    setErrors({});
  };

  function advance() {
    const errs = validateStep(step, d);
    if (Object.keys(errs).length) return setErrors(errs);
    const next = nextStep(step, d.kind);
    if (next) {
      setStep(next);
      setErrors({});
    }
  }

  function pickKind(kind: MedicineKind) {
    setDraft(setKind(d, kind));
    setStep('name'); // choosing a tile moves on
    setErrors({});
  }

  async function save() {
    setSaving(true);
    setSaveError(false);
    try {
      const saved = await unwrap(api.POST('/people/{personId}/medicines', { params: { path: { personId: id } }, body: toMedicineCreate(d) }));
      const open = (saved.lookAlike ?? []).find((c) => !c.autoResolvedBy);
      if (open && saved.medicine?.id) {
        router.replace({ pathname: '/person/[id]/look-alike', params: { id, medicineId: saved.medicine.id, otherId: open.otherMedicineId ?? '' } });
      } else {
        router.replace({ pathname: '/person/[id]', params: { id } });
      }
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const prog = progress(step, d.kind);
  const stepProps: StepProps = { draft: d, update, errors, person };
  const isCheck = step === 'check';
  const candidate = isCheck ? toMedicineCreate(d) : null;
  const conflicts = candidate ? findLookAlikes(candidate, meds, person.canReadStrip) : [];

  return (
    <Screen testID={`step-${step}`}>
      <ProgressBar fraction={prog.fraction} label={t('med.stepOf', { n: prog.index, total: prog.total })} />
      {step === 'kind' ? <KindStep {...stepProps} onPick={pickKind} /> : null}
      {step === 'name' ? <NameStep {...stepProps} /> : null}
      {step === 'looks' ? <LooksStep {...stepProps} /> : null}
      {step === 'kept' ? <KeptStep {...stepProps} /> : null}
      {step === 'amount' ? <AmountStep {...stepProps} /> : null}
      {isCheck ? (
        <CheckStep
          {...stepProps}
          goTo={(s) => setStep(s)}
          previewText={previewFor(d, person, user?.name ?? '', () => candidate)}
          conflicts={conflicts}
          others={meds}
        />
      ) : null}
      {saveError ? <ErrorText>{t('common.error')}</ErrorText> : null}
      <View style={{ gap: 8 }}>
        {isCheck ? (
          <Button title={t('med.saveMedicine')} onPress={() => void save()} loading={saving} testID="save-medicine" />
        ) : step !== 'kind' ? (
          <Button title={t('common.next')} onPress={advance} testID="next" />
        ) : null}
        {step !== 'kind' ? <Button kind="link" title={t('common.back')} onPress={() => void goBack()} testID="back" /> : null}
      </View>
    </Screen>
  );
}
