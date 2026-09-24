// The simulation runner itself — proven on synthetic personas before any
// client-derived data touches it. §3: SIM- names, 555-01xx numbers.
import { describe, it, expect } from 'vitest';
import { runSimulation, type SimPersona } from '../src/dev/simCalls.js';

const personas: SimPersona[] = Array.from({ length: 20 }, (_, i) => ({
  name: `SIM-Caller-${i}`,
  phone: `+1757555${String(100 + i).padStart(4, '0')}`,
  city: ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth'][i % 4]!,
  zip: ['23452', '23510', '23320', '23701'][i % 4],
  scope: ['large oak removal', 'crepe myrtle trim', 'stump grinding', 'storm cleanup'][i % 4]!,
}));

describe('runSimulation (mechanics)', () => {
  it('20 calls: guard eats every price, every goodbye hangs up, every call finalizes once', async () => {
    const r = await runSimulation(personas, { repeatEvery: 5 });
    expect(r.calls).toBe(24); // 20 + 4 repeats
    expect(r.guardBlockedPriceEveryTime, r.failures.join(' | ')).toBe(true);
    expect(r.guardBlocks).toBe(24);
    expect(r.endCallOnEveryGoodbye, r.failures.join(' | ')).toBe(true);
    expect(r.finalizedOnce).toBe(24);
    expect(r.doubleFinalized).toBe(0);
    expect(r.holdsAttempted).toBe(24);
    expect(r.holdsFiledMikesWay).toBe(24);
    expect(r.holdsWithParsedWindow).toBe(24);
    expect(r.repeatCallsRun).toBe(4);
    expect(r.repeatNoteFired).toBe(4);
    expect(r.failures).toEqual([]);
    expect(r.honesty).toContain('NOT Opus conversational quality');
  }, 60000);
});
