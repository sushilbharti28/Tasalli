/**
 * Building blocks for the dark setup screens (sign-in, setup questions; later consent and practice call), so they
 * share one look: the Tasalli "t" bubble, a question title, the yellow main button and a field label + input.
 * No decorative motion (founder, 27 Nov 2026).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { dark as c, radius, space } from '@/theme';

/** Tasalli speaking: a short "why we ask" line. */
export function Guide({ text }: { text: string }) {
  return (
    <View style={s.guide}>
      <View style={s.face} importantForAccessibility="no-hide-descendants">
        <Text style={s.faceText}>t</Text>
      </View>
      <View style={s.say}>
        <Text style={s.sayText}>{text}</Text>
      </View>
    </View>
  );
}

export function Title({ text }: { text: string }) {
  return (
    <Text style={s.q} accessibilityRole="header">
      {text}
    </Text>
  );
}

export function MainButton({
  title,
  onPress,
  disabled,
  busy,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const off = !!disabled || !!busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!busy }}
      style={({ pressed }) => [s.btn, off && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
      testID={testID}
    >
      <Text style={s.btnText}>{title}</Text>
    </Pressable>
  );
}

export function LinkButton({
  title,
  onPress,
  testID,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={s.link}
      hitSlop={4}
      testID={testID}
    >
      <Text style={s.linkText}>{title}</Text>
    </Pressable>
  );
}

export function Hint({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <Text
      style={[s.hint, warn && { color: c.warn }]}
      accessibilityRole={warn ? 'alert' : undefined}
    >
      {text}
    </Text>
  );
}

export function Label({ text, nativeID }: { text: string; nativeID?: string }) {
  return (
    <Text style={s.label} nativeID={nativeID}>
      {text}
    </Text>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor="rgba(255,255,255,0.45)"
      {...props}
      style={[s.input, props.style]}
    />
  );
}

export const darkStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  body: { paddingHorizontal: 22, paddingTop: space.md, paddingBottom: space.xl, gap: space.md },
  foot: { paddingHorizontal: 22, paddingTop: space.md, paddingBottom: space.xl, gap: space.sm },
  field: { gap: 6 },
  trust: { color: c.soft, fontSize: 12, textAlign: 'center' },
});

const s = StyleSheet.create({
  guide: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  face: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.hi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceText: { color: c.onHi, fontSize: 18, fontWeight: '700' },
  say: {
    flex: 1,
    backgroundColor: c.card,
    borderRadius: 18,
    borderTopLeftRadius: 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  sayText: { color: c.cardInk, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  q: { color: c.ink, fontSize: 24, lineHeight: 29, fontWeight: '700', marginTop: 2 },
  hint: { color: c.soft, fontSize: 14, lineHeight: 20 },
  label: { color: c.soft, fontSize: 14 },
  input: {
    minHeight: 52,
    borderWidth: 2,
    borderColor: c.line,
    backgroundColor: c.surface,
    color: c.ink,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 18,
  },
  btn: {
    backgroundColor: c.hi,
    borderRadius: radius.lg,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: c.onHi, fontSize: 17, fontWeight: '600' },
  link: { minHeight: 48, justifyContent: 'center' },
  linkText: { color: c.hi, fontSize: 15, fontWeight: '600' },
});
