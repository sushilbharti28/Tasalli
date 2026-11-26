import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '@/api/client';
import type { CallLanguage, LookAlikeConflict, Medicine, MedicineKind, Person } from '@/api/types';
import { AppText, Button, Card, ChipGroup, ErrorText, Field, Tile, Toggle } from '@/components/ui';
import { displayHhmm } from '@/lib/time';
import { colors, radius, space, touch } from '@/theme';
import {
  amountChips,
  COLOURS,
  FOODS,
  MARKINGS,
  SHAPES,
  SIZES,
  SLOTS,
  toggleSlot,
  V1_KINDS,
  type BottleSize,
  type KeptIn,
  type MeasuredWith,
  type MedicineDraft,
  type StepErrors,
  type StepId,
} from './draft';
import { buildPreviewText, speechLocale } from './preview';

export interface StepProps {
  draft: MedicineDraft;
  update: (patch: Partial<MedicineDraft> | ((d: MedicineDraft) => MedicineDraft)) => void;
  errors: StepErrors;
  person: Person;
}

const SWATCH: Record<string, string> = {
  white: '#FFFFFF', yellow: '#F2D43D', orange: '#F08A24', pink: '#F4A6C0', red: '#C62828', brown: '#7B4B2A',
  green: '#2E7D32', blue: '#1E5BB8', purple: '#6A3FA0', black: '#111111', silver: '#C0C0C0', gold: '#C9A227', clear: '#F4F4F4',
};

function useErr(errors: StepErrors) {
  const { t } = useTranslation();
  return (field: string) => (errors[field] ? t(`med.${errors[field]}`) : undefined);
}

function ColourPicker({ label, value, onChange, error, testIDPrefix }: { label: string; value?: string; onChange: (v: string) => void; error?: string; testIDPrefix?: string }) {
  const { t } = useTranslation();
  return (
    <ChipGroup
      label={label}
      options={COLOURS}
      value={value as (typeof COLOURS)[number] | undefined}
      onChange={onChange}
      labelOf={(c) => t(`colours.${c}`)}
      swatchOf={(c) => SWATCH[c]}
      error={error}
      testIDPrefix={testIDPrefix}
    />
  );
}

const KIND_ICON: Record<MedicineKind, string> = { tablet: '💊', capsule: '💊', syrup: '🧴', other: '📦' };

export function KindStep({ draft, errors, onPick }: StepProps & { onPick: (k: MedicineKind) => void }) {
  const { t } = useTranslation();
  const err = useErr(errors);
  return (
    <View style={styles.stack}>
      <AppText variant="title">{t('med.kindTitle')}</AppText>
      {V1_KINDS.map((k) => (
        <Tile key={k} icon={KIND_ICON[k]} title={t(`med.kind.${k}`)} selected={draft.kind === k} onPress={() => onPick(k)} testID={`kind-${k}`} />
      ))}
      {err('kind') ? <ErrorText>{err('kind')}</ErrorText> : null}
    </View>
  );
}

export function NameStep({ draft, update, errors, person }: StepProps) {
  const { t } = useTranslation();
  const err = useErr(errors);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const q = draft.stripName.trim();

  useEffect(() => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.GET('/medicine-names', { params: { query: { q, kind: draft.kind } } });
        if (live) setSuggestions((data ?? []).map((n) => n.name ?? '').filter((n) => n && n.toLowerCase() !== q.toLowerCase()));
      } catch {
        if (live) setSuggestions([]);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, draft.kind]);

  return (
    <View style={styles.stack}>
      <AppText variant="title">{t('med.nameTitle')}</AppText>
      <Field
        label={t('med.nameTitle')}
        placeholder={t('med.namePlaceholder')}
        value={draft.stripName}
        onChangeText={(v) => update({ stripName: v })}
        autoCapitalize="words"
        autoCorrect={false}
        error={err('stripName')}
        testID="strip-name"
      />
      {suggestions.length ? (
        <View style={styles.suggestions} accessibilityRole="list">
          {suggestions.map((s) => (
            <Pressable key={s} accessibilityRole="button" accessibilityLabel={s} onPress={() => update({ stripName: s })} style={styles.suggestion} testID={`suggest-${s}`}>
              <AppText>{s}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Field
        label={`${t('med.strength')} (${t('common.optional')})`}
        hint={t('med.strengthHint')}
        value={draft.strengthText}
        onChangeText={(v) => update({ strengthText: v })}
        testID="strength"
      />
      <Field
        label={t('med.spokenName', { name: person.nickname })}
        hint={t('med.spokenNameHint')}
        value={draft.spokenName}
        onChangeText={(v) => update({ spokenName: v })}
        error={err('spokenName')}
        testID="spoken-name"
      />
    </View>
  );
}

export function LooksStep({ draft, update, errors }: StepProps) {
  const { t } = useTranslation();
  const err = useErr(errors);
  const sizes = (
    <ChipGroup label={t('med.size')} options={SIZES} value={draft.size} onChange={(v) => update({ size: v })} labelOf={(v) => t(`med.sizes.${v}`)} error={err('size')} testIDPrefix="size" />
  );
  return (
    <View style={styles.stack}>
      <AppText variant="title">{t('med.looksTitle')}</AppText>
      {draft.kind === 'tablet' ? (
        <>
          <ColourPicker label={t('med.colour')} value={draft.colourPrimary} onChange={(v) => update({ colourPrimary: v })} error={err('colourPrimary')} testIDPrefix="colour" />
          <ChipGroup label={t('med.shape')} options={SHAPES} value={draft.shape} onChange={(v) => update({ shape: v })} labelOf={(v) => t(`med.shapes.${v}`)} error={err('shape')} testIDPrefix="shape" />
          {sizes}
          <ChipGroup label={t('med.marking')} options={MARKINGS} value={draft.marking} onChange={(v) => update({ marking: v })} labelOf={(v) => t(`med.markings.${v}`)} testIDPrefix="marking" />
        </>
      ) : null}
      {draft.kind === 'capsule' ? (
        <>
          <ColourPicker label={t('med.colour1')} value={draft.colourPrimary} onChange={(v) => update({ colourPrimary: v })} error={err('colourPrimary')} testIDPrefix="colour" />
          <ColourPicker label={t('med.colour2')} value={draft.colourSecondary} onChange={(v) => update({ colourSecondary: v })} error={err('colourSecondary')} testIDPrefix="colour2" />
          {sizes}
          <ChipGroup
            label={t('med.printing')}
            options={['plain', 'letters', 'unknown'] as const}
            value={draft.marking as 'plain' | 'letters' | 'unknown' | undefined}
            onChange={(v) => update({ marking: v })}
            labelOf={(v) => t(`med.markings.${v}`)}
            testIDPrefix="printing"
          />
        </>
      ) : null}
      {draft.kind === 'syrup' ? (
        <>
          <ColourPicker label={t('med.bottleColour')} value={draft.bottleColour} onChange={(v) => update({ bottleColour: v })} error={err('bottleColour')} testIDPrefix="bottle" />
          <ColourPicker label={`${t('med.capColour')} (${t('common.optional')})`} value={draft.capColour} onChange={(v) => update({ capColour: v })} testIDPrefix="cap" />
          <ColourPicker label={`${t('med.labelColour')} (${t('common.optional')})`} value={draft.labelColour} onChange={(v) => update({ labelColour: v })} testIDPrefix="label" />
          <ChipGroup
            label={`${t('med.bottleSize')} (${t('common.optional')})`}
            options={['small', 'medium', 'large'] as BottleSize[]}
            value={draft.bottleSize}
            onChange={(v) => update({ bottleSize: v })}
            labelOf={(v) => t(`med.bottleSizes.${v}`)}
          />
        </>
      ) : null}
      {draft.kind === 'other' ? (
        <Field
          label={t('med.describe')}
          hint={t('med.describeHint')}
          value={draft.description}
          onChangeText={(v) => update({ description: v })}
          multiline
          error={err('description')}
          testID="describe"
        />
      ) : null}
    </View>
  );
}

export function KeptStep({ draft, update, errors }: StepProps) {
  const { t } = useTranslation();
  const err = useErr(errors);
  async function pickPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (!res.canceled && res.assets?.[0]) update({ photoUri: res.assets[0].uri });
  }
  return (
    <View style={styles.stack}>
      <AppText variant="title">{t('med.keptTitle')}</AppText>
      <ChipGroup
        options={['strip', 'loose', 'bottle'] as KeptIn[]}
        value={draft.keptIn}
        onChange={(v) => update({ keptIn: v, stripColour: v === 'strip' ? draft.stripColour : undefined })}
        labelOf={(v) => t(`med.kept.${v}`)}
        error={err('keptIn')}
        testIDPrefix="kept"
      />
      {draft.keptIn === 'strip' ? (
        <ColourPicker label={t('med.stripColour')} value={draft.stripColour} onChange={(v) => update({ stripColour: v })} error={err('stripColour')} testIDPrefix="strip" />
      ) : null}
      <Button kind="secondary" icon="📷" title={draft.photoUri ? t('med.photoAdded') : t('med.photo')} onPress={pickPhoto} testID="photo" />
      {draft.photoUri ? <Image source={{ uri: draft.photoUri }} style={styles.photo} accessibilityIgnoresInvertColors /> : null}
    </View>
  );
}

function shiftTime(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function AmountStep({ draft, update, errors, person }: StepProps) {
  const { t } = useTranslation();
  const err = useErr(errors);
  const chips = amountChips(draft.kind, person.language as CallLanguage | undefined);
  const [customAmount, setCustomAmount] = useState(!!draft.amountText && !chips.includes(draft.amountText));
  return (
    <View style={styles.stack}>
      <AppText variant="title">{t('med.amountTitle')}</AppText>
      {draft.kind === 'syrup' ? (
        <>
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label={t('med.syrupAmount')} value={draft.syrupQty} onChangeText={(v) => update({ syrupQty: v })} keyboardType="decimal-pad" error={err('syrupQty')} testID="syrup-qty" />
            </View>
          </View>
          <ChipGroup options={['chammach', 'ml'] as const} value={draft.syrupUnit} onChange={(v) => update({ syrupUnit: v })} labelOf={(v) => t(`med.unit.${v}`)} testIDPrefix="unit" />
          <ChipGroup
            label={`${t('med.measuredWith')} (${t('common.optional')})`}
            options={['spoon', 'cap', 'cup', 'syringe'] as MeasuredWith[]}
            value={draft.measuredWith}
            onChange={(v) => update({ measuredWith: v })}
            labelOf={(v) => t(`med.measured.${v}`)}
          />
          <Toggle label={t('med.shakeFirst')} value={draft.shakeFirst} onChange={(v) => update({ shakeFirst: v })} testID="shake" />
        </>
      ) : (
        <>
          {chips.length ? (
            <ChipGroup
              label={t('med.amount')}
              options={chips}
              value={customAmount ? undefined : draft.amountText}
              onChange={(v) => {
                setCustomAmount(false);
                update({ amountText: v });
              }}
              labelOf={(v) => v}
              testIDPrefix="amount"
            />
          ) : null}
          {chips.length && !customAmount ? (
            <Button kind="link" title={t('med.amountOther')} onPress={() => { setCustomAmount(true); update({ amountText: '' }); }} />
          ) : (
            <Field label={chips.length ? t('med.amountOther') : t('med.amount')} value={draft.amountText} onChangeText={(v) => update({ amountText: v })} testID="amount-text" />
          )}
          {err('amountText') ? <ErrorText>{err('amountText')}</ErrorText> : null}
        </>
      )}

      <ChipGroup label={t('med.when')} options={SLOTS} value={draft.slots.map((s) => s.slot)} onChange={(s) => update((d) => toggleSlot(d, s))} labelOf={(s) => t(`med.slots.${s}`)} multi error={err('slots')} testIDPrefix="slot" />
      {draft.slots.map((s) => (
        <View key={s.slot} style={styles.timeRow}>
          <AppText style={{ flex: 1 }}>
            {t(`med.slots.${s.slot}`)}: <AppText style={{ fontWeight: '700' }}>{displayHhmm(s.time)}</AppText>
          </AppText>
          {[-15, 15].map((delta) => (
            <Pressable
              key={delta}
              accessibilityRole="button"
              accessibilityLabel={`${t(`med.slots.${s.slot}`)} ${delta > 0 ? '+' : '−'}15 min`}
              onPress={() => update((d) => ({ ...d, slots: d.slots.map((x) => (x.slot === s.slot ? { ...x, time: shiftTime(x.time, delta) } : x)) }))}
              style={styles.timeBtn}
              testID={`time-${s.slot}-${delta > 0 ? 'plus' : 'minus'}`}
            >
              <AppText style={{ fontWeight: '700', color: colors.primary }}>{delta > 0 ? '+15' : '−15'}</AppText>
            </Pressable>
          ))}
        </View>
      ))}

      <ChipGroup label={t('med.food')} options={FOODS} value={draft.food} onChange={(v) => update({ food: v })} labelOf={(v) => t(`med.foods.${v}`)} error={err('food')} testIDPrefix="food" />
      <ChipGroup label={t('med.days')} options={['every', 'some'] as const} value={draft.days} onChange={(v) => update({ days: v })} labelOf={(v) => t(v === 'every' ? 'med.everyDay' : 'med.someDays')} testIDPrefix="days" />
      {draft.days === 'some' ? (
        <ChipGroup
          options={[1, 2, 3, 4, 5, 6, 7]}
          value={draft.daysOfWeek}
          onChange={(n) => update((d) => ({ ...d, daysOfWeek: d.daysOfWeek.includes(n) ? d.daysOfWeek.filter((x) => x !== n) : [...d.daysOfWeek, n] }))}
          labelOf={(n) => t(`med.weekdays.${n}`)}
          multi
          error={err('daysOfWeek')}
          testIDPrefix="weekday"
        />
      ) : null}
      <ChipGroup
        label={t('med.duration')}
        options={[0, 5, 7, 10, 30]}
        value={draft.durationDays ?? 0}
        onChange={(n) => update({ durationDays: n === 0 ? null : n })}
        labelOf={(n) => (n === 0 ? t('med.ongoing') : t('med.forDays', { n }))}
        testIDPrefix="duration"
      />
    </View>
  );
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <AppText variant="muted">{label}</AppText>
        <AppText style={{ fontWeight: '600' }}>{value}</AppText>
      </View>
      <Button kind="link" title={t('common.edit')} onPress={onEdit} accessibilityHint={label} />
    </View>
  );
}

export function CheckStep({
  draft,
  person,
  goTo,
  previewText,
  conflicts,
  others,
}: StepProps & { goTo: (s: StepId) => void; previewText: string; conflicts: LookAlikeConflict[]; others: Medicine[] }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const looks = describeLooks(draft, t);
  const times = [...draft.slots].sort((a, b) => a.time.localeCompare(b.time)).map((s) => displayHhmm(s.time)).join(', ');
  const amount = draft.kind === 'syrup' ? `${draft.syrupQty} ${t(`med.unit.${draft.syrupUnit}`)}` : draft.amountText;
  const resolved = conflicts.filter((c) => c.autoResolvedBy);

  function play() {
    Speech.stop();
    setPlaying(true);
    Speech.speak(previewText, {
      language: speechLocale((person.language ?? 'hi') as CallLanguage),
      rate: 0.9,
      onDone: () => setPlaying(false),
      onStopped: () => setPlaying(false),
      onError: () => setPlaying(false),
    });
  }

  return (
    <View style={styles.stack}>
      <AppText variant="title">{t('med.checkTitle')}</AppText>
      <AppText variant="muted">{t('med.checkHint')}</AppText>
      <Card>
        <Row label={t('med.kindTitle')} value={draft.kind ? t(`med.kind.${draft.kind}`) : ''} onEdit={() => goTo('kind')} />
        <Row label={t('med.nameTitle')} value={`${draft.stripName}${draft.strengthText ? ` ${draft.strengthText}` : ''}`} onEdit={() => goTo('name')} />
        <Row label={t('med.spokenName', { name: person.nickname })} value={draft.spokenName} onEdit={() => goTo('name')} />
        <Row label={t('med.looksTitle')} value={looks} onEdit={() => goTo('looks')} />
        {draft.kind !== 'syrup' ? <Row label={t('med.keptTitle')} value={draft.keptIn ? `${t(`med.kept.${draft.keptIn}`)}${draft.stripColour ? `, ${t(`colours.${draft.stripColour}`)}` : ''}` : ''} onEdit={() => goTo('kept')} /> : null}
        <Row label={t('med.amount')} value={amount} onEdit={() => goTo('amount')} />
        <Row label={t('med.when')} value={`${times}${draft.food ? ` · ${t(`med.foods.${draft.food}`)}` : ''}`} onEdit={() => goTo('amount')} />
      </Card>
      <Card testID="preview">
        <Button kind="secondary" icon="▶" title={playing ? t('med.playing') : t('med.play')} onPress={play} testID="play-preview" />
        <AppText>{previewText}</AppText>
        <AppText variant="muted">{t('med.previewNote')}</AppText>
      </Card>
      {resolved.map((c) => (
        <Card key={c.otherMedicineId} style={{ backgroundColor: colors.confirmedSoft }} testID="auto-resolved">
          <AppText>
            ✓ {t('med.autoResolved', { other: others.find((o) => o.id === c.otherMedicineId)?.spokenName ?? '', by: t(`med.by.${c.autoResolvedBy}`) })}
          </AppText>
        </Card>
      ))}
    </View>
  );
}

export function describeLooks(d: MedicineDraft, t: TFunction): string {
  const c = (x?: string) => (x ? t(`colours.${x}`) : '');
  switch (d.kind) {
    case 'tablet':
      return [c(d.colourPrimary), d.shape && t(`med.shapes.${d.shape}`), d.size && t(`med.sizes.${d.size}`), d.marking && t(`med.markings.${d.marking}`)].filter(Boolean).join(', ');
    case 'capsule':
      return [[c(d.colourPrimary), c(d.colourSecondary)].filter(Boolean).join(' / '), d.size && t(`med.sizes.${d.size}`)].filter(Boolean).join(', ');
    case 'syrup':
      return [c(d.bottleColour), d.capColour && `${t('med.capColour')}: ${c(d.capColour)}`].filter(Boolean).join(', ');
    default:
      return d.description;
  }
}

export function previewFor(draft: MedicineDraft, person: Person, toCreate: () => import('@/api/types').MedicineCreate | null) {
  const m = toCreate();
  if (!m) return '';
  return buildPreviewText({ medicine: m, fullName: person.fullName ?? '', language: (person.language ?? 'hi') as CallLanguage });
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  suggestions: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  suggestion: { minHeight: touch, justifyContent: 'center', paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  photo: { width: 160, height: 120, borderRadius: radius.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  timeBtn: { minWidth: touch, minHeight: touch, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch },
});
