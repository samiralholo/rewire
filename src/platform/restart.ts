/**
 * Platform — in-place app reload.
 * ---------------------------------------------------------------------------
 * Uses expo-updates when available (managed + bare with updates configured).
 * Dynamically imported so environments without the module (tests, storybook)
 * degrade to a no-op with a warning instead of crashing at import time.
 */

export async function reloadApp(): Promise<boolean> {
  try {
    const Updates = await import('expo-updates');
    await Updates.reloadAsync();
    return true;
  } catch (error) {
    console.warn('[BOS] In-place reload unavailable; user must reopen the app.', error);
    return false;
  }
}
