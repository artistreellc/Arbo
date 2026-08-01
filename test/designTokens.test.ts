import { describe, it, expect } from 'vitest';
import tokens from '../src/design/tokens.js';

describe('design tokens (§9)', () => {
  it('meets the glove-friendly minimum touch target (48px)', () => {
    expect(tokens.touchTarget.min).toBeGreaterThanOrEqual(48);
  });

  it('exposes a coherent type scale', () => {
    expect(tokens.typography.size.base).toBeGreaterThanOrEqual(16); // readable outdoors
    expect(tokens.typography.size['4xl']).toBeGreaterThan(tokens.typography.size.base);
  });

  it('uses valid hex colors including an emergency status color', () => {
    const hex = /^#[0-9A-Fa-f]{6}$/;
    expect(tokens.color.brand.forest).toMatch(hex);
    expect(tokens.color.status.emergency).toMatch(hex);
  });

  it('provides a 4px-based spacing scale and radii', () => {
    expect(tokens.spacing[4]).toBe(16);
    expect(tokens.radius.pill).toBeGreaterThan(tokens.radius.lg);
  });
});
