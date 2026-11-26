import React, { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { AVAILABLE_CALL_LANGUAGES, type CallLanguage, type CanReadStrip } from '@/api/types';
import { AppText, Button, Card, ChipGroup, ErrorText, Field, Screen, Tile } from '@/components/ui';
import { toCallableE164 } from '@/lib/phone';
import { rememberPhone } from '@/lib/storage';
import { noteConsentCall } from '@/features/consent/state';
import { DEFAULT_TIME_ZONE, TIME_ZONES } from '@/lib/time';
import { usePeople } from '@/people/PeopleContext';

export default function AddPerson() {
  const { t } = useTranslation();
  const { people, reload, select } = usePeople();
  const [isSelf, setIsSelf] = useState<boolean | undefined>(undefined);
  const [nickname, setNickname] = useState('');
  const [fullName, setFullName] = useState('');
  const [local, setLocal] = useState('');
  const [language, setLanguage] = useState<CallLanguage>('hi');
  const [timeZone, setTimeZone] = useState<string>(DEFAULT_TIME_ZONE);
  const [canReadStrip, setCanReadStrip] = useState<CanReadStrip | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const hasSelf = people.some((p) => p.isSelf);
  const atLimit = people.length >= 4;

  async function submit() {
    const e: Record<string, string> = {};
    if (isSelf === undefined) e.who = t('med.pickOne');
    if (!nickname.trim()) e.nickname = t('med.required');
    if (!fullName.trim()) e.fullName = t('med.required'); // calls greet by this name, never the nickname
    const phone = isSelf ? null : toCallableE164(local);
    if (isSelf === false && !phone) e.phone = t('signIn.invalidPhone');
    if (!canReadStrip) e.canRead = t('med.pickOne');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const { data, response } = await api.POST('/people', {
        body: {
          isSelf: !!isSelf,
          nickname: nickname.trim(),
          fullName: fullName.trim(),
          ...(phone ? { phone } : {}),
          language,
          timeZone,
          canReadStrip,
        },
      });
      if (response.status === 409) return setErrors({ form: t('person.blocked') });
      if (!response.ok || !data?.id) return setErrors({ form: t('common.error') });
      if (phone) await rememberPhone(data.id, phone);
      if (!isSelf) noteConsentCall(data.id); // the API places the consent call on create
      await reload();
      select(data.id);
      if (isSelf) router.replace({ pathname: '/person/[id]', params: { id: data.id } });
      else router.replace({ pathname: '/person/[id]/consent', params: { id: data.id } });
    } catch {
      setErrors({ form: t('common.error') });
    } finally {
      setBusy(false);
    }
  }

  if (atLimit) {
    return (
      <Screen>
        <Card>
          <AppText>{t('person.limit')}</AppText>
        </Card>
      </Screen>
    );
  }

  const self = isSelf === true;

  return (
    <Screen
      testID="add-person"
      footer={
        <>
          {errors.form ? <ErrorText>{errors.form}</ErrorText> : null}
          <Button
            title={isSelf ? t('person.submitSelf') : t('person.submit')}
            onPress={submit}
            loading={busy}
            testID="save-person"
          />
        </>
      }
    >
      <AppText variant="title">{t('person.addTitle')}</AppText>
      <Tile
        icon="👵"
        title={t('person.parent')}
        subtitle={t('person.parentHint')}
        selected={isSelf === false}
        onPress={() => setIsSelf(false)}
        testID="who-parent"
      />
      {!hasSelf ? (
        <Tile
          icon="🙋"
          title={t('person.self')}
          subtitle={t('person.selfHint')}
          selected={isSelf === true}
          onPress={() => setIsSelf(true)}
          testID="who-self"
        />
      ) : null}
      {errors.who ? <ErrorText>{errors.who}</ErrorText> : null}

      <Field
        label={t(self ? 'person.nicknameSelf' : 'person.nickname')}
        hint={t(self ? 'person.nicknameHintSelf' : 'person.nicknameHint')}
        value={nickname}
        onChangeText={setNickname}
        error={errors.nickname}
        testID="nickname"
      />
      <Field
        label={t('person.fullName')}
        hint={t(self ? 'person.fullNameHintSelf' : 'person.fullNameHint')}
        value={fullName}
        onChangeText={setFullName}
        error={errors.fullName}
        autoComplete="name"
        testID="full-name"
      />
      {isSelf === false ? (
        <>
          <Field
            label={t('person.phoneIndia')}
            hint={t('person.indiaOnly')}
            value={local}
            onChangeText={setLocal}
            keyboardType="phone-pad"
            maxLength={15}
            error={errors.phone}
            testID="person-phone"
          />
        </>
      ) : null}
      <ChipGroup
        label={t('person.language')}
        options={AVAILABLE_CALL_LANGUAGES}
        value={language}
        onChange={setLanguage}
        labelOf={(l) => t(`lang.${l}`)}
        testIDPrefix="lang"
      />
      <AppText variant="muted">{t('person.moreLanguagesSoon')}</AppText>
      <ChipGroup
        label={t(self ? 'person.timeZoneSelf' : 'person.timeZone')}
        options={TIME_ZONES}
        value={timeZone}
        onChange={setTimeZone}
        labelOf={(z) => z.replace('_', ' ')}
      />
      <ChipGroup
        label={t(self ? 'person.canReadSelf' : 'person.canRead')}
        options={['yes', 'no', 'not_sure'] as CanReadStrip[]}
        value={canReadStrip}
        onChange={setCanReadStrip}
        labelOf={(v) =>
          t(v === 'yes' ? 'person.readYes' : v === 'no' ? 'person.readNo' : 'person.readNotSure')
        }
        error={errors.canRead}
        testIDPrefix="read"
      />
      {isSelf === false ? (
        <Card>
          <AppText>
            {nickname.trim()
              ? t('person.consentNote', { name: nickname.trim() })
              : t('person.consentNoteNoName')}
          </AppText>
        </Card>
      ) : null}
    </Screen>
  );
}
