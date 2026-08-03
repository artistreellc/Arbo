/*
  ═══════════════════════════════════════════════════════════════════════
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.
*/
import { describe, it, expect } from 'vitest';
import {
  screenProperty,
  assertNeverClear,
  type GisProvider,
  type OverlayHit,
  type ScreenInput,
  type ScreenResult,
} from '../src/permitting/screening.js';
import { CITY_RULESETS } from '../src/permitting/cities.js';
import { SERVICE_CITIES } from '../src/lib/address.js';

// Test GIS providers — the live city GIS is injected the same way at deploy.
const gisWith = (overlays: OverlayHit[]): GisProvider => ({ overlaysFor: async () => overlays });
const CBPA: OverlayHit = { kind: 'CBPA_RPA', layer: 'RPA buffer', meaning: 'Tree sits in the Bay-protected buffer.' };
const FLOOD: OverlayHit = { kind: 'FEMA_FLOOD', layer: 'SFHA zone AE', meaning: 'High-risk flood zone; grading/hauling may need the floodplain office.' };

const base: ScreenInput = { city: 'Virginia Beach', address: '123 Oak Ave', isRemoval: true };

describe('CBPA/RPA screening — status classification', () => {
  it('a removal inside CBPA/RPA screens PERMIT_LIKELY', async () => {
    const r = await screenProperty(base, gisWith([CBPA]));
    expect(r.status).toBe('PERMIT_LIKELY');
  });

  it('an overlay present but not a CBPA/RPA removal screens REVIEW_NEEDED', async () => {
    const r = await screenProperty({ ...base, isRemoval: false }, gisWith([FLOOD]));
    expect(r.status).toBe('REVIEW_NEEDED');
  });

  it('CBPA/RPA present but the job is not a removal → REVIEW_NEEDED (not permit-likely)', async () => {
    const r = await screenProperty({ ...base, isRemoval: false }, gisWith([CBPA]));
    expect(r.status).toBe('REVIEW_NEEDED');
  });

  it('no overlays → NO_OVERLAY_VERIFY, never a clear', async () => {
    const r = await screenProperty(base, gisWith([]));
    expect(r.status).toBe('NO_OVERLAY_VERIFY');
    expect(r.verifyWithCity).toBe(true);
  });
});

describe('the HARD guardrail — never say "clear" (§6B.3, §12)', () => {
  // Every reachable result across every city and every input shape.
  const inputs: ScreenInput[] = [];
  for (const city of SERVICE_CITIES) {
    for (const isRemoval of [true, false]) {
      for (const nearPowerLines of [true, false]) {
        for (const treeCount of [undefined, 1, 5, 12]) {
          inputs.push({ city, address: '1 Test St', isRemoval, nearPowerLines, treeCount });
        }
      }
    }
  }
  const overlaySets: OverlayHit[][] = [[], [CBPA], [FLOOD], [CBPA, FLOOD]];

  const runAll = async (): Promise<ScreenResult[]> => {
    const out: ScreenResult[] = [];
    for (const input of inputs) {
      for (const overlays of overlaySets) {
        out.push(await screenProperty(input, gisWith(overlays)));
      }
    }
    return out;
  };

  const check = (results: ScreenResult[]) => {
    for (const r of results) {
      // verify-with-city is always set; headline always says "verify", never "clear".
      expect(r.verifyWithCity).toBe(true);
      expect(r.headline.toLowerCase()).toContain('verify');
      expect(r.headline).not.toMatch(/\b(you'?re clear|no permit needed|all clear|good to (go|cut))\b/i);
      expect(() => assertNeverClear(r)).not.toThrow();
      expect(['PERMIT_LIKELY', 'REVIEW_NEEDED', 'NO_OVERLAY_VERIFY']).toContain(r.status);
    }
  };

  // Run the suite TWICE (Phase 4 acceptance: "Run the 'never say clear' test twice").
  it('pass 1 — no result ever implies clear', async () => check(await runAll()));
  it('pass 2 — re-verified', async () => check(await runAll()));
});

describe('mitigation + power lines + scale tiers', () => {
  it('surfaces the 3:1 mitigation rule when a removal screens PERMIT_LIKELY', async () => {
    const r = await screenProperty({ ...base, treeCount: 2 }, gisWith([CBPA]));
    expect(r.mitigation).toBeDefined();
    expect(r.mitigation?.ratioPerRemoval).toBe(3);
    expect(r.mitigation?.minCaliperInches).toBe(3.5);
    expect(r.mitigation?.estimatedReplacements).toBe(6); // 2 removed × 3
  });

  it('mitigation respects the minimum floor', async () => {
    const r = await screenProperty({ ...base, treeCount: 0 }, gisWith([CBPA]));
    expect(r.mitigation?.estimatedReplacements).toBe(3); // min, not 0
  });

  it('power-line involvement flags utility routing and forces at least REVIEW_NEEDED', async () => {
    const r = await screenProperty({ ...base, isRemoval: false, nearPowerLines: true }, gisWith([]));
    expect(r.status).toBe('REVIEW_NEEDED');
    expect(r.powerLine?.flagged).toBe(true);
    expect(r.powerLine?.instruction).toMatch(/High Voltage Safety Act/i);
  });

  it('Chesapeake 10+ mature trees escalates to the Board-hearing tier', async () => {
    const r = await screenProperty({ city: 'Chesapeake', address: '5 Pine Rd', isRemoval: true, treeCount: 12 }, gisWith([CBPA]));
    expect(r.scaleEscalation).toMatch(/Board public hearing/i);
  });
});

describe('per-city rulesets', () => {
  it('every one of the four service cities has a dated ruleset', () => {
    for (const city of SERVICE_CITIES) {
      const rs = CITY_RULESETS[city];
      expect(rs).toBeDefined();
      expect(rs.forms.length).toBeGreaterThan(0);
      expect(rs.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('Virginia Beach uses Accela and carries the PPR forms (reference impl §6B.4)', async () => {
    const r = await screenProperty(base, gisWith([CBPA]));
    expect(r.ruleset.portalSystem).toBe('Accela');
    expect(r.ruleset.forms.some((f) => /PPR/i.test(f.name))).toBe(true);
  });
});
