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
import { assemblePacket, CONTRACTOR, type PacketInput } from '../src/permitting/packet.js';

const base: PacketInput = {
  city: 'Virginia Beach',
  permit: { id: 'perm-1', screenStatus: 'PERMIT_LIKELY', inRpa: true, labeledMapFile: 'drive-map-1' },
  property: { address: '77 Bayside Rd', zip: '23451' },
  owner: { name: 'Dana Homeowner', phone: '7575550142' },
  photos: [{ driveFileId: 'drive-photo-1', label: 'Oak #1' }],
  preparedForms: ['PPR Standard Submittal Form', 'PPR Tree Removal Form'],
  treeCount: 2,
};

describe('permit packet assembly (§6B.1 step 6 — prepare and hand off, never file)', () => {
  it('a complete VB packet is READY_FOR_MIKE with both PPR forms checked', () => {
    const p = assemblePacket(base);
    expect(p.status).toBe('READY_FOR_MIKE');
    expect(p.missing).toEqual([]);
    expect(p.items.filter((i) => i.key.startsWith('form:'))).toHaveLength(2);
    expect(p.handoff.method).toBe('Accela');
    expect(p.neverAutoFiled).toBe(true);
  });

  it('missing map + photos → INCOMPLETE, each named', () => {
    const p = assemblePacket({
      ...base,
      permit: { ...base.permit, labeledMapFile: null },
      photos: [],
    });
    expect(p.status).toBe('INCOMPLETE');
    expect(p.missing.join(' ')).toMatch(/site map/i);
    expect(p.missing.join(' ')).toMatch(/photos/i);
    expect(p.coverSummary).toMatch(/INCOMPLETE — still needs/);
  });

  it('an unprepared city form is flagged missing', () => {
    const p = assemblePacket({ ...base, preparedForms: ['PPR Standard Submittal Form'] });
    expect(p.status).toBe('INCOMPLETE');
    expect(p.missing).toContain('PPR Tree Removal Form');
  });

  it('surfaces the mitigation rule up front on PERMIT_LIKELY removals (§6B.4)', () => {
    const p = assemblePacket(base);
    expect(p.mitigationNote).toMatch(/3 replacement/i);
    expect(p.mitigationNote).toMatch(/~6 replacement trees/); // 2 removed × 3:1
  });

  it('no mitigation note when the screen was not PERMIT_LIKELY', () => {
    const p = assemblePacket({ ...base, permit: { ...base.permit, screenStatus: 'NO_OVERLAY_VERIFY', inRpa: false } });
    expect(p.mitigationNote).toBeUndefined();
    expect(p.coverSummary).toMatch(/verify with city/i);
  });

  it('carries only the approved credentials — and there is no submit anywhere', () => {
    expect(CONTRACTOR.credentials).toBe('Licensed & insured · BBB A+');
    const p = assemblePacket(base);
    expect(JSON.stringify(p)).not.toMatch(/\bTCIA\b/i);
    expect(JSON.stringify(p)).not.toMatch(/\bSuffolk\b/i);
    // the packet's contract: hand-off info for MIKE, never a send/submit action
    expect(p.handoff.contact?.email).toContain('@');
    expect(Object.keys(p)).not.toContain('submit');
  });

  it('cover summary always tells Mike where it goes', () => {
    const norfolk = assemblePacket({ ...base, city: 'Norfolk' });
    expect(norfolk.handoff.method).toMatch(/Norfolk Environmental Services/i);
    expect(norfolk.coverSummary).toContain('Norfolk');
  });
});
