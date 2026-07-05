/**
 * SmokingPackage — Domain plugin for the BOS Core.
 * ---------------------------------------------------------------------------
 * ALL smoking-specific knowledge lives here and ONLY here. The core sees
 * nothing but opaque keys, categories, and numbers.
 */

import type { DomainPackId } from '../../core/types';
import type {
  BehaviorSeed,
  DomainPack,
  InterventionSeed,
  TriggerSeed,
  Vocabulary,
} from '../../core/registry/DomainPack';
import { DomainRegistry } from '../../core/registry/DomainPack';

export const SMOKING_PACK_ID = 'pack.smoking' as DomainPackId;

// ---------------------------------------------------------------------------
// Vocabulary — the only place these words are allowed to exist
// ---------------------------------------------------------------------------

const vocabulary: Vocabulary = {
  en: {
    'behavior.smoking': 'Smoking',
  
    'place.work': 'Work',
    'trigger.morning_coffee': 'Morning coffee',
    'trigger.after_meal': 'After a meal',
    'trigger.work_break': 'Work break',
    'trigger.stress_spike': 'Feeling stressed',
    'trigger.boredom': 'Feeling bored',
    'trigger.social_smokers': 'Around people smoking',
    'trigger.alcohol': 'Having a drink',
    'trigger.driving': 'Driving',
    'trigger.phone_scroll': 'Scrolling my phone',
    'trigger.nicotine_dip': 'Physical urge (withdrawal)',
  
    'intervention.delay_3min': 'Wait 3 minutes',
    'intervention.box_breathing': 'Box breathing (4-4-4-4)',
    'intervention.water_glass': 'Drink a glass of water',
    'intervention.walk_2min': '2-minute walk',
    'intervention.urge_surf': 'Urge surfing',
    'intervention.hands_busy': 'Keep your hands busy',
  
    'content.delay_3min': 'The urge peaks and fades in about 3 minutes. Can you outlast it once?',
    'content.box_breathing': 'Breathe in 4s — hold 4s — out 4s — hold 4s. Repeat 4 times.',
    'content.water_glass': 'Slowly drink a full glass of water before deciding.',
    'content.walk_2min': 'Step away from this spot. Two minutes, anywhere else.',
    'content.urge_surf': 'Notice the urge like a wave: rising, cresting, passing. Just watch it.',
    'content.hands_busy': 'Grab a pen, a coin, anything. Give your hands the ritual instead.',
  },

  // Arabic — translations aligned with the product localization file (ar.json)
  ar: {
    'behavior.smoking': 'التدخين',

    'place.work': 'العمل',
    'trigger.morning_coffee': 'قهوة الصباح',
    'trigger.after_meal': 'بعد الطعام',
    'trigger.work_break': 'استراحة العمل',
    'trigger.stress_spike': 'توتر',
    'trigger.boredom': 'ملل',
    'trigger.social_smokers': 'موقف اجتماعي مع مدخنين',
    'trigger.alcohol': 'مع مشروب',
    'trigger.driving': 'قيادة',
    'trigger.phone_scroll': 'تصفح الهاتف',
    'trigger.nicotine_dip': 'رغبة جسدية (انسحاب)',

    'intervention.delay_3min': 'تأجيل لـ 3 دقائق',
    'intervention.box_breathing': 'تنفس عميق (Box Breathing)',
    'intervention.water_glass': 'شرب كوب من الماء',
    'intervention.walk_2min': 'مشي لدقيقتين',
    'intervention.urge_surf': 'ركوب موجة الرغبة',
    'intervention.hands_busy': 'إشغال اليدين',

    'content.delay_3min': 'تبلغ الرغبة ذروتها وتتلاشى خلال 3 دقائق تقريباً. هل يمكنك الصمود هذه المرة؟',
    'content.box_breathing': 'شهيق 4 ثوانٍ — حبس 4 — زفير 4 — حبس 4. كرر 4 مرات.',
    'content.water_glass': 'اشرب كوباً كاملاً من الماء ببطء قبل أن تقرر.',
    'content.walk_2min': 'ابتعد عن هذا المكان قليلاً. دقيقتان في أي مكان آخر.',
    'content.urge_surf': 'راقب الرغبة كموجة: تصعد، تبلغ الذروة، ثم تمر. فقط راقبها.',
    'content.hands_busy': 'أمسك قلماً أو عملة، أي شيء. امنح يديك طقساً بديلاً.',
  },
};

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

const behaviorSeeds: readonly BehaviorSeed[] = [
  {
    labelKey: 'behavior.smoking',
    initialAutomaticity: 0.9, // entrenched loops start near-unconscious
    estimatedDailyFrequency: 15,
  },
];

const triggerSeeds: readonly TriggerSeed[] = [
  { category: 'temporal',      labelKey: 'trigger.morning_coffee', initialWeight: 0.7 },
  { category: 'activity',      labelKey: 'trigger.after_meal',     initialWeight: 0.8 },
  {
    category: 'temporal',
    labelKey: 'trigger.work_break',
    initialWeight: 0.6,
    // Dormant until the user pins their workplace (no coordinates in a seed).
    sensorBinding: { kind: 'geofence', placeKey: 'place.work', radiusM: 150 },
  },
  { category: 'emotional',     labelKey: 'trigger.stress_spike',   initialWeight: 0.7 },
  { category: 'emotional',     labelKey: 'trigger.boredom',        initialWeight: 0.5 },
  { category: 'social',        labelKey: 'trigger.social_smokers', initialWeight: 0.6 },
  { category: 'social',        labelKey: 'trigger.alcohol',        initialWeight: 0.6 },
  {
    category: 'activity',
    labelKey: 'trigger.driving',
    initialWeight: 0.4,
    sensorBinding: { kind: 'movement', movement: 'driving' },
  },
  { category: 'activity',      labelKey: 'trigger.phone_scroll',   initialWeight: 0.3 },
  { category: 'physiological', labelKey: 'trigger.nicotine_dip',   initialWeight: 0.5 },
];

const interventionSeeds: readonly InterventionSeed[] = [
  {
    mechanism: 'delay',
    labelKey: 'intervention.delay_3min',
    baselineWeight: 0.60,
    contentKey: 'content.delay_3min',
    estimatedDurationSec: 180,
    suitedCategories: ['temporal', 'activity', 'physiological'],
    activationCost: 1,
  },
  {
    mechanism: 'breathing',
    labelKey: 'intervention.box_breathing',
    baselineWeight: 0.55,
    contentKey: 'content.box_breathing',
    estimatedDurationSec: 64,
    suitedCategories: ['emotional', 'physiological'],
    activationCost: 1,
  },
  {
    mechanism: 'substitution',
    labelKey: 'intervention.water_glass',
    baselineWeight: 0.45,
    contentKey: 'content.water_glass',
    estimatedDurationSec: 60,
    suitedCategories: ['activity', 'physiological'],
    activationCost: 2,
  },
  {
    mechanism: 'environment',
    labelKey: 'intervention.walk_2min',
    baselineWeight: 0.50,
    contentKey: 'content.walk_2min',
    estimatedDurationSec: 120,
    suitedCategories: ['environmental', 'social', 'emotional'],
    activationCost: 2,
  },
  {
    mechanism: 'reframe',
    labelKey: 'intervention.urge_surf',
    baselineWeight: 0.52,
    contentKey: 'content.urge_surf',
    estimatedDurationSec: 90,
    suitedCategories: ['emotional', 'physiological'],
    activationCost: 2,
  },
  {
    mechanism: 'distraction',
    labelKey: 'intervention.hands_busy',
    baselineWeight: 0.40,
    contentKey: 'content.hands_busy',
    estimatedDurationSec: 120,
    suitedCategories: ['activity', 'social'],
    activationCost: 1,
  },
];

// ---------------------------------------------------------------------------
// Pack definition
// ---------------------------------------------------------------------------

export const SmokingPackage: DomainPack = {
  id: SMOKING_PACK_ID,
  version: '1.0.0',
  displayName: 'Smoking',
  vocabulary,
  behaviorSeeds,
  triggerSeeds,
  interventionSeeds,
  /**
   * Domain prior: cravings cluster around morning ritual, post-meal windows,
   * and gaps since the last event (withdrawal rhythm ~45-90 min for heavy use).
   */
  vulnerabilityPrior: ({ localHour, minutesSinceLastEvent }) => {
    let risk = 0.2;
    if (localHour >= 6 && localHour <= 9) risk += 0.25;   // morning ritual
    if (localHour >= 12 && localHour <= 14) risk += 0.15; // post-lunch
    if (minutesSinceLastEvent !== null && minutesSinceLastEvent > 60) risk += 0.2;
    return Math.min(risk, 1);
  },
};

/** Call once at app bootstrap (e.g. from the app root, before UI mounts). */
export function registerSmokingPackage(): void {
  DomainRegistry.register(SmokingPackage);
}
