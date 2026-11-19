/**
 * Small UI kit. Every pressable is at least `touch` (48dp) tall, has an accessibility role
 * and label, and selection is shown by a check mark and border, never colour alone.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { isMockApi } from '@/api/client';
import { colors, font, radius, space, touch } from '@/theme';

type TextVariant = 'hero' | 'title' | 'body' | 'muted' | 'small' | 'label';

export function AppText({
  variant = 'body',
  style,
  children,
  ...rest
}: { variant?: TextVariant; style?: StyleProp<TextStyle>; children?: React.ReactNode } & React.ComponentProps<typeof Text>) {
  return (
    <Text style={[styles.text, textStyles[variant], style]} {...rest}>
      {children}
    </Text>
  );
}

export function Screen({
  children,
  scroll = true,
  footer,
  testID,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  footer?: React.ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenContent, { flex: 1 }]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']} testID={testID}>
      {isMockApi ? (
        <View style={styles.mockBanner} accessibilityRole="text">
          <AppText variant="small" style={{ color: colors.calling }}>
            {t('common.mockBanner')}
          </AppText>
        </View>
      ) : null}
      {body}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'link';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  style,
  testID,
  accessibilityHint,
  icon,
}: {
  title: string;
  onPress?: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
  icon?: string;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
      style={({ pressed }) => [
        styles.button,
        buttonStyles[kind],
        pressed && kind === 'primary' && { backgroundColor: colors.primaryPressed },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? colors.onPrimary : colors.primary} />
      ) : (
        <Text style={[styles.buttonText, buttonTextStyles[kind]]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  testID,
  swatch,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  swatch?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      testID={testID}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {swatch ? <View style={[styles.swatch, { backgroundColor: swatch }]} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  labelOf,
  error,
  multi,
  testIDPrefix,
  swatchOf,
}: {
  label?: string;
  options: readonly T[];
  value: T | T[] | undefined;
  onChange: (v: T) => void;
  labelOf: (v: T) => string;
  error?: string;
  multi?: boolean;
  testIDPrefix?: string;
  swatchOf?: (v: T) => string | undefined;
}) {
  const isSel = (o: T) => (Array.isArray(value) ? value.includes(o) : value === o);
  return (
    <View style={styles.group} accessibilityRole={multi ? undefined : 'radiogroup'} accessibilityLabel={label}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View style={styles.chipRow}>
        {options.map((o) => (
          <Chip
            key={String(o)}
            label={labelOf(o)}
            selected={isSel(o)}
            onPress={() => onChange(o)}
            testID={testIDPrefix ? `${testIDPrefix}-${o}` : undefined}
            swatch={swatchOf?.(o)}
          />
        ))}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export function Tile({
  title,
  subtitle,
  icon,
  selected,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      testID={testID}
      style={[styles.tile, selected && styles.tileSelected]}
    >
      {icon ? <Text style={styles.tileIcon}>{icon}</Text> : null}
      <View style={{ flex: 1 }}>
        <AppText style={{ fontWeight: '700', fontSize: font.large }}>{title}</AppText>
        {subtitle ? <AppText variant="muted">{subtitle}</AppText> : null}
      </View>
      <Text style={[styles.radio, selected && styles.radioOn]}>{selected ? '✓' : ''}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  testID,
  ...input
}: { label: string; hint?: string; error?: string; testID?: string } & TextInputProps) {
  return (
    <View style={styles.group}>
      <AppText variant="label">{label}</AppText>
      {hint ? <AppText variant="muted">{hint}</AppText> : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.inkMuted}
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        testID={testID}
        {...input}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <AppText variant="small" style={{ color: colors.danger }} accessibilityLiveRegion="polite">
      ⚠ {children}
    </AppText>
  );
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      style={{ gap: space.xs }}
    >
      <AppText variant="small" style={{ color: colors.inkMuted }}>
        {label}
      </AppText>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(fraction * 100)}%` }]} />
      </View>
    </View>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }} accessibilityLabel={t('common.loading')}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <ErrorText>{t('common.error')}</ErrorText>
      <Button kind="secondary" title={t('common.retry')} onPress={onRetry} />
    </Card>
  );
}

export function Toggle({ label, hint, value, onChange, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <AppText>{label}</AppText>
        {hint ? <AppText variant="muted">{hint}</AppText> : null}
      </View>
      <View style={[styles.switchTrack, value && styles.switchTrackOn]}>
        <View style={[styles.switchKnob, value && styles.switchKnobOn]} />
      </View>
      <AppText variant="small" style={{ width: 36, textAlign: 'right' }}>
        {value ? 'ON' : 'OFF'}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.ink, fontSize: font.body, lineHeight: 22 },
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg, gap: space.sm },
  mockBanner: { backgroundColor: colors.callingSoft, paddingVertical: space.xs, paddingHorizontal: space.lg },
  button: {
    minHeight: touch,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: font.large, fontWeight: '700', textAlign: 'center' },
  chip: {
    minHeight: touch,
    minWidth: touch,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  chipSelected: { borderColor: colors.primary, borderWidth: 2.5, backgroundColor: colors.primarySoft },
  chipText: { fontSize: font.body, color: colors.ink },
  chipTextSelected: { fontWeight: '700', color: colors.primaryPressed },
  swatch: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.inkMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  group: { gap: space.sm },
  tile: {
    minHeight: 72,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  tileSelected: { borderColor: colors.primary, borderWidth: 3, backgroundColor: colors.primarySoft },
  tileIcon: { fontSize: 28 },
  radio: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.inkMuted,
    textAlign: 'center',
    lineHeight: 24,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  radioOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  input: {
    minHeight: touch,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: font.large,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, borderWidth: 1, borderColor: colors.border },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary },
  toggleRow: { minHeight: touch, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  switchTrack: { width: 48, height: 28, borderRadius: 14, backgroundColor: colors.border, padding: 3 },
  switchTrackOn: { backgroundColor: colors.primary },
  switchKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface },
  switchKnobOn: { transform: [{ translateX: 20 }] },
});

const textStyles: Record<TextVariant, TextStyle> = {
  hero: { fontSize: font.hero, lineHeight: 36, fontWeight: '700' },
  title: { fontSize: font.title, lineHeight: 30, fontWeight: '700' },
  body: {},
  muted: { color: colors.inkMuted, fontSize: font.small + 1, lineHeight: 21 },
  small: { fontSize: font.small, lineHeight: 20 },
  label: { fontWeight: '700' },
};

const buttonStyles: Record<ButtonKind, ViewStyle> = {
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  danger: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.danger },
  link: { backgroundColor: 'transparent', paddingHorizontal: space.sm },
};
const buttonTextStyles: Record<ButtonKind, TextStyle> = {
  primary: { color: colors.onPrimary },
  secondary: { color: colors.primary },
  danger: { color: colors.danger },
  link: { color: colors.primary, textDecorationLine: 'underline' },
};
