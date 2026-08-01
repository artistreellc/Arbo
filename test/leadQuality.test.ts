import { describe, it, expect } from 'vitest';
import { scoreLead } from '../src/reception/leadQuality.js';

describe('lead-quality read (§3.14) — a quiet hint, never dismissive', () => {
  it('rates a specific, in-area, storm/hazard lead as hot', () => {
    const r = scoreLead({
      urgency: 'storm',
      scopeClarity: 'specific',
      inServiceArea: true,
      tightZipCluster: true,
      gaveAddress: true,
      agreedToTime: true,
    });
    expect(r.priority).toBe('hot');
  });

  it('rates a vague, price-only, isolated lead as cool', () => {
    const r = scoreLead({ scopeClarity: 'vague', priceOnlyPressure: true, inServiceArea: false });
    expect(r.priority).toBe('cool');
  });

  it('NEVER down-ranks a lead for getting multiple quotes (§3.14)', () => {
    const base = { scopeClarity: 'specific' as const, inServiceArea: true, gaveAddress: true };
    const without = scoreLead(base);
    const withQuotes = scoreLead({ ...base, mentionedOtherQuotes: true });
    // shopping around must NOT change the score
    expect(withQuotes.score).toBe(without.score);
    expect(withQuotes.priority).toBe(without.priority);
    expect(withQuotes.reasons.join(' ')).toMatch(/neutral/i);
  });

  it('is only a hint — a warm middle exists between hot and cool', () => {
    const r = scoreLead({ inServiceArea: true, scopeClarity: 'specific' });
    expect(['hot', 'warm', 'cool']).toContain(r.priority);
    expect(r.priority).toBe('warm');
  });
});
