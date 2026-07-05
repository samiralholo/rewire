/**
 * Presentation — Interceptor Screen (the Craving Interception Flow)
 * ---------------------------------------------------------------------------
 * A pure projection of the craving machine. Reads state ONLY through the
 * Zustand hooks; writes ONLY by dispatching machine events via
 * `sendCravingEvent`. Zero business logic; zero hardcoded strings — app
 * chrome comes from i18n keys, domain labels from the 'domain' namespace
 * fed by the active DomainPack. Sided styles use start/end (RTL-safe);
 * flex rows flip automatically under I18nManager RTL.
 *
 * The `idle` phase is owned by DashboardScreen (see App.tsx routing) —
 * this screen renders the moment the machine leaves idle.
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTriggerChips, useInterventions, useDomainLabel } from '../hooks/twinData';
import { selectIntervention } from '../../core/engine/interventionSelector';
import type {
  CravingOutcome,
  DomainPackId,
  Intervention,
  InterventionId,
  InterventionMechanism,
  TriggerId,
} from '../../core/types';
import {
  sendCravingEvent,
  useCravingUi,
  useInterceptorPhase,
  useActiveIntervention,
  useInterventionTimer,
  useIsInterceptorBusy,
} from '../../state/uiStore';
import { palette, spacing, tapTarget, type } from '../theme';

// ---------------------------------------------------------------------------
// Screen — one view per machine phase
// ---------------------------------------------------------------------------

export function InterceptorScreen(): React.JSX.Element | null {
  const phase = useInterceptorPhase();

  switch (phase) {
    case 'idle':
      return null; // routed to Dashboard by App.tsx; transitional frame only
    case 'vulnerable':
      return <VulnerableView />;
    case 'active_craving':
      return <CaptureView />;
    case 'intervening':
      return <InterveningView />;
    case 'resolving':
      return <ResolutionView />;
  }
}

// -- vulnerable: the predicted window — a nudge, never an alarm ---------------

function VulnerableView(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.screen}>
      <View style={styles.nudgeCard}>
        <Text style={styles.nudgeTitle}>{t('vulnerable.title')}</Text>
        <Text style={styles.nudgeBody}>{t('vulnerable.body')}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
        onPress={() => sendCravingEvent({ type: 'CRAVING_STARTED', intensity: 0.6 })}
      >
        <Text style={styles.heroText}>{t('dashboard.craving_button')}</Text>
      </Pressable>
      <Pressable
        style={styles.ghostButton}
        onPress={() => sendCravingEvent({ type: 'RISK_CLEARED' })}
      >
        <Text style={styles.ghostText}>{t('vulnerable.dismiss')}</Text>
      </Pressable>
    </View>
  );
}

// -- active_craving: capture trigger (1 tap) then offer an interruption ------

function CaptureView(): React.JSX.Element {
  // Presentation-only step flag; the machine allows both orders anyway.
  const [captured, setCaptured] = useState(false);
  return captured ? (
    <OfferView />
  ) : (
    <TriggerChipsView onCaptured={() => setCaptured(true)} />
  );
}

function TriggerChipsView({ onCaptured }: { onCaptured: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const triggers = useTriggerChips();
  const label = useDomainLabel();

  const capture = (triggerId: TriggerId | null): void => {
    sendCravingEvent({ type: 'TRIGGER_CAPTURED', triggerId });
    onCaptured();
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('interceptor.capture_title')}</Text>
      <Text style={styles.subtle}>{t('interceptor.capture_hint')}</Text>
      <ScrollView contentContainerStyle={styles.chipWrap}>
        {triggers.map((trigger) => (
          <Pressable
            key={trigger.id}
            accessibilityRole="button"
            style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
            onPress={() => capture(trigger.id as TriggerId)}
          >
            <Text style={styles.chipText}>{label(trigger.labelKey)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.ghostButton} onPress={() => capture(null)}>
        <Text style={styles.ghostText}>{t('interceptor.capture_skip')}</Text>
      </Pressable>
    </View>
  );
}

function OfferView(): React.JSX.Element {
  const { t } = useTranslation();
  const triggerId = useCravingUi((s) => s.triggerId);
  const triggers = useTriggerChips();
  const interventionRows = useInterventions();
  const label = useDomainLabel();
  const startTimer = useCravingUi((s) => s.startInterventionTimer);

  // Suggestion comes from the CORE selector — the UI just renders its answer.
  const suggestion = useMemo(() => {
    const category = triggers.find((tr) => tr.id === triggerId)?.category ?? null;
    // DB rows -> core value objects (branded ids restored at the boundary).
    const candidates: Intervention[] = interventionRows.map((i) => ({
      id: i.id as InterventionId,
      domainPackId: i.domainPackId as DomainPackId,
      mechanism: i.mechanism as InterventionMechanism,
      labelKey: i.labelKey,
      contentKey: i.contentKey,
      estimatedDurationSec: i.estimatedDurationSec,
      successRate: i.successRate,
      attemptCount: i.attemptCount,
      suitedCategories: i.suitedCategories,
      activationCost: i.activationCost as Intervention['activationCost'],
      isEnabled: i.isEnabled,
    }));
    return selectIntervention(candidates, { triggerCategory: category, arousal: null });
  }, [interventionRows, triggers, triggerId]);

  if (suggestion === null) {
    // No intervention available: resolve gracefully, never dead-end.
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{t('interceptor.noted')}</Text>
        <Pressable
          style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
          onPress={() => sendCravingEvent({ type: 'INTERVENTION_DECLINED' })}
        >
          <Text style={styles.heroText}>{t('common.continue')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('interceptor.offer_title')}</Text>
      <View style={styles.offerCard}>
        <Text style={styles.offerName}>{label(suggestion.labelKey)}</Text>
        <Text style={styles.offerBody}>{label(suggestion.contentKey)}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
        onPress={() => {
          sendCravingEvent({
            type: 'INTERVENTION_ACCEPTED',
            interventionId: suggestion.id,
          });
          startTimer(suggestion.estimatedDurationSec);
        }}
      >
        <Text style={styles.heroText}>{t('interceptor.offer_accept')}</Text>
      </Pressable>
      <Pressable
        style={styles.ghostButton}
        onPress={() => sendCravingEvent({ type: 'INTERVENTION_DECLINED' })}
      >
        <Text style={styles.ghostText}>{t('interceptor.offer_decline')}</Text>
      </Pressable>
    </View>
  );
}

// -- intervening: the countdown, plus honest exits ----------------------------

function InterveningView(): React.JSX.Element {
  const { t } = useTranslation();
  const activeId = useActiveIntervention();
  const interventions = useInterventions();
  const { remainingSec } = useInterventionTimer();
  const label = useDomainLabel();

  const active = interventions.find((i) => i.id === activeId) ?? null;
  const mm = Math.floor((remainingSec ?? 0) / 60);
  const ss = String((remainingSec ?? 0) % 60).padStart(2, '0');

  return (
    <View style={styles.screen}>
      <Text style={styles.subtle}>
        {active ? label(active.labelKey) : t('interceptor.intervening_fallback')}
      </Text>
      <Text style={styles.timer}>{`${mm}:${ss}`}</Text>
      {active && <Text style={styles.offerBody}>{label(active.contentKey)}</Text>}
      <Pressable
        style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
        onPress={() => sendCravingEvent({ type: 'INTERVENTION_COMPLETED' })}
      >
        <Text style={styles.heroText}>{t('interceptor.intervening_done')}</Text>
      </Pressable>
      <Pressable
        style={styles.ghostButton}
        onPress={() => sendCravingEvent({ type: 'INTERVENTION_ABORTED' })}
      >
        <Text style={styles.ghostText}>{t('interceptor.intervening_stop')}</Text>
      </Pressable>
    </View>
  );
}

// -- resolving: record the outcome without judgment ---------------------------

const OUTCOMES: ReadonlyArray<{
  outcome: CravingOutcome;
  labelKey: string;
  tint: ViewStyle;
}> = [
  { outcome: 'resisted', labelKey: 'interceptor.outcome_resisted', tint: { backgroundColor: palette.affirm } },
  { outcome: 'delayed', labelKey: 'interceptor.outcome_delayed', tint: { backgroundColor: palette.affirm } },
  // Same size, calm surface, zero-guilt copy — data, not failure:
  { outcome: 'completed', labelKey: 'interceptor.outcome_completed', tint: { backgroundColor: palette.surface } },
];

function ResolutionView(): React.JSX.Element {
  const { t } = useTranslation();
  const isPersisting = useIsInterceptorBusy();

  if (isPersisting) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={palette.action} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('interceptor.resolution_title')}</Text>
      <Text style={styles.subtle}>{t('interceptor.resolution_hint')}</Text>
      {OUTCOMES.map(({ outcome, labelKey, tint }) => (
        <Pressable
          key={outcome}
          accessibilityRole="button"
          style={({ pressed }) => [styles.outcome, tint, pressed && styles.chipPressed]}
          onPress={() => sendCravingEvent({ type: 'OUTCOME_RECORDED', outcome })}
        >
          <Text style={styles.outcomeText}>{t(labelKey)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles — slate base, muted blue actions, pastel green positives, no red.
// Only start/end sided properties: the RTL flip costs nothing.
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
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
  subtle: {
    fontSize: type.body,
    color: palette.inkSoft,
    textAlign: 'center',
  },
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
  ghostButton: {
    minHeight: tapTarget.chipMinHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { color: palette.inkSoft, fontSize: type.body },
  chipWrap: {
    flexDirection: 'row', // auto-mirrors under RTL
    flexWrap: 'wrap',
    gap: spacing.s,
    justifyContent: 'center',
    paddingVertical: spacing.m,
  },
  chip: {
    minHeight: tapTarget.chipMinHeight,
    minWidth: '45%',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingStart: spacing.m,
    paddingEnd: spacing.m,
  },
  chipPressed: { borderColor: palette.action, backgroundColor: palette.bg },
  chipText: { fontSize: type.chip, color: palette.ink, textAlign: 'center' },
  nudgeCard: {
    backgroundColor: palette.nudge,
    borderRadius: 24,
    padding: spacing.l,
    gap: spacing.s,
  },
  nudgeTitle: { fontSize: type.body, fontWeight: '600', color: palette.nudgeInk },
  nudgeBody: { fontSize: type.body, color: palette.nudgeInk },
  offerCard: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.l,
    gap: spacing.s,
  },
  offerName: { fontSize: type.chip, fontWeight: '600', color: palette.ink, textAlign: 'center' },
  offerBody: { fontSize: type.body, color: palette.inkSoft, textAlign: 'center' },
  timer: {
    fontSize: type.timer,
    fontWeight: '300',
    color: palette.ink,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  outcome: {
    minHeight: tapTarget.primaryMinHeight,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingStart: spacing.l,
    paddingEnd: spacing.l,
  },
  outcomeText: { fontSize: type.chip, fontWeight: '500', color: palette.ink },
});
