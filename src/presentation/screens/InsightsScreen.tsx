/**
 * Presentation — Insights (the map view)
 * ---------------------------------------------------------------------------
 * Frames the Habit Twin graph with zero-guilt copy: the map is presented as
 * something the user is loosening, never as a verdict. All strings from
 * i18n; empty state when the twin has no learned edges yet.
 */

import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HabitTwinGraph } from '../components/HabitTwinGraph';
import { useHabitGraph } from '../hooks/twinData';
import { palette, spacing, type } from '../theme';

export function InsightsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { nodes } = useHabitGraph();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
      <Text style={styles.title}>{t('insights.title')}</Text>
      <Text style={styles.description}>{t('insights.description')}</Text>
      {nodes.length === 0 ? (
        <Text style={styles.empty}>{t('insights.empty')}</Text>
      ) : (
        <HabitTwinGraph />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: palette.bg },
  screen: {
    flexGrow: 1,
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
  empty: {
    fontSize: type.body,
    color: palette.inkSoft,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
