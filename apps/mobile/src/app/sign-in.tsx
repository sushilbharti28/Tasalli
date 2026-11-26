/**
 * Sign-in in the dark setup style (prototype https://claude.ai/artifact/VkJf6gQh5XsV4SxXR98DVz).
 * Number: a compact country-code button (India first; children abroad can pick theirs) + the number.
 * Code: six boxes that sign in as soon as the sixth digit is in, a resend timer and "Change number".
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { api, isMockApi } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import {
  darkStyles as d,
  Guide,
  Hint,
  Input,
  Label,
  LinkButton,
  MainButton,
  Title,
} from '@/components/dark';
import { COUNTRY_CODES, maskPhone, toE164 } from '@/lib/phone';
import { dark as c, radius, space, touch } from '@/theme';

/** Seconds before "Resend code" can be tapped. */
export const RESEND_SECONDS = 30;
const CODE_LENGTH = 6;

export default function SignIn() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [cc, setCc] = useState<string>('+91');
  const [picking, setPicking] = useState(false);
  const [local, setLocal] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  // Resend countdown while the code screen is open.
  useEffect(() => {
    if (!phone || wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [phone, wait]);

  async function sendCode(to: string) {
    setBusy(true);
    setError(null);
    try {
      const { response } = await api.POST('/auth/otp/request', { body: { phone: to } });
      if (response.status === 429) return setError(t('signIn.tooMany'));
      if (!response.ok) return setError(t('common.error'));
      setPhone(to);
      setCode('');
      setWait(RESEND_SECONDS);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function requestCode() {
    const e164 = toE164(cc, local);
    if (!e164) return setError(t('signIn.invalidPhone'));
    void sendCode(e164);
  }

  async function verify(value: string) {
    if (!phone || value.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const { data, response } = await api.POST('/auth/otp/verify', {
        body: { phone, code: value },
      });
      if (response.status === 401 || !data?.token) {
        setCode('');
        return setError(t('signIn.wrongCode'));
      }
      await signIn(data.token, data.user);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function onCode(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void verify(digits);
  }

  function changeNumber() {
    setPhone(null);
    setCode('');
    setError(null);
  }

  const mmss = `0:${String(wait).padStart(2, '0')}`;

  return (
    <SafeAreaView style={d.screen} testID="sign-in">
      <StatusBar style="light" />
      {phone ? (
        <View style={s.top}>
          <Pressable
            onPress={changeNumber}
            accessibilityRole="button"
            accessibilityLabel={t('signIn.changeNumber')}
            style={s.back}
            hitSlop={8}
            testID="sign-in-back"
          >
            <Text style={s.backText}>←</Text>
          </Pressable>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[d.body, { paddingTop: phone ? space.sm : 48 }]}
        keyboardShouldPersistTaps="handled"
      >
        {!phone ? (
          <>
            <Guide text={t('signIn.say')} />
            <Title text={t('signIn.numberTitle')} />
            <View style={d.field}>
              <Label text={t('signIn.phone')} />
              <View style={s.row}>
                <Pressable
                  onPress={() => setPicking((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: picking }}
                  accessibilityLabel={t('signIn.countryA11y', { code: cc })}
                  style={[s.cc, picking && s.ccOpen]}
                  testID="cc-button"
                >
                  <Text style={s.ccText}>{cc}</Text>
                  <Text style={s.caret}>{picking ? '▴' : '▾'}</Text>
                </Pressable>
                <Input
                  value={local}
                  onChangeText={(v) => {
                    setLocal(v);
                    setError(null);
                  }}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  maxLength={15}
                  accessibilityLabel={t('signIn.phone')}
                  onSubmitEditing={requestCode}
                  style={{ flex: 1 }}
                  testID="phone-input"
                />
              </View>
              {picking ? (
                <View
                  style={s.list}
                  accessibilityRole="radiogroup"
                  accessibilityLabel={t('signIn.country')}
                >
                  {COUNTRY_CODES.map((x) => (
                    <Pressable
                      key={x.code}
                      onPress={() => {
                        setCc(x.code);
                        setPicking(false);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: cc === x.code }}
                      style={s.option}
                      testID={`cc-${x.code}`}
                    >
                      <Text style={s.optionText}>{x.label}</Text>
                      <Text style={s.optionCode}>
                        {x.code}
                        {cc === x.code ? '  ✓' : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Guide text={t('signIn.codeSay', { phone: maskPhone(phone) })} />
            <Title text={t('signIn.codeTitle')} />
            <Pressable onPress={() => codeRef.current?.focus()} accessible={false} style={s.boxes}>
              {Array.from({ length: CODE_LENGTH }, (_, k) => (
                <View
                  key={k}
                  style={[s.box, k === code.length && s.boxNext]}
                  importantForAccessibility="no-hide-descendants"
                >
                  <Text style={s.boxText}>{code[k] ?? ''}</Text>
                </View>
              ))}
              {/* One real input over the boxes: paste and SMS autofill work, and screen readers hear one field. */}
              <TextInput
                ref={codeRef}
                value={code}
                onChangeText={onCode}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                maxLength={CODE_LENGTH}
                autoFocus
                caretHidden
                editable={!busy}
                accessibilityLabel={t('signIn.code')}
                style={s.codeInput}
                testID="code-input"
              />
            </Pressable>
            <Hint text={isMockApi ? t('signIn.mockHint') : t('signIn.codeHint')} />
            <View style={s.resendRow}>
              {wait > 0 ? (
                <Text style={s.resendWait} testID="resend-wait">
                  {t('signIn.resendIn', { time: mmss })}
                </Text>
              ) : (
                <LinkButton
                  title={t('signIn.resend')}
                  onPress={() => void sendCode(phone)}
                  testID="resend"
                />
              )}
              <LinkButton
                title={t('signIn.changeNumber')}
                onPress={changeNumber}
                testID="change-number"
              />
            </View>
          </>
        )}
        {error ? <Hint text={error} warn /> : null}
      </ScrollView>
      <View style={d.foot}>
        {!phone ? (
          <MainButton
            title={t('signIn.sendCode')}
            onPress={requestCode}
            busy={busy}
            testID="send-code"
          />
        ) : null}
        <Text style={d.trust}>{t('story.trust')}</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  top: { paddingHorizontal: 10, paddingTop: space.md },
  back: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  backText: { color: c.ink, fontSize: 22 },
  row: { flexDirection: 'row', gap: space.sm },
  cc: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: c.line,
    backgroundColor: c.surface,
  },
  ccOpen: { borderColor: c.hi },
  ccText: { color: c.ink, fontSize: 17, fontWeight: '600' },
  caret: { color: c.hi, fontSize: 14 },
  list: { borderRadius: radius.lg, borderWidth: 2, borderColor: c.line, overflow: 'hidden' },
  option: {
    minHeight: touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  optionText: { color: c.ink, fontSize: 16 },
  optionCode: { color: c.soft, fontSize: 16, fontWeight: '600' },
  boxes: { flexDirection: 'row', gap: space.sm },
  box: {
    flex: 1,
    height: 58,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: c.line,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxNext: { borderColor: c.hi, backgroundColor: c.picked },
  boxText: { color: c.ink, fontSize: 22, fontWeight: '700' },
  codeInput: { ...StyleSheet.absoluteFill, opacity: 0.02, color: 'transparent' },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
  },
  resendWait: { color: c.soft, fontSize: 15 },
});
