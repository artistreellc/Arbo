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
import { screenProperty, type GisProvider, type OverlayHit } from '../src/permitting/screening.js';
import {
  screenToPermitRecord,
  requiresClearance,
  crewMayStart,
  crewMayStartForProperty,
  type PermitLifecycle,
} from '../src/permitting/permitRecord.js';

const gisWith = (o: OverlayHit[]): GisProvider => ({ overlaysFor: async () => o });
const CBPA: OverlayHit = { kind: 'CBPA_RPA', layer: 'RPA buffer', meaning: 'In the Bay-protected buffer.' };

describe('screenToPermitRecord — persistable bridge', () => {
  it('maps a PERMIT_LIKELY CBPA removal, in_rpa true, lifecycle starts at "needed"', async () => {
    const screen = await screenProperty({ city: 'Virginia Beach', address: '1 Oak', isRemoval: true }, gisWith([CBPA]));
    const rec = screenToPermitRecord(screen, { propertyId: 'p1', jobId: 'j1' });
    expect(rec.screenStatus).toBe('PERMIT_LIKELY');
    expect(rec.inRpa).toBe(true);
    expect(rec.status).toBe('needed'); // never auto-resolves
    expect(rec.propertyId).toBe('p1');
    expect(rec.rulesetLastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rec.cityContact?.email).toContain('@');
  });

  it('a no-overlay screen still stores NO_OVERLAY_VERIFY at "needed", never resolved', async () => {
    const screen = await screenProperty({ city: 'Norfolk', address: '2 Pine', isRemoval: true }, gisWith([]));
    const rec = screenToPermitRecord(screen, { propertyId: 'p2' });
    expect(rec.screenStatus).toBe('NO_OVERLAY_VERIFY');
    expect(rec.inRpa).toBe(false);
    expect(rec.status).toBe('needed');
  });
});

describe('the crew clearance gate (§6B.3) — no protected work without clearance', () => {
  it('PERMIT_LIKELY blocks the crew until approved / verified-not-required', () => {
    const base = { screenStatus: 'PERMIT_LIKELY' as const, inRpa: true };
    expect(requiresClearance(base)).toBe(true);
    expect(crewMayStart({ ...base, status: 'needed' }).mayStart).toBe(false);
    expect(crewMayStart({ ...base, status: 'applied' }).mayStart).toBe(false);
    expect(crewMayStart({ ...base, status: 'approved' }).mayStart).toBe(true);
    expect(crewMayStart({ ...base, status: 'not_required_verified' }).mayStart).toBe(true);
  });

  it('REVIEW_NEEDED is also gated until a human resolves it', () => {
    const p = { screenStatus: 'REVIEW_NEEDED' as const, inRpa: false, status: 'needed' as PermitLifecycle };
    expect(requiresClearance(p)).toBe(true);
    expect(crewMayStart(p).mayStart).toBe(false);
  });

  it('anything in the RPA is gated even if the status somehow reads no-overlay', () => {
    const p = { screenStatus: 'NO_OVERLAY_VERIFY' as const, inRpa: true, status: 'needed' as PermitLifecycle };
    expect(requiresClearance(p)).toBe(true);
    expect(crewMayStart(p).mayStart).toBe(false);
  });

  it('a truly unflagged job is not blocked by the permit gate (advisory only)', () => {
    const p = { screenStatus: 'NO_OVERLAY_VERIFY' as const, inRpa: false, status: 'needed' as PermitLifecycle };
    expect(requiresClearance(p)).toBe(false);
    const d = crewMayStart(p);
    expect(d.mayStart).toBe(true);
    expect(d.reason).toMatch(/advisory/i);
  });

  it('a blocked decision explains why (surfaces on the job)', () => {
    const d = crewMayStart({ screenStatus: 'PERMIT_LIKELY', inRpa: true, status: 'needed' });
    expect(d.reason).toMatch(/BLOCKED/);
    expect(d.reason).toMatch(/6B\.3/);
  });

  it('NO SCREEN ON FILE is not clearance — a property with no permit record is blocked', () => {
    const d = crewMayStartForProperty(null);
    expect(d.mayStart).toBe(false);
    expect(d.reason).toMatch(/no cbpa\/rpa screen on file/i);
  });

  it('crewMayStartForProperty delegates to the gate when a record exists', () => {
    expect(crewMayStartForProperty({ screenStatus: 'PERMIT_LIKELY', inRpa: true, status: 'approved' }).mayStart).toBe(true);
    expect(crewMayStartForProperty({ screenStatus: 'PERMIT_LIKELY', inRpa: true, status: 'needed' }).mayStart).toBe(false);
  });
});
