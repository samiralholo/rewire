/**
 * App Root — splash-gated engine bootstrap + phase-driven routing.
 * ---------------------------------------------------------------------------
 * Composition root: the ONE place where the agnostic core meets a concrete
 * domain. It initializes i18n (with the pack's vocabulary), injects the
 * database, the active DomainPack, and the presentation binder into
 * `bootstrap()`, renders a calm splash until the ready-state Promise
 * settles, then routes:
 *
 *   machine idle           -> Dashboard / Reflection (simple two-tab shell)
 *   machine anything else  -> InterceptorScreen (owns the whole viewport)
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { database } from './core/db/database';
import { bootstrap, type BootResult } from './core/boot/bootstrap';
import { SmokingPackage, SMOKING_PACK_ID } from './packages/smoking';
import { bindCravingActor, useInterceptorPhase } from './state/uiStore';
import { initI18n, registerDomainVocabulary } from './i18n';
import { bootstrapLocale } from './i18n/localeBootstrap';
import { BootProvider } from './presentation/BootContext';
import { DashboardScreen } from './presentation/screens/DashboardScreen';
import { InterceptorScreen } from './presentation/screens/InterceptorScreen';
import { ReflectionScreen } from './presentation/screens/ReflectionScreen';
import { palette, spacing, tapTarget, type } from './presentation/theme';

// Synchronous, before first render: UI strings + domain vocabulary.
// 'en' is provisional; bootstrapLocale() switches to the stored/device
// language (and applies RTL) inside the boot gate, while the splash shows.
initI18n('en');
registerDomainVocabulary(SmokingPackage);

type BootStatus =
  | { status: 'booting' }
  | { status: 'ready'; boot: BootResult }
  | { status: 'error' };

export default function App(): React.JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<BootStatus>({ status: 'booting' });

  useEffect(() => {
    let cancelled = false;
    let live: BootResult | null = null;

    bootstrapLocale(database)
      .then(() =>
        bootstrap({
          database,
          packs: [SmokingPackage],
          bindUi: bindCravingActor,
        }),
      )
      .then((boot) => {
        if (cancelled) {
          boot.shutdown(); // unmounted mid-boot: release immediately
          return;
        }
        live = boot;
        setState({ status: 'ready', boot });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('[BOS] Bootstrap failed', error);
        setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
      live?.shutdown();
    };
  }, []);

  if (state.status === 'booting') {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashWord}>{t('app.name')}</Text>
        <ActivityIndicator color={palette.action} size="large" />
        <Text style={styles.splashHint}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashWord}>{t('app.name')}</Text>
        <Text style={styles.errorText}>{t('app.boot_error')}</Text>
      </View>
    );
  }

  return (
    <BootProvider value={{ database, boot: state.boot, packId: SMOKING_PACK_ID }}>
      <Shell />
    </BootProvider>
  );
}

// ---------------------------------------------------------------------------
// Shell — phase-driven routing + a minimal two-tab bar (no navigator dep)
// ---------------------------------------------------------------------------

type Tab = 'home' | 'reflection';

function Shell(): React.JSX.Element {
  const { t } = useTranslation();
  const phase = useInterceptorPhase();
  const [tab, setTab] = useState<Tab>('home');

  // Any active traversal owns the whole viewport — no chrome, no escape
  // hatches to wander off mid-flow (the flow itself offers honest exits).
  if (phase !== 'idle') {
    return <InterceptorScreen />;
  }

  return (
    <View style={styles.shell}>
      <View style={styles.content}>
        {tab === 'home' ? <DashboardScreen /> : <ReflectionScreen />}
      </View>
      <View style={styles.tabBar}>
        <TabButton
          label={t('dashboard.tab_home')}
          active={tab === 'home'}
          onPress={() => setTab('home')}
        />
        <TabButton
          label={t('dashboard.tab_reflection')}
          active={tab === 'reflection'}
          onPress={() => setTab('reflection')}
        />
      </View>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.tabButton, active && styles.tabButtonActive]}
      onPress={onPress}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.l,
  },
  splashWord: {
    fontSize: type.title,
    fontWeight: '600',
    letterSpacing: 2,
    color: palette.ink,
  },
  splashHint: { fontSize: type.body, color: palette.inkSoft },
  errorText: {
    fontSize: type.body,
    color: palette.inkSoft,
    textAlign: 'center',
    paddingStart: spacing.xl,
    paddingEnd: spacing.xl,
  },
  shell: { flex: 1, backgroundColor: palette.bg },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row', // auto-mirrors under RTL
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
  },
  tabButton: {
    flex: 1,
    minHeight: tapTarget.chipMinHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: { borderTopWidth: 2, borderTopColor: palette.action },
  tabText: { fontSize: type.body, color: palette.inkSoft },
  tabTextActive: { color: palette.action, fontWeight: '600' },
});
