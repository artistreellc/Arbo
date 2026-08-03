/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
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

  Remember the marker: SLOW::ARBO
*/
import { describe, it, expect } from 'vitest';
import {
  deriveScreenInput,
  runIntakeScreen,
  summarize,
  type IntakeScreenParams,
} from '../src/permitting/intakeScreen.js';
import type { GisProvider, OverlayHit } from '../src/permitting/screening.js';
import type { PermitRecordInput } from '../src/permitting/permitRecord.js';

const CBPA: OverlayHit = { kind: 'CBPA_RPA', layer: 'RPA buffer', meaning: 'In the Bay-protected buffer.' };
const gisWith = (o: OverlayHit[]): GisProvider => ({ overlaysFor: async () => o });
const gisDown: GisProvider = {
  overlaysFor: async () => {
    throw new Error('city GIS timeout');
  },
};

const params = (qualification: Record<string, unknown> = {}): IntakeScreenParams => ({
  propertyId: 'prop-1',
  city: 'Norfolk',
  address: '8562 Circle Drive, Norfolk, VA 23503',
  qualification,
});

const okPersist = async (r: PermitRecordInput) => ({ id: `permit-for-${r.propertyId}` });
const failPersist = async () => {
  throw new Error('db write failed');
};

describe('deriveScreenInput — qualification → screen input', () => {
  it('explicit removal language screens as a removal', () => {
    for (const jobType of ['removal', 'Remove two oaks', 'take down', 'take-down', 'cut down the pine', 'felling']) {
      expect(deriveScreenInput(params({ jobType })).isRemoval).toBe(true);
    }
  });

  it('explicit non-removal work screens as non-removal', () => {
    for (const jobType of ['trim', 'pruning', 'stump grinding', 'cleanup', 'haul away brush']) {
      expect(deriveScreenInput(params({ jobType })).isRemoval).toBe(false);
    }
  });

  it('unknown / "not sure" is screened at removal strictness (conservative)', () => {
    expect(deriveScreenInput(params({ jobType: 'not sure' })).isRemoval).toBe(true);
    expect(deriveScreenInput(params({})).isRemoval).toBe(true);
  });

  it('carries the §3.3 power-line red flag through to the screen', () => {
    expect(deriveScreenInput(params({ powerLineRedFlag: true })).nearPowerLines).toBe(true);
    expect(deriveScreenInput(params({ powerLineRedFlag: false })).nearPowerLines).toBe(false);
  });
});

describe('runIntakeScreen — the honesty rules (§1B: never fabricate a result)', () => {
  it('no GIS provider → PENDING, never a fabricated NO_OVERLAY_VERIFY', async () => {
    const outcome = await runIntakeScreen(params(), null, okPersist);
    expect(outcome.kind).toBe('pending');
    if (outcome.kind === 'pending') expect(outcome.reason).toMatch(/NOT run/i);
  });

  it('GIS failure → PENDING with the reason, and it does not throw (the lead survives)', async () => {
    const outcome = await runIntakeScreen(params(), gisDown, okPersist);
    expect(outcome.kind).toBe('pending');
    if (outcome.kind === 'pending') expect(outcome.reason).toMatch(/GIS screen failed/i);
  });

  it('a live GIS with a CBPA hit screens, persists, and returns the permit id', async () => {
    const outcome = await runIntakeScreen(params({ jobType: 'removal' }), gisWith([CBPA]), okPersist);
    expect(outcome.kind).toBe('screened');
    if (outcome.kind === 'screened') {
      expect(outcome.screen.status).toBe('PERMIT_LIKELY');
      expect(outcome.record.propertyId).toBe('prop-1');
      expect(outcome.record.inRpa).toBe(true);
      expect(outcome.permitId).toBe('permit-for-prop-1');
    }
  });

  it('a persist failure degrades to PENDING naming the un-saved status — never throws', async () => {
    const outcome = await runIntakeScreen(params({ jobType: 'removal' }), gisWith([CBPA]), failPersist);
    expect(outcome.kind).toBe('pending');
    if (outcome.kind === 'pending') {
      expect(outcome.reason).toMatch(/PERMIT_LIKELY/);
      expect(outcome.reason).toMatch(/could not be saved/i);
    }
  });

  it('a clean screen (no overlays) is still NO_OVERLAY_VERIFY — verify rides the lead', async () => {
    const outcome = await runIntakeScreen(params({ jobType: 'trim' }), gisWith([]), okPersist);
    expect(outcome.kind).toBe('screened');
    if (outcome.kind === 'screened') {
      expect(outcome.screen.status).toBe('NO_OVERLAY_VERIFY');
      expect(outcome.screen.headline).toMatch(/verify/i);
    }
  });
});

describe('summarize — the flag that rides the lead', () => {
  it('screened → status + headline for Mike', async () => {
    const outcome = await runIntakeScreen(params({ jobType: 'removal' }), gisWith([CBPA]), okPersist);
    const s = summarize(outcome);
    expect(s.screened).toBe(true);
    expect(s.status).toBe('PERMIT_LIKELY');
    expect(s.inRpa).toBe(true);
    expect(s.headline).toMatch(/verify/i);
  });

  it('pending → the named reason, no invented status', async () => {
    const s = summarize(await runIntakeScreen(params(), null, okPersist));
    expect(s.screened).toBe(false);
    expect(s.status).toBeUndefined();
    expect(s.pendingReason).toMatch(/NOT run/i);
  });
});
