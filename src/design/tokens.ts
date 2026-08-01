// ARBOR design tokens (brief §9). Built for a glove-friendly, sunlight-readable,
// one-handed field app: large touch targets, high contrast, earthy palette.
// The mobile app (Phase 10) and any web surface consume these so nothing drifts.

export const color = {
  // Deep greens / natural earth tones — calm, professional, confident.
  brand: {
    forest: '#1B4D3E', // primary
    forestDark: '#12352B', // pressed / headers
    canopy: '#2A7A5E', // accent / success-ish
    moss: '#6B8F71',
    bark: '#3E2C23', // earth
    clay: '#B4552D', // warm accent (badge marks, sparingly)
    amber: '#D4AF37', // highlight (used sparingly)
  },
  // High-contrast neutrals for direct sunlight.
  ink: '#0F1A15', // near-black text
  surface: '#FFFFFF',
  surfaceAlt: '#F3F5F2',
  border: '#D5DCD7',
  muted: '#5C6B62',
  // Status — must read at a glance outdoors.
  status: {
    emergency: '#C62828', // red flag: on-structure / power-line
    warning: '#E08A00',
    ok: '#2A7A5E',
    info: '#2B6CB0',
  },
} as const;

export const typography = {
  // Strong weights for sunlight legibility; system stack for now (Phase 10 picks
  // the shipped typeface). Confident, readable, generous.
  fontFamily: {
    sans: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    display: 'ui-serif, Georgia, "Times New Roman", serif',
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
  card: '0 1px 3px rgba(15,26,21,0.12), 0 1px 2px rgba(15,26,21,0.08)',
  raised: '0 4px 12px rgba(15,26,21,0.16)',
} as const;

export const tokens = { color, typography, spacing, radius, touchTarget, elevation } as const;
export type Tokens = typeof tokens;
export default tokens;
