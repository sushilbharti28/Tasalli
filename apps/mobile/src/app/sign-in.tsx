import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api, isMockApi } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { AppText, Button, ChipGroup, ErrorText, Field, Screen } from '@/components/ui';
import { COUNTRY_CODES, maskPhone, toE164 } from '@/lib/phone';
import { space } from '@/theme';

export default function SignIn() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [cc, setCc] = useState<string>('+91');
  const [local, setLocal] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    const e164 = toE164(cc, local);
    if (!e164) return setError(t('signIn.invalidPhone'));
    setBusy(true);
    setError(null);
    try {
      const { response } = await api.POST('/auth/otp/request', { body: { phone: e164 } });
      if (response.status === 429) return setError(t('signIn.tooMany'));
      if (!response.ok) return setError(t('common.error'));
      setPhone(e164);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!phone || !/^\d{6}$/.test(code)) return setError(t('signIn.wrongCode'));
    setBusy(true);
    setError(null);
    try {
      const { data, response } = await api.POST('/auth/otp/verify', { body: { phone, code } });
      if (response.status === 401 || !data?.token) return setError(t('signIn.wrongCode'));
      await signIn(data.token, data.user);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="sign-in">
      <View style={{ gap: space.sm, marginTop: space.xl }}>
        <AppText variant="hero">Tasalli</AppText>
        <AppText variant="title">{t('signIn.title')}</AppText>
      </View>
      {!phone ? (
        <>
          <AppText>{t('signIn.subtitle')}</AppText>
          <ChipGroup
            label={t('signIn.country')}
            options={COUNTRY_CODES.map((c) => c.code)}
            value={cc}
            onChange={setCc}
            labelOf={(c) => `${c} ${COUNTRY_CODES.find((x) => x.code === c)?.label ?? ''}`}
            testIDPrefix="cc"
          />
          <Field
            label={t('signIn.phone')}
            value={local}
            onChangeText={setLocal}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={15}
            testID="phone-input"
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button title={t('signIn.sendCode')} onPress={requestCode} loading={busy} testID="send-code" />
        </>
      ) : (
        <>
          <AppText variant="title">{t('signIn.codeTitle')}</AppText>
          <AppText variant="muted">{t('signIn.codeSentTo', { phone: maskPhone(phone) })}</AppText>
          <Field
            label={t('signIn.code')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            testID="code-input"
          />
          {isMockApi ? <AppText variant="muted">{t('signIn.mockHint')}</AppText> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button title={t('signIn.verify')} onPress={verify} loading={busy} disabled={code.length !== 6} testID="verify" />
          <Button
            kind="link"
            title={t('signIn.changeNumber')}
            onPress={() => {
              setPhone(null);
              setCode('');
              setError(null);
            }}
          />
        </>
      )}
    </Screen>
  );
}
