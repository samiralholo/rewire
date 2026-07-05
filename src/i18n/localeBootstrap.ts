/**
 * Presentation — first-boot locale resolution.
 * ---------------------------------------------------------------------------
 * Order of truth: stored preference > device locale > 'en'.
 *
 * RTL on the very first boot: I18nManager.forceRTL only takes effect on the
 * NEXT native layout pass, so when the detected language flips the direction
 * (fresh install on an Arabic device), we apply the flag and trigger one
 * in-place reload. The flag persists natively, so after the reload
 * `I18nManager.isRTL` already matches and this path never repeats — no loop.
 */

import { getLocales } from 'expo-localization';
import type { Database } from '@nozbe/watermelondb';
import {
  SUPPORTED_LANGUAGES,
  setAppLanguage,
  type AppLanguage,
} from './index';
import { reloadApp } from '../platform/restart';

const LANGUAGE_STORAGE_KEY = 'app.language';

const isSupported = (code: string): code is AppLanguage =>
  (SUPPORTED_LANGUAGES as readonly string[]).includes(code);

/** Device language, clamped to what we ship. */
export function detectDeviceLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return isSupported(code) ? code : 'en';
}

/**
 * Resolve + apply the app language. Call inside the boot gate (the splash
 * is showing) and BEFORE the main tree renders, so a first-boot RTL flip
 * reloads a splash, not a half-built screen.
 */
export async function bootstrapLocale(database: Database): Promise<AppLanguage> {
  const stored = await database.localStorage.get<string>(LANGUAGE_STORAGE_KEY);
  const language: AppLanguage =
    stored !== undefined && isSupported(stored) ? stored : detectDeviceLanguage();

  if (stored === undefined) {
    await database.localStorage.set(LANGUAGE_STORAGE_KEY, language);
  }

  const { requiresRestart } = await setAppLanguage(language);
  if (requiresRestart) {
    // First boot on an RTL-language device: flag is set, reload once.
    await reloadApp();
  }
  return language;
}

/** Persist a manual language choice (Dashboard toggle). */
export async function persistLanguage(
  database: Database,
  language: AppLanguage,
): Promise<void> {
  await database.localStorage.set(LANGUAGE_STORAGE_KEY, language);
}
