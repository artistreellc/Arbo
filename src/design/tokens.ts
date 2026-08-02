// Arbo design tokens (live brief §9 — COCKPIT). Dark mission-control HUD:
// black/gray base, luminous purple accents, mono numerals, sharp sans.
// Glove-friendly, sunlight-readable, one-handed: large targets, high contrast.
// The mobile app (Phase 10) and any web surface consume these so nothing drifts.

export const color = {
  // Luminous purple on near-black — the cockpit accent family.
  // Key names kept stable (forest/canopy/...) so consumers don't churn;
  // values are the §9 cockpit palette.
  brand: {
    forest: '#7C3AED', // primary accent (violet)
    forestDark: '#5B21B6', // pressed / deep accent
    canopy: '#A78BFA', // light accent
    moss: '#8B93A1', // cool gray
    bark: '#1C2026', // raised dark surface
    clay: '#A78BFA', // secondary accent (kept sparing)
    amber: '#FFB020', // highlight (used sparingly)
  },
  // High-contrast on dark for direct sunlight.
  ink: '#E9ECF1', // near-white text
  surface: '#15181D', // card surface
  surfaceAlt: '#0B0D10', // page background / header bar
  border: '#2A2F37',
  muted: '#98A0AC',
  // Status — must read at a glance outdoors, on dark.
  status: {
    emergency: '#FF5A52', // red flag: on-structure / power-line
    warning: '#FFB020',
    ok: '#37C98B',
    info: '#5AA9FF',
  },
} as const;

export const typography = {
  // Sharp sans everywhere; mono for numerals/timestamps (HUD instrument feel).
  fontFamily: {
    sans: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  // Type scale (px). Big by default — "the most important thing is the biggest."
  size: { xs: 13, sm: 15, base: 17, lg: 20, xl: 24, '2xl': 30, '3xl': 38, '4xl': 48 },
  weight: { regular: 400, medium: 600, bold: 700, black: 800 },
  lineHeight: { tight: 1.15, normal: 1.4, relaxed: 1.6 },
} as const;

export const spacing = {
  // 4px base scale.
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64,
} as const;

export const radius = { none: 0, sm: 6, md: 10, lg: 16, xl: 24, pill: 999 } as const;

// Glove-friendly minimum interactive target (§9: min 48px).
export const touchTarget = { min: 48, comfortable: 56 } as const;

export const elevation = {
  card: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 10px rgba(0,0,0,0.5)',
  raised: '0 4px 16px rgba(0,0,0,0.6)',
} as const;

export const tokens = { color, typography, spacing, radius, touchTarget, elevation } as const;
export type Tokens = typeof tokens;
export default tokens;
