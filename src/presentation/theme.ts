/**
 * Presentation — Zero-Guilt Theme Tokens
 * ---------------------------------------------------------------------------
 * Palette rules from the UX spec: no red/danger colors anywhere — a lapse is
 * data, not an alarm. Neutral slate base, pastel green for gentle positives,
 * muted blue for actions. Tap targets sized for stressed, shaky hands.
 */

export const palette = {
  // Slate base
  bg: '#F4F6F8',
  surface: '#FFFFFF',
  ink: '#31404E',
  inkSoft: '#6B7A88',
  border: '#DDE4EA',
  // Muted blue — primary actions
  action: '#5B87A6',
  actionPressed: '#4A7290',
  actionInk: '#FFFFFF',
  // Pastel green — calm positives (never triumphal)
  affirm: '#A8C8B4',
  affirmInk: '#2F4A3B',
  // Soft lavender — the "vulnerable" nudge (calm, not alarming)
  nudge: '#C9C3DC',
  nudgeInk: '#453D5E',
} as const;

export const spacing = { xs: 4, s: 8, m: 16, l: 24, xl: 40 } as const;

export const type = {
  title: 28,
  body: 17,
  chip: 18,
  timer: 56,
} as const;

/** Adaptive Friction: stressed users get massive, unmissable targets. */
export const tapTarget = {
  chipMinHeight: 64,
  primaryMinHeight: 72,
  heroMinHeight: 96,
} as const;
