/**
 * Presentation — Restart Prompt
 * ---------------------------------------------------------------------------
 * Shown when setAppLanguage() reports `requiresRestart` (layout-direction
 * change). Calm, dismissible, never blocking: "Later" keeps the new strings
 * immediately — only the mirrored layout waits for the restart.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { reloadApp } from '../../platform/restart';
import { palette, spacing, tapTarget, type } from '../theme';

export interface RestartPromptProps {
  visible: boolean;
  onDismiss: () => void;
}

export function RestartPrompt({ visible, onDismiss }: RestartPromptProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('restart.title')}</Text>
          <Text style={styles.body}>{t('restart.body')}</Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
            onPress={() => void reloadApp()}
          >
            <Text style={styles.primaryText}>{t('restart.now')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.ghost} onPress={onDismiss}>
            <Text style={styles.ghostText}>{t('restart.later')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(49, 64, 78, 0.35)', // dimmed slate, not black
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.l,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: spacing.l,
    gap: spacing.m,
  },
  title: { fontSize: type.chip, fontWeight: '600', color: palette.ink, textAlign: 'center' },
  body: { fontSize: type.body, color: palette.inkSoft, textAlign: 'center' },
  primary: {
    minHeight: tapTarget.primaryMinHeight,
    backgroundColor: palette.action,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPressed: { backgroundColor: palette.actionPressed },
  primaryText: { color: palette.actionInk, fontSize: type.body, fontWeight: '600' },
  ghost: {
    minHeight: tapTarget.chipMinHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { color: palette.inkSoft, fontSize: type.body },
});
