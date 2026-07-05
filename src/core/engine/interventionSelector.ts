/**
 * BOS Core — V1 Intervention Selection (rule-based heuristic)
 * ---------------------------------------------------------------------------
 * MVP rule per spec: no ML — pick the enabled intervention with the highest
 * learned success rate, preferring category fit and low activation cost
 * when the user is highly aroused (adaptive friction).
 */

import type { Intervention, TriggerCategory, UnitInterval } from '../types';

const HIGH_AROUSAL = 0.7;

export function selectIntervention(
  candidates: readonly Intervention[],
  opts: { triggerCategory: TriggerCategory | null; arousal: UnitInterval | null },
): Intervention | null {
  const pool = candidates.filter((i) => i.isEnabled);
  if (pool.length === 0) return null;

  const score = (i: Intervention): number => {
    const fit =
      opts.triggerCategory && i.suitedCategories.includes(opts.triggerCategory) ? 0.2 : 0;
    // Under stress, cheap-to-start interruptions win ties.
    const frictionPenalty =
      (opts.arousal ?? 0) >= HIGH_AROUSAL ? (i.activationCost - 1) * 0.15 : 0;
    // Cold-start smoothing so new interventions get explored (Laplace prior).
    const smoothedRate =
      (i.successRate * i.attemptCount + 0.5) / (i.attemptCount + 1);
    return smoothedRate + fit - frictionPenalty;
  };

  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}
