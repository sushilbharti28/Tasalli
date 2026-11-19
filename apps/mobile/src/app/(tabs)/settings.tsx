import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api, isMockApi } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { AppText, Button, Card, ChipGroup, Screen, Toggle } from '@/components/ui';
import { setAppLocale, type AppLocale } from '@/i18n';
import { forgetPerson } from '@/lib/storage';
import { usePeople } from '@/people/PeopleContext';
import { space } from '@/theme';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { signOut } = useAuth();
  const { people, reload } = usePeople();
  const [note, setNote] = useState('');

  async function testCall() {
    const { response } = await api.POST('/test-call');
    setNote(response.status === 429 ? t('settings.testCallCap') : response.ok ? t('settings.testCallSent') : t('common.error'));
  }

  async function setPaused(id: string, paused: boolean) {
    await api.PATCH('/people/{personId}', { params: { path: { personId: id } }, body: { paused } });
    await reload();
  }

  function confirmDelete(id: string, name: string) {
    Alert.alert(t('settings.deletePerson', { name }), t('settings.deleteConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.delete'),
        style: 'destructive',
        onPress: async () => {
          await api.DELETE('/people/{personId}', { params: { path: { personId: id } } });
          await forgetPerson(id);
          await reload();
        },
      },
    ]);
  }

  return (
    <Screen testID="settings">
      <Card>
        <Button title={t('settings.testCall')} onPress={() => void testCall()} testID="test-call" />
        <AppText variant="muted">{t('settings.testCallHint')}</AppText>
        {note ? <AppText style={{ fontWeight: '600' }}>{note}</AppText> : null}
      </Card>
      <ChipGroup<AppLocale>
        label={t('settings.appLanguage')}
        options={['en', 'hi']}
        value={(i18n.language === 'hi' ? 'hi' : 'en') as AppLocale}
        onChange={(l) => void setAppLocale(l)}
        labelOf={(l) => t(`lang.${l}`)}
        testIDPrefix="applang"
      />
      <AppText variant="label">{t('settings.people')}</AppText>
      <View style={{ gap: space.md }}>
        {people.map((p) => (
          <Card key={p.id}>
            <AppText style={{ fontWeight: '700' }}>{p.nickname}</AppText>
            <Toggle label={t('settings.pause', { name: p.nickname })} hint={t('settings.pauseHint')} value={!!p.paused} onChange={(v) => void setPaused(p.id!, v)} testID={`pause-${p.nickname}`} />
            <Button kind="danger" title={t('settings.deletePerson', { name: p.nickname })} onPress={() => confirmDelete(p.id!, p.nickname ?? '')} />
          </Card>
        ))}
      </View>
      <Button kind="secondary" title={t('settings.signOut')} onPress={() => void signOut()} />
      <AppText variant="muted">{t('settings.privacy')}</AppText>
      {isMockApi ? <AppText variant="small">{t('common.mockBanner')}</AppText> : null}
    </Screen>
  );
}
