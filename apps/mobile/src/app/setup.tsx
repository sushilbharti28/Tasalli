/**
 * Setup questions after sign-in, one per screen (Phase 2, step 2; docs/prototypes/onboarding-v6.html).
 * Opens instead of the tabs while the account has nobody added. Who -> name -> call language -> medicine times,
 * then: yourself is saved and opens your first medicine; a loved one asks for their number, which places the
 * consent call (safety rule 3: no reminder call before they agree).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import type { CallLanguage, CallLanguageInfo } from '@/api/types';
import { noteConsentCall } from '@/features/consent/state';
import { onboarding as c } from '@/features/onboarding/palette';
import {
  ANY_TIME,
  badSlots,
  canContinue,
  clearDraft,
  loadDraft,
  MAX_TIMES,
  nextExtraId,
  PAIRS,
  personBody,
  RELATIONS,
  rememberTimes,
  saveDraft,
  setAfterSetup,
  slotOf,
  STEP_MINUTES,
  stepsFor,
  timeCount,
  timeProblems,
  windowOf,
  type Food,
  type Question,
  type SetupDraft,
  type SlotKey,
} from '@/features/onboarding/setup';
import { canStep, stepTime, type MealWindow } from '@/lib/meals';
import { COUNTRY_CODES, toE164 } from '@/lib/phone';
import { rememberPhone } from '@/lib/storage';
import { displayHhmm } from '@/lib/time';
import { usePeople } from '@/people/PeopleContext';
import { radius, space, touch } from '@/theme';

/** Used when GET /call-languages can't be reached: Hindi is the only language calls can use today. */
const FALLBACK_LANGUAGES: CallLanguageInfo[] = [
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', status: 'available' },
];

export default function Setup() {
  const { t } = useTranslation();
  const { reload, select } = usePeople();
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [languages, setLanguages] = useState<CallLanguageInfo[]>(FALLBACK_LANGUAGES);
  const [cc, setCc] = useState('+91');
  const [local, setLocal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadDraft().then(setDraft);
    void api
      .GET('/call-languages')
      .then(({ data, response }) => {
        if (response.ok && Array.isArray(data) && data.length) setLanguages(data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (draft) void saveDraft(draft);
  }, [draft]);

  if (!draft) return <SafeAreaView style={s.screen} />;

  const steps = stepsFor(draft.who);
  const step: Question = steps.includes(draft.step) ? draft.step : 'who';
  const index = steps.indexOf(step);
  const loved = draft.who !== 'me';
  const firstName = draft.name.trim().split(/\s+/)[0] ?? '';
  const label = draft.rel ? t(`setup.rel.${draft.rel}`) : t('setup.ji', { name: firstName });
  const update = (patch: Partial<SetupDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const goTo = (q: Question) => {
    setError(null);
    update({ step: q });
  };
  const back = () => index > 0 && goTo(steps[index - 1]!);
  const phone = toE164(cc, local);
  const lastForSelf = !loved && step === 'when';

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body = personBody(
        draft,
        draft.rel ? t(`setup.rel.${draft.rel}`) : null,
        phone ?? undefined,
      );
      const { data, response } = await api.POST('/people', { body });
      if (response.status === 409) return setError(t('person.blocked'));
      if (!response.ok || !data?.id) return setError(t('common.error'));
      await rememberTimes(data.id, draft);
      if (body.phone) {
        await rememberPhone(data.id, body.phone);
        noteConsentCall(data.id); // the API places the consent call on create
      }
      await clearDraft();
      setAfterSetup(
        body.isSelf
          ? { pathname: '/person/[id]', params: { id: data.id } }
          : { pathname: '/person/[id]/consent', params: { id: data.id } },
      );
      select(data.id);
      await reload(); // the account now has someone: the navigator leaves setup
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (!draft) return;
    if (lastForSelf || step === 'phone') return void save();
    goTo(steps[index + 1]!);
  }

  const ready = step === 'phone' ? !!phone : canContinue(draft, step);
  const nextTitle = lastForSelf
    ? t('setup.saveSelf')
    : step === 'phone'
      ? t('setup.phone.submit', { label })
      : t('setup.next');

  return (
    <SafeAreaView style={s.screen} testID="setup">
      <StatusBar style="light" />
      <View style={s.top}>
        {index > 0 ? (
          <Pressable
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel={t('setup.back')}
            style={s.backBtn}
            hitSlop={8}
            testID="setup-back"
          >
            <Text style={s.backText}>←</Text>
          </Pressable>
        ) : (
          <View style={s.backBtn} />
        )}
        <View
          style={s.track}
          accessibilityRole="progressbar"
          accessibilityLabel={t('setup.progress', { n: index + 1, total: steps.length })}
          accessibilityValue={{ min: 0, max: steps.length, now: index + 1 }}
        >
          <View style={[s.fill, { width: `${((index + 1) / steps.length) * 100}%` }]} />
        </View>
      </View>

      <ScrollView key={step} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {step === 'who' ? (
          <>
            <Guide text={t('setup.who.say')} />
            <Title text={t('setup.who.q')} />
            <Option
              icon="👵"
              title={t('setup.who.loved')}
              sub={t('setup.who.lovedSub')}
              picked={draft.who === 'loved'}
              onPress={() => {
                update({ who: 'loved', step: 'name' });
              }}
              testID="who-loved"
            />
            <Option
              icon="🙂"
              title={t('setup.who.me')}
              sub={t('setup.who.meSub')}
              picked={draft.who === 'me'}
              onPress={() => update({ who: 'me', rel: null, step: 'name' })}
              testID="who-me"
            />
            <Text style={s.hint}>{t('setup.who.hint')}</Text>
          </>
        ) : null}

        {step === 'name' ? (
          <>
            <Guide text={t(loved ? 'setup.name.sayLoved' : 'setup.name.saySelf')} />
            <Title text={t(loved ? 'setup.name.qLoved' : 'setup.name.qSelf')} />
            <View style={s.field}>
              <Text style={s.label} nativeID="name-label">
                {t(loved ? 'setup.name.labelLoved' : 'setup.name.labelSelf')}
              </Text>
              <TextInput
                value={draft.name}
                onChangeText={(name) => update({ name })}
                placeholder={t(
                  loved ? 'setup.name.placeholderLoved' : 'setup.name.placeholderSelf',
                )}
                placeholderTextColor="rgba(255,255,255,0.45)"
                maxLength={80}
                autoComplete="name"
                autoCapitalize="words"
                returnKeyType="next"
                onSubmitEditing={() => ready && next()}
                accessibilityLabelledBy="name-label"
                accessibilityLabel={t(loved ? 'setup.name.labelLoved' : 'setup.name.labelSelf')}
                style={s.input}
                testID="setup-name"
              />
            </View>
            {loved ? (
              <View style={s.field}>
                <Text style={s.label}>{t('setup.name.relLabel')}</Text>
                <View style={s.chips}>
                  {RELATIONS.map((r) => (
                    <Pill
                      key={r}
                      text={t(`setup.rel.${r}`)}
                      picked={draft.rel === r}
                      onPress={() => update({ rel: draft.rel === r ? null : r })}
                      testID={`rel-${r}`}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        {step === 'lang' ? (
          <>
            <Guide text={t(loved ? 'setup.lang.sayLoved' : 'setup.lang.saySelf')} />
            <Title text={loved ? t('setup.lang.qLoved', { label }) : t('setup.lang.qSelf')} />
            <View style={s.langs}>
              {languages.map((l) => {
                const open = l.status === 'available';
                const picked = draft.lang === l.code;
                return (
                  <Pressable
                    key={l.code}
                    disabled={!open}
                    onPress={() => update({ lang: l.code as CallLanguage })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: picked, disabled: !open }}
                    accessibilityLabel={
                      open ? l.englishName : `${l.englishName}, ${t('setup.lang.soon')}`
                    }
                    style={[s.lang, picked && s.picked, !open && { opacity: 0.4 }]}
                    testID={`lang-${l.code}`}
                  >
                    <Text style={s.langName}>
                      {l.nativeName}
                      {picked ? '  ✓' : ''}
                    </Text>
                    <Text style={s.langSub}>
                      {open
                        ? l.nativeName === l.englishName
                          ? ''
                          : l.englishName
                        : l.nativeName === l.englishName
                          ? t('setup.lang.soon')
                          : `${l.englishName} · ${t('setup.lang.soon')}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.hint}>{t('setup.lang.hint')}</Text>
          </>
        ) : null}

        {step === 'when' ? (
          <When draft={draft} label={label} loved={loved} update={update} />
        ) : null}

        {step === 'phone' ? (
          <>
            <Guide text={t('setup.phone.say', { label })} />
            <Title text={t('setup.phone.q', { label })} />
            <View style={s.chips}>
              {COUNTRY_CODES.map((x) => (
                <Pill
                  key={x.code}
                  text={x.code}
                  a11y={`${x.label} ${x.code}`}
                  picked={cc === x.code}
                  onPress={() => setCc(x.code)}
                />
              ))}
            </View>
            <View style={s.field}>
              <Text style={s.label}>{t('person.phone')}</Text>
              <TextInput
                value={local}
                onChangeText={setLocal}
                keyboardType="phone-pad"
                maxLength={15}
                accessibilityLabel={t('person.phone')}
                style={s.input}
                testID="setup-phone"
              />
            </View>
            <Text style={s.hint}>{t('person.consentNote', { name: label })}</Text>
          </>
        ) : null}
      </ScrollView>

      <View style={s.foot}>
        {error ? (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {step !== 'who' ? (
          <Pressable
            onPress={next}
            disabled={!ready || busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready || busy, busy }}
            style={({ pressed }) => [
              s.btn,
              (!ready || busy) && { opacity: 0.4 },
              pressed && { opacity: 0.85 },
            ]}
            testID="setup-next"
          >
            <Text style={s.btnText}>{nextTitle}</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function When({
  draft,
  label,
  loved,
  update,
}: {
  draft: SetupDraft;
  label: string;
  loved: boolean;
  update: (p: Partial<SetupDraft>) => void;
}) {
  const { t } = useTranslation();
  const full = timeCount(draft) >= MAX_TIMES;
  const bad = badSlots(draft);
  const problems = timeProblems(draft);
  const toggle = (k: SlotKey) => {
    const slots = { ...draft.slots };
    if (slots[k] !== undefined) delete slots[k];
    else slots[k] = slotOf(k).defaultTime;
    update({ slots });
  };
  const setSlot = (k: SlotKey, v: string) => update({ slots: { ...draft.slots, [k]: v } });
  const meals: { meal: 'breakfast' | 'lunch' | 'dinner' | 'bedtime'; keys: SlotKey[] }[] = [
    ...PAIRS.map(([b, a, meal]) => ({ meal, keys: [b, a] })),
    { meal: 'bedtime', keys: ['bt'] },
  ];

  return (
    <>
      <Guide text={t('setup.when.say')} />
      <Title text={loved ? t('setup.when.qLoved', { label }) : t('setup.when.qSelf')} />
      {meals.map(({ meal, keys }) => (
        <View key={meal} style={s.meal}>
          <Text style={s.mealName}>{t(`setup.meal.${meal}`)}</Text>
          <View style={s.mealBtns}>
            {keys.map((k) => {
              const on = draft.slots[k] !== undefined;
              const text =
                meal === 'bedtime'
                  ? t('setup.when.atBedtime')
                  : t(slotOf(k).food === 'before' ? 'setup.when.before' : 'setup.when.after');
              return (
                <Pressable
                  key={k}
                  onPress={() => toggle(k)}
                  disabled={full && !on}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: full && !on }}
                  accessibilityLabel={t(`setup.slot.${k}`)}
                  style={[s.slotBtn, on && s.picked, full && !on && { opacity: 0.35 }]}
                  testID={`slot-${k}`}
                >
                  <Text style={s.slotText}>
                    {on ? '✓ ' : ''}
                    {text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {keys
            .filter((k) => draft.slots[k] !== undefined)
            .map((k) => (
              <TimeStepper
                key={k}
                what={t(`setup.slot.${k}`)}
                value={draft.slots[k]!}
                window={windowOf(k)}
                bad={bad.has(k)}
                onChange={(v) => setSlot(k, v)}
                testID={`time-${k}`}
              />
            ))}
        </View>
      ))}

      {draft.extra.map((x) => (
        <View key={x.id} style={s.meal}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[s.mealName, { flex: 1 }]}>{t('setup.when.other')}</Text>
            <Pressable
              onPress={() => update({ extra: draft.extra.filter((y) => y.id !== x.id) })}
              accessibilityRole="button"
              accessibilityLabel={t('setup.when.remove', { time: displayHhmm(x.time) })}
              style={s.remove}
              testID={`extra-remove-${x.id}`}
            >
              <Text style={s.removeText}>✕</Text>
            </Pressable>
          </View>
          <TimeStepper
            what={t('setup.when.other')}
            value={x.time}
            window={ANY_TIME}
            onChange={(v) =>
              update({ extra: draft.extra.map((y) => (y.id === x.id ? { ...y, time: v } : y)) })
            }
            testID={`extra-time-${x.id}`}
          />
          <View
            style={s.chips}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('setup.when.foodLabel', { time: displayHhmm(x.time) })}
          >
            {(['before', 'after', 'any'] as Food[]).map((f) => (
              <Pill
                key={f}
                text={t(`setup.food.${f}`)}
                picked={x.food === f}
                role="radio"
                onPress={() =>
                  update({ extra: draft.extra.map((y) => (y.id === x.id ? { ...y, food: f } : y)) })
                }
                testID={`extra-food-${x.id}-${f}`}
              />
            ))}
          </View>
        </View>
      ))}

      <Pressable
        onPress={() =>
          update({
            extra: [
              ...draft.extra,
              { id: nextExtraId(draft.extra), time: '06:00', food: 'before' },
            ],
          })
        }
        disabled={full}
        accessibilityRole="button"
        accessibilityState={{ disabled: full }}
        style={[s.addTime, full && { opacity: 0.35 }]}
        testID="add-time"
      >
        <Text style={s.addTimeText}>{t('setup.when.addTime')}</Text>
      </Pressable>
      {problems[0] ? (
        <Text style={s.warn} accessibilityRole="alert" testID="time-problem">
          {t(`setup.when.${problems[0].kind}.${problems[0].meal}`)}
        </Text>
      ) : null}
      {full ? (
        <Text style={s.warn} testID="time-cap">
          {t('setup.when.cap')}
        </Text>
      ) : null}
    </>
  );
}

/** Earlier / later in 15-minute steps; never leaves its window, so the picked time is always one the API accepts. */
function TimeStepper({
  what,
  value,
  window,
  bad,
  onChange,
  testID,
}: {
  what: string;
  value: string;
  window: MealWindow;
  bad?: boolean;
  onChange: (v: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const btn = (delta: number, sign: string, key: 'setup.when.earlier' | 'setup.when.later') => {
    const ok = canStep(window, value, delta);
    return (
      <Pressable
        onPress={() => onChange(stepTime(window, value, delta))}
        disabled={!ok}
        accessibilityRole="button"
        accessibilityLabel={t(key, { what })}
        accessibilityState={{ disabled: !ok }}
        style={[s.stepBtn, !ok && { opacity: 0.35 }]}
        hitSlop={4}
        testID={testID ? `${testID}-${delta < 0 ? 'down' : 'up'}` : undefined}
      >
        <Text style={s.stepText}>{sign}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[s.stepper, bad && s.stepperBad]}>
      <Text style={s.stepWhat} numberOfLines={1}>
        {what}
      </Text>
      {btn(-STEP_MINUTES, '−', 'setup.when.earlier')}
      <Text
        style={s.stepTime}
        accessibilityLabel={`${what}, ${displayHhmm(value)}`}
        accessibilityLiveRegion="polite"
        testID={testID}
      >
        {displayHhmm(value)}
      </Text>
      {btn(STEP_MINUTES, '+', 'setup.when.later')}
    </View>
  );
}

function Guide({ text }: { text: string }) {
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

function Title({ text }: { text: string }) {
  return (
    <Text style={s.q} accessibilityRole="header">
      {text}
    </Text>
  );
}

function Option({
  icon,
  title,
  sub,
  picked,
  onPress,
  testID,
}: {
  icon: string;
  title: string;
  sub: string;
  picked: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: picked }}
      accessibilityLabel={`${title}. ${sub}`}
      style={[s.opt, picked && s.picked]}
      testID={testID}
    >
      <View style={s.av}>
        <Text style={{ fontSize: 22 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.optTitle}>{title}</Text>
        <Text style={s.optSub}>{sub}</Text>
      </View>
      {picked ? <Text style={s.check}>✓</Text> : null}
    </Pressable>
  );
}

function Pill({
  text,
  a11y,
  picked,
  onPress,
  role = 'button',
  testID,
}: {
  text: string;
  a11y?: string;
  picked: boolean;
  onPress: () => void;
  role?: 'button' | 'radio';
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { checked: picked } : { selected: picked }}
      accessibilityLabel={a11y ?? text}
      style={[s.chip, picked && s.picked]}
      testID={testID}
    >
      <Text style={s.chipText}>
        {picked ? '✓ ' : ''}
        {text}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: 14,
    paddingTop: space.md,
  },
  backBtn: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  backText: { color: c.ink, fontSize: 22 },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginRight: space.lg,
  },
  fill: { height: 6, borderRadius: 3, backgroundColor: c.hi },
  body: { paddingHorizontal: 22, paddingTop: space.md, paddingBottom: space.xl, gap: space.md },
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
  picked: { borderColor: c.hi, backgroundColor: c.picked },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 72,
    backgroundColor: c.surface,
    borderWidth: 2,
    borderColor: c.line,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  av: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optTitle: { color: c.ink, fontSize: 17, fontWeight: '600' },
  optSub: { color: c.soft, fontSize: 14 },
  check: { color: c.hi, fontSize: 18, fontWeight: '700' },
  field: { gap: 6 },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: touch,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: c.line,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
  },
  chipText: { color: c.ink, fontSize: 15, fontWeight: '500' },
  langs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  lang: {
    width: '47%',
    flexGrow: 1,
    minHeight: 64,
    borderWidth: 2,
    borderColor: c.line,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    padding: 12,
    gap: 2,
  },
  langName: { color: c.ink, fontSize: 19, fontWeight: '600' },
  langSub: { color: c.soft, fontSize: 13 },
  meal: { gap: space.sm, paddingVertical: space.xs },
  mealName: { color: c.ink, fontSize: 16, fontWeight: '600' },
  mealBtns: { flexDirection: 'row', gap: space.sm },
  slotBtn: {
    flex: 1,
    minHeight: touch,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: c.line,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingHorizontal: 6,
  },
  slotText: { color: c.ink, fontSize: 15, fontWeight: '600' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderColor: c.hi,
    backgroundColor: 'rgba(255,209,102,0.08)',
    borderRadius: radius.md,
    paddingLeft: 12,
    paddingRight: 4,
  },
  stepperBad: { borderColor: c.warn, backgroundColor: 'rgba(255,176,84,0.12)' },
  stepWhat: { flex: 1, color: c.soft, fontSize: 14 },
  stepBtn: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: c.hi, fontSize: 24, fontWeight: '700' },
  stepTime: {
    minWidth: 82,
    textAlign: 'center',
    color: c.ink,
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  remove: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: c.soft, fontSize: 18 },
  addTime: {
    alignSelf: 'flex-start',
    minHeight: touch,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  addTimeText: { color: c.ink, fontSize: 15, fontWeight: '500' },
  warn: { color: c.warn, fontSize: 14, lineHeight: 20 },
  foot: { paddingHorizontal: 22, paddingTop: space.md, paddingBottom: space.xl, gap: space.sm },
  error: { color: c.warn, fontSize: 14 },
  btn: {
    backgroundColor: c.hi,
    borderRadius: radius.lg,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: c.onHi, fontSize: 17, fontWeight: '600' },
});
