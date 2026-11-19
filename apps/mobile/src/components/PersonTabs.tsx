import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { usePeople } from '@/people/PeopleContext';
import { colors, radius, space, touch } from '@/theme';

/** Horizontal person switcher (Papa / Mummy / …). */
export function PersonTabs() {
  const { people, selectedId, select } = usePeople();
  if (people.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} accessibilityRole="tablist">
      {people.map((p) => {
        const sel = p.id === selectedId;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: sel }}
            accessibilityLabel={p.nickname}
            onPress={() => p.id && select(p.id)}
            style={[styles.tab, sel && styles.tabSel]}
            testID={`person-tab-${p.nickname}`}
          >
            <Text style={[styles.text, sel && styles.textSel]}>{p.nickname}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tab: {
    minHeight: touch,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { fontSize: 16, color: colors.ink, fontWeight: '600' },
  textSel: { color: colors.onPrimary },
});
