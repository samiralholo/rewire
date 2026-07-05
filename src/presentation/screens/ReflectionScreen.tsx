/**
 * Presentation — Evening Reflection (quiet capture)
 * ---------------------------------------------------------------------------
 * A calm end-of-day check-in: one gentle summary line, one control-rating
 * question (three calm chips), one optional free-text note. Persistence
 * goes through the core (`saveReflection`) — no logic here. All strings
 * via i18n; sided spacing via start/end for RTL.
 */

import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  computeDailySnapshot,
  saveReflection,
  type DailySnapshot,
} from '../../core/engine/insights';
import type { UnitInterval } from '../../core/types';
import { useBoot } from '../BootContext';
import { palette, spacing, tapTarget, type } from '../theme';

const CONTROL_OPTIONS: ReadonlyArray<{ labelKey: string; value: UnitInterval }> = [
  { labelKey: 'reflection.control_low', value: 0.2 },
  { labelKey: 'reflection.control_mid', value: 0.5 },
  { labelKey: 'reflection.control_high', value: 0.8 },
];

export function ReflectionScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { database, boot } = useBoot();

  const [snapshot, setSnapshot] = useState<DailySnapshot | null>(null);
  const [controlRating, setControlRating] = useState<UnitInterval | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void computeDailySnapshot(database, boot.behaviorId).then(setSnapshot);
  }, [database, boot.behaviorId]);

  const todayLine = (): string => {
    const count = snapshot?.eventCount ?? 0;
    return count === 0
      ? t('reflection.today_count_zero')
      : t('reflection.today_count', { count });
  };

  const save = (): void => {
    void saveReflection(database, {
      behaviorId: boot.behaviorId,
      controlRating,
      note: note.length > 0 ? note : null,
    }).then(() => setSaved(true));
  };

  if (saved) {
    return (
      <View style={styles.screen}>
        <Text style={styles.savedText}>{t('reflection.saved')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
      <Text style={styles.title}>{t('reflection.title')}</Text>
      <Text style={styles.description}>{t('reflection.description')}</Text>
      <Text style={styles.todayLine}>{todayLine()}</Text>

      <Text style={styles.question}>{t('reflection.question_general')}</Text>
      <View style={styles.chipRow}>
        {CONTROL_OPTIONS.map(({ labelKey, value }) => (
          <Pressable
            key={labelKey}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.chip,
              controlRating === value && styles.chipSelected,
              pressed && styles.chipPressed,
            ]}
            onPress={() => setControlRating(value)}
          >
            <Text style={styles.chipText}>{t(labelKey)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.question}>{t('reflection.question_hard_moment')}</Text>
      <TextInput
        style={styles.noteInput}
        value={note}
        onChangeText={setNote}
        placeholder={t('reflection.note_placeholder')}
        placeholderTextColor={palette.inkSoft}
        multiline
        textAlignVertical="top"
      />

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.save, pressed && styles.savePressed]}
        onPress={save}
      >
        <Text style={styles.saveText}>{t('reflection.save_note')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: palette.bg },
  screen: {
    flexGrow: 1,
    backgroundColor: palette.bg,
    padding: spacing.l,
    justifyContent: 'center',
    gap: spacing.m,
  },
  title: {
    fontSize: type.title,
    fontWeight: '600',
    color: palette.ink,
    textAlign: 'center',
  },
  description: { fontSize: type.body, color: palette.inkSoft, textAlign: 'center' },
  todayLine: { fontSize: type.body, color: palette.ink, textAlign: 'center' },
  question: {
    fontSize: type.body,
    fontWeight: '600',
    color: palette.ink,
    marginStart: spacing.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  chip: {
    minHeight: tapTarget.chipMinHeight,
    flexGrow: 1,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingStart: spacing.m,
    paddingEnd: spacing.m,
  },
  chipSelected: { borderColor: palette.action, backgroundColor: palette.affirm },
  chipPressed: { backgroundColor: palette.bg },
  chipText: { fontSize: type.body, color: palette.ink, textAlign: 'center' },
  noteInput: {
    minHeight: 120,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.m,
    fontSize: type.body,
    color: palette.ink,
    // RTL: RN aligns text to the writing direction automatically; we only
    // avoid hard 'left'/'right' here.
  },
  save: {
    minHeight: tapTarget.primaryMinHeight,
    backgroundColor: palette.action,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savePressed: { backgroundColor: palette.actionPressed },
  saveText: { color: palette.actionInk, fontSize: type.chip, fontWeight: '600' },
  savedText: {
    fontSize: type.title,
    fontWeight: '500',
    color: palette.ink,
    textAlign: 'center',
  },
});
