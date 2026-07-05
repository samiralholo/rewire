/**
 * Presentation — Localization Layer (i18next + react-i18next)
 * ---------------------------------------------------------------------------
 * Owns ALL display strings. Two sources feed it:
 *   1. App dictionaries (./locales/en.json, ./locales/ar.json) — UI chrome.
 *   2. DomainPack vocabularies — injected at boot via registerDomainVocabulary
 *      into the 'domain' namespace, so domain words never leak into app code.
 *
 * RTL: Arabic flips the whole layout via I18nManager. RN applies the flip at
 * native level, which is why styles must use start/end (marginStart,
 * paddingEnd, textAlign etc.) — never hard left/right. Note that changing
 * forceRTL only takes full effect after an app reload; setAppLanguage
 * returns `requiresRestart` so the caller can prompt gently.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import type { DomainPack } from '../core/registry/DomainPack';
import en from './locales/en.json';
import ar from './locales/ar.json';

export const SUPPORTED_LANGUAGES = ['en', 'ar'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar']);

export const isRtl = (lang: string): boolean => RTL_LANGUAGES.has(lang);

// ---------------------------------------------------------------------------
// Init — synchronous (inline resources), call once before first render
// ---------------------------------------------------------------------------

export function initI18n(initialLanguage: AppLanguage = 'en'): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        ar: { translation: ar },
      },
      lng: initialLanguage,
      fallbackLng: 'en',
      defaultNS: 'translation',
      interpolation: { escapeValue: false }, // React already escapes
      returnNull: false,
    });
    I18nManager.allowRTL(true);
  }
  return i18n;
}

// ---------------------------------------------------------------------------
// Language switching with RTL enforcement
// ---------------------------------------------------------------------------

export interface LanguageChangeResult {
  language: AppLanguage;
  /** True when the RTL flag flipped — RN needs an app reload to re-layout. */
  requiresRestart: boolean;
}

export async function setAppLanguage(language: AppLanguage): Promise<LanguageChangeResult> {
  const wantRtl = isRtl(language);
  const requiresRestart = I18nManager.isRTL !== wantRtl;

  await i18n.changeLanguage(language);
  if (requiresRestart) {
    I18nManager.forceRTL(wantRtl);
    // Caller decides how to reload (expo-updates reloadAsync / RNRestart).
  }
  return { language, requiresRestart };
}

// ---------------------------------------------------------------------------
// DomainPack vocabulary bridge — the 'domain' namespace
// ---------------------------------------------------------------------------

/** i18next treats '.' as a nesting separator; pack keys are flat-dotted. */
const nest = (flat: Readonly<Record<string, string>>): Record<string, unknown> => {
  const root: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      node = (node[part] ??= {}) as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = value;
  }
  return root;
};

/**
 * Register every locale of a pack's vocabulary under the 'domain' namespace.
 * Call at boot for each active pack (idempotent: deep-merges).
 */
export function registerDomainVocabulary(pack: DomainPack): void {
  for (const [locale, dictionary] of Object.entries(pack.vocabulary)) {
    i18n.addResourceBundle(locale, 'domain', nest(dictionary), true, true);
  }
}

export default i18n;
