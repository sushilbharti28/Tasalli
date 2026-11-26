/**
 * First-run story: three scenes that move on by themselves (worry, the call, you'll always know),
 * with Skip. Matches docs/prototypes/onboarding-v6.html. No real names: the call shows a dashed
 * blank where the person's name goes.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { useStory } from '@/features/onboarding/StoryContext';
import {
  autoNext,
  BLANK,
  CALL,
  callDisplay,
  captionWords,
  NOTIFY_AT,
  SCENES,
  speaking,
  THOUGHT_AT,
  wordsSaid,
} from '@/features/onboarding/story';
import { radius, space, touch } from '@/theme';

/** Story palette from the prototype: deep teal ground, warm yellow highlight. Text pairs pass AA. */
const c = {
  ground: '#0F3B35',
  ink: '#FFFFFF',
  soft: '#CFE6E0',
  hi: '#FFD166',
  onHi: '#1F1A05',
  card: '#FFFFFF',
  cardInk: '#17302B',
  cardMuted: '#4E6862',
  handset: '#23302D',
  key: '#3A4A46',
  display: '#B9E4D3',
  displayInk: '#12302A',
};
const TICK = 100;

export default function Welcome() {
  const { t } = useTranslation();
  const { markSeen } = useStory();
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [stillMode, setStillMode] = useState<{ reduce: boolean; reader: boolean } | null>(null);
  const fade = useRef(new Animated.Value(1)).current;
  const scene = SCENES[index]!;
  const last = index === SCENES.length - 1;
  const reduce = stillMode?.reduce ?? false;
  // With reduced motion, every scene shows its finished state at once.
  const tNow = reduce ? Number.POSITIVE_INFINITY : elapsed;

  useEffect(() => {
    void Promise.all([
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      AccessibilityInfo.isScreenReaderEnabled().catch(() => false),
    ]).then(([r, s]) => setStillMode({ reduce: r, reader: s }));
  }, []);

  // One clock per scene; the scene moves on when its time is up.
  useEffect(() => {
    setElapsed(0);
    if (reduce) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), TICK);
    return () => clearInterval(id);
  }, [index, reduce]);

  useEffect(() => {
    const auto = stillMode !== null && !stillMode.reduce && !stillMode.reader;
    const n = autoNext(index, elapsed, auto);
    if (n !== null) goTo(n);
  }, [index, elapsed, stillMode]);

  useEffect(() => {
    if (reduce) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [index, reduce, fade]);

  function goTo(n: number) {
    setElapsed(0);
    setIndex(n);
  }
  const finish = () => void markSeen();
  const next = () => (last ? finish() : goTo(index + 1));

  return (
    <SafeAreaView style={s.screen} testID="story">
      <StatusBar style="light" />
      <View style={s.top}>
        <View
          style={s.dots}
          accessibilityRole="text"
          accessibilityLabel={t('story.sceneOf', { n: index + 1, total: SCENES.length })}
        >
          {SCENES.map((k, i) => (
            <View key={k} style={[s.dot, i === index && s.dotOn]} />
          ))}
        </View>
        {!last ? (
          <Pressable
            onPress={finish}
            accessibilityRole="button"
            style={s.skip}
            hitSlop={8}
            testID="story-skip"
          >
            <Text style={s.skipText}>{t('story.skip')}</Text>
          </Pressable>
        ) : null}
      </View>

      <Animated.View
        style={[
          s.scene,
          {
            opacity: fade,
            transform: [
              { translateX: fade.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            ],
          },
        ]}
      >
        <View style={s.stage}>
          {scene === 'worry' ? <Worry t={tNow} reduce={reduce} /> : null}
          {scene === 'call' ? <Call t={tNow} reduce={reduce} /> : null}
          {scene === 'know' ? <Know t={tNow} reduce={reduce} /> : null}
        </View>
        <View style={s.copy} accessibilityLiveRegion="polite">
          <Text style={s.title} accessibilityRole="header">
            {t(`story.${scene}.title`)}
            <Text style={{ color: c.hi }}>{t(`story.${scene}.titleHi`)}</Text>
          </Text>
          <Text style={s.sub}>{t(`story.${scene}.sub`)}</Text>
        </View>
      </Animated.View>

      <View style={s.foot}>
        <Pressable
          onPress={next}
          accessibilityRole="button"
          testID="story-next"
          style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
        >
          <Text style={s.btnText}>{last ? t('story.getStarted') : t('story.next')}</Text>
        </Pressable>
        <Text style={s.trust}>{t('story.trust')}</Text>
      </View>
    </SafeAreaView>
  );
}

/** Fades and slides a child in once `show` turns true. */
function Reveal({
  show,
  reduce,
  from = 8,
  style,
  children,
}: {
  show: boolean;
  reduce: boolean;
  from?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const v = useRef(new Animated.Value(show || reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return v.setValue(show ? 1 : 0);
    Animated.timing(v, {
      toValue: show ? 1 : 0,
      duration: 420,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
  }, [show, reduce, v]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) },
          ],
        },
      ]}
      importantForAccessibility={show ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </Animated.View>
  );
}

function Worry({ t, reduce }: { t: number; reduce: boolean }) {
  const { t: tr } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <Reveal
        show={t >= THOUGHT_AT[0]}
        reduce={reduce}
        style={[s.thought, { alignSelf: 'flex-end' }]}
      >
        <Text style={s.thoughtText}>{tr('story.worry.thought1')}</Text>
      </Reveal>
      <View style={{ alignItems: 'center' }}>
        <Text style={s.clock}>{tr('story.worry.clock')}</Text>
        <Text style={s.clockNote}>{tr('story.worry.clockNote')}</Text>
      </View>
      <Reveal
        show={t >= THOUGHT_AT[1]}
        reduce={reduce}
        style={[s.thought, { alignSelf: 'flex-start', maxWidth: '66%' }]}
      >
        <Text style={s.thoughtText}>{tr('story.worry.thought2')}</Text>
      </Reveal>
    </View>
  );
}

function Call({ t, reduce }: { t: number; reduce: boolean }) {
  const { t: tr } = useTranslation();
  const display = callDisplay(t);
  const first = speaking(CALL.tasalli, t);
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) return;
    const wiggle = Animated.sequence([
      Animated.timing(ring, { toValue: 1, duration: 110, useNativeDriver: true }),
      Animated.timing(ring, { toValue: -1, duration: 220, useNativeDriver: true }),
      Animated.timing(ring, { toValue: 0, duration: 120, useNativeDriver: true }),
    ]);
    Animated.loop(wiggle, { iterations: 4 }).start();
  }, [reduce, ring]);

  return (
    <View style={{ flex: 1 }} accessible accessibilityLabel={tr('story.call.a11y')}>
      <Text style={s.whose}>{tr('story.call.whose')}</Text>
      <View style={s.handsetWrap}>
        <Waves active={first === 'talking'} reduce={reduce} />
        <Animated.View
          style={[
            s.handset,
            {
              transform: [
                {
                  rotate: ring.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }),
                },
              ],
            },
          ]}
        >
          <View style={s.disp}>
            <Text style={s.dispText}>
              {display.state === 'calling'
                ? `📞 ${tr('story.call.calling')}`
                : tr('story.call.onCall', { time: display.time })}
            </Text>
          </View>
          <View style={s.keys}>
            {[0, 1, 2, 3, 4, 5].map((k) => (
              <View key={k} style={s.key} />
            ))}
          </View>
        </Animated.View>
      </View>
      <View style={{ gap: space.md }}>
        <Voice
          who={tr('story.call.tasalli')}
          text={tr('story.call.say')}
          meaning={tr('story.call.sayMeaning')}
          line={CALL.tasalli}
          t={t}
          reduce={reduce}
        />
        <Voice
          who={tr('story.call.papa')}
          text={tr('story.call.reply')}
          meaning={tr('story.call.replyMeaning')}
          line={CALL.reply}
          t={t}
          reduce={reduce}
          them
        />
      </View>
    </View>
  );
}

function Voice({
  who,
  text,
  meaning,
  line,
  t,
  reduce,
  them,
}: {
  who: string;
  text: string;
  meaning: string;
  line: { start: number; dur: number };
  t: number;
  reduce: boolean;
  them?: boolean;
}) {
  const { t: tr } = useTranslation();
  const words = captionWords(text);
  const said = wordsSaid(words.length, line, t);
  const state = speaking(line, t);
  const align = them ? 'flex-end' : 'flex-start';
  return (
    <View style={{ alignItems: align, gap: space.xs }}>
      <View style={[s.spk, them && { flexDirection: 'row-reverse' }]}>
        <Bars active={state === 'talking'} reduce={reduce} />
        <Text style={s.spkText}>{who}</Text>
      </View>
      <View style={[s.cap, { justifyContent: align }]}>
        {words.map((w, k) => {
          const style = { opacity: k < said ? 1 : 0.18 };
          return w.startsWith(BLANK) ? (
            <View key={k} style={[s.blank, style]}>
              <Text style={s.blankText}>{tr('story.call.blank')}</Text>
            </View>
          ) : (
            <Text key={k} style={[s.capText, style]}>
              {w}
            </Text>
          );
        })}
      </View>
      {meaning ? (
        <Text
          style={[
            s.meaning,
            { opacity: state === 'done' ? 1 : 0, textAlign: them ? 'right' : 'left' },
          ]}
        >
          {meaning}
        </Text>
      ) : null}
    </View>
  );
}

/** Five small bars that bounce while someone is speaking. */
function Bars({ active, reduce }: { active: boolean; reduce: boolean }) {
  const vals = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!active || reduce) {
      vals.forEach((v) => v.setValue(0));
      return;
    }
    const loops = vals.map((v, k) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay([0, 100, 250, 50, 180][k]!),
          Animated.timing(v, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, reduce, vals]);
  return (
    <View style={s.bars}>
      {vals.map((v, k) => (
        <Animated.View
          key={k}
          style={[
            s.bar,
            {
              transform: [{ scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [1, 3.5] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

/** Sound waves around the handset while Tasalli speaks. */
function Waves({ active, reduce }: { active: boolean; reduce: boolean }) {
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    vals.forEach((v) => v.setValue(0));
    if (!active || reduce) return;
    const loops = vals.map((v, k) =>
      Animated.sequence([
        Animated.delay(k * 530),
        Animated.loop(
          Animated.timing(v, {
            toValue: 1,
            duration: 1600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ),
      ]),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, reduce, vals]);
  return (
    <>
      {vals.map((v, k) => (
        <Animated.View
          key={k}
          pointerEvents="none"
          style={[
            s.wave,
            {
              opacity: v.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.8, 0] }),
              transform: [
                { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) },
              ],
            },
          ]}
        />
      ))}
    </>
  );
}

function Know({ t, reduce }: { t: number; reduce: boolean }) {
  const { t: tr } = useTranslation();
  const items = [
    {
      icon: '✓',
      bg: '#D9F6E9',
      fg: '#127A4A',
      title: tr('story.know.n1'),
      sub: tr('story.know.n1Sub'),
    },
    {
      icon: '☎',
      bg: '#E3EEFC',
      fg: '#2A5BB8',
      title: tr('story.know.n2'),
      sub: tr('story.know.n2Sub'),
    },
    {
      icon: '!',
      bg: '#FFECD6',
      fg: '#A35A00',
      title: tr('story.know.n3'),
      sub: tr('story.know.n3Sub'),
    },
  ];
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: space.sm + 2 }}>
      <Text style={s.lockTime}>{tr('story.know.time')}</Text>
      {items.map((n, k) => (
        <Reveal key={k} show={t >= NOTIFY_AT[k]!} reduce={reduce} from={-16} style={s.push}>
          <View style={[s.ic, { backgroundColor: n.bg }]}>
            <Text style={{ color: n.fg, fontWeight: '700' }}>{n.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.pushTitle}>{n.title}</Text>
            <Text style={s.pushSub}>{n.sub}</Text>
          </View>
        </Reveal>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: space.lg,
    minHeight: touch,
  },
  dots: { flex: 1, flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotOn: { width: 20, backgroundColor: c.hi },
  skip: { minHeight: touch, minWidth: touch, justifyContent: 'center', alignItems: 'flex-end' },
  skipText: { color: c.soft, fontSize: 15, fontWeight: '500' },
  scene: { flex: 1, paddingHorizontal: 22, paddingTop: space.sm, gap: space.md },
  stage: { flex: 1, minHeight: 0 },
  copy: { gap: 6 },
  title: { color: c.ink, fontSize: 28, lineHeight: 33, fontWeight: '700' },
  sub: { color: c.soft, fontSize: 15, lineHeight: 21 },
  foot: { paddingHorizontal: 22, paddingTop: space.lg, paddingBottom: space.xl, gap: space.sm },
  btn: {
    backgroundColor: c.hi,
    borderRadius: radius.lg,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: c.onHi, fontSize: 17, fontWeight: '600' },
  trust: { color: c.soft, fontSize: 12, textAlign: 'center' },
  // worry
  thought: {
    maxWidth: '72%',
    backgroundColor: c.card,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    elevation: 6,
  },
  thoughtText: { color: c.cardInk, fontSize: 16, lineHeight: 22 },
  clock: { color: c.ink, fontSize: 52, fontWeight: '700' },
  clockNote: { color: c.soft, fontSize: 14, marginTop: 6 },
  // call
  whose: { color: c.soft, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  handsetWrap: { alignItems: 'center', justifyContent: 'center', height: 150 },
  handset: {
    width: 116,
    backgroundColor: c.handset,
    borderRadius: 20,
    paddingVertical: 11,
    paddingHorizontal: 9,
    gap: 7,
    alignItems: 'center',
    elevation: 8,
  },
  disp: {
    width: '100%',
    backgroundColor: c.display,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 4,
  },
  dispText: {
    color: c.displayInk,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    width: '100%',
    justifyContent: 'space-between',
  },
  key: { width: '30%', height: 10, borderRadius: 5, backgroundColor: c.key },
  wave: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: c.hi,
  },
  spk: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  spkText: {
    color: c.soft,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 14 },
  bar: { width: 3, height: 4, borderRadius: 2, backgroundColor: c.hi },
  cap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 5, rowGap: 2, alignItems: 'center' },
  capText: { color: c.ink, fontSize: 17, lineHeight: 26, fontWeight: '500' },
  blank: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.hi,
    borderRadius: 6,
    paddingHorizontal: 6,
  },
  blankText: { color: c.hi, fontSize: 14, lineHeight: 22 },
  meaning: { color: c.soft, fontSize: 13 },
  // know
  lockTime: {
    color: c.soft,
    fontSize: 40,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 6,
  },
  push: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.card,
    borderRadius: radius.lg,
    paddingVertical: 11,
    paddingHorizontal: 13,
    elevation: 6,
  },
  ic: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pushTitle: { color: c.cardInk, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  pushSub: { color: c.cardMuted, fontSize: 13 },
});
