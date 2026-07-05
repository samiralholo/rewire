/**
 * Presentation — Dashboard (the zero-guilt home)
 * ---------------------------------------------------------------------------
 * Two jobs only: show growth (Awareness Score — never streaks, never
 * failure counts) and provide the massive, always-there entry point into
 * the interception flow. All strings via i18n keys; all sided styles via
 * start/end so the Arabic RTL flip is automatic.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  computeAwarenessScore,
  computeDailySnapshot,
  type DailySnapshot,
} from '../../core/engine/insights';
import { sendCravingEvent } from '../../state/uiStore';
import { useBoot } from '../BootContext';
import { setAppLanguage, type AppLanguage } from '../../i18n';
import { persistLanguage } from '../../i18n/localeBootstrap';
import { RestartPrompt } from '../components/RestartPrompt';
import { palette, spacing, tapTarget, type } from '../theme';

const MIN_EVENTS_FOR_INSIGHT = 5;

export function DashboardScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { database, boot } = useBoot();

  const [awareness, setAwareness] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<DailySnapshot | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);

  const refresh = useCallback(() => {
    void computeAwarenessScore(database, boot.behaviorId).then(setAwareness);
    void computeDailySnapshot(database, boot.behaviorId).then(setSnapshot);
  }, [database, boot.behaviorId]);

  useEffect(refresh, [refresh]);

  const insightText = (): string => {
    if (snapshot === null) return t('dashboard.insight_preparing');
    if (snapshot.eventCount === 0) return t('dashboard.insight_empty');
    if (snapshot.eventCount < MIN_EVENTS_FOR_INSIGHT || !snapshot.topTriggerLabelKey) {
      return t('dashboard.insight_preparing');
    }
    return t('dashboard.insight_top_trigger', {
      trigger: t(snapshot.topTriggerLabelKey, { ns: 'domain', defaultValue: snapshot.topTriggerLabelKey }),
    });
  };

  const toggleLanguage = (): void => {
    const next: AppLanguage = i18n.language === 'ar' ? 'en' : 'ar';
    void (async () => {
      const { requiresRestart } = await setAppLanguage(next);
      await persistLanguage(database, next);
      // Strings switch immediately; only the mirrored layout needs a restart.
      if (requiresRestart) setRestartNeeded(true);
    })();
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.greeting}>{t('dashboard.greeting')}</Text>

      <View style={styles.scoreCard}>
        <Text style={styles.scoreLabel}>{t('dashboard.awareness_score')}</Text>
        <Text style={styles.scoreValue}>
          {awareness === null ? '—' : Math.round(awareness * 100)}
        </Text>
        <Text style={styles.scoreCaption}>{t('dashboard.awareness_caption')}</Text>
      </View>

      <Text style={styles.insight}>{insightText()}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('dashboard.craving_button')}
        style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
        onPress={() => sendCravingEvent({ type: 'CRAVING_STARTED', intensity: 0.6 })}
      >
        <Text style={styles.heroText}>{t('dashboard.craving_button')}</Text>
      </Pressable>

      <Pressable style={styles.langButton} onPress={toggleLanguage}>
        <Text style={styles.langText}>{t('dashboard.language_toggle')}</Text>
      </Pressable>

      <RestartPrompt visible={restartNeeded} onDismiss={() => setRestartNeeded(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
    padding: spacing.l,
    justifyContent: 'center',
    gap: spacing.l,
  },
  greeting: {
    fontSize: type.title,
    fontWeight: '600',
    color: palette.ink,
    textAlign: 'center',
  },
  scoreCard: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.l,
    paddingStart: spacing.l,
    paddingEnd: spacing.l,
    alignItems: 'center',
    gap: spacing.s,
  },
  scoreLabel: { fontSize: type.body, color: palette.inkSoft },
  scoreValue: { fontSize: 64, fontWeight: '300', color: palette.ink },
  scoreCaption: { fontSize: 14, color: palette.inkSoft, textAlign: 'center' },
  insight: { fontSize: type.body, color: palette.inkSoft, textAlign: 'center' },
  hero: {
    minHeight: tapTarget.heroMinHeight,
    backgroundColor: palette.action,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingStart: spacing.l,
    paddingEnd: spacing.l,
  },
  heroPressed: { backgroundColor: palette.actionPressed },
  heroText: { color: palette.actionInk, fontSize: type.chip, fontWeight: '600' },
  langButton: {
    minHeight: tapTarget.chipMinHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langText: { fontSize: type.body, color: palette.action },
});
