/*
  SLOW::ARBO — see src/permitting/permitBoard.ts for the full marker.
*/
import { describe, it, expect } from 'vitest';

import {
  buildPermitBoard, toBoardRow, boardClearance, assertBoardNeverClear,
  BUCKET_LABEL, RULESET_STALE_DAYS,
  type PermitTrackRow,
} from '../src/permitting/permitBoard.js';
import type { OverlayHit } from '../src/permitting/screening.js';

const TODAY = '2026-08-03';
const CBPA: OverlayHit = { kind: 'CBPA_RPA', layer: 'DEQ RPA layer 33', meaning: 'In the Bay buffer.' };

const row = (over: Partial<PermitTrackRow> = {}): PermitTrackRow => ({
  permitId: 'pm1', propertyId: 'p1', addressLabel: '101 Sim Row', city: 'Virginia Beach',
  jobId: null,
  screen: { status: 'NO_OVERLAY_VERIFY', inRpa: false, overlays: [], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
  status: 'needed', formRef: null, scheduledFor: null, ...over,
});

describe('the board buckets a property honestly', () => {
  it('a never-screened property is loud, not absent (§1B)', () => {
    const r = toBoardRow(row({ screen: null }), TODAY);
    expect(r.bucket).toBe('never_screened');
    expect(r.headline).toMatch(/not "nothing applies"/i);
    expect(r.nextStep).toMatch(/Run the screen/i);
    expect(r.screenStatus).toBeNull();
  });

  it('a clean screen is still not a clearance', () => {
    const r = toBoardRow(row(), TODAY);
    expect(r.bucket).toBe('no_overlay_verify');
    expect(r.headline).toMatch(/still VERIFY WITH CITY/i);
    expect(r.nextStep).toMatch(/Confirm with/i);
  });

  it('booked work with an open permit question is the loudest bucket', () => {
    const r = toBoardRow(row({
      screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
      scheduledFor: '2026-08-05',
    }), TODAY);
    expect(r.bucket).toBe('blocked_scheduled');
    expect(r.blocksScheduledWork).toBe(true);
    expect(r.headline).toMatch(/BLOCKED/);
    expect(r.nextStep).toMatch(/Do not send a crew/i);
  });

  it('an unscheduled permit-likely is urgent but not blocking', () => {
    const r = toBoardRow(row({
      screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
    }), TODAY);
    expect(r.bucket).toBe('permit_likely');
    expect(r.blocksScheduledWork).toBe(false);
  });

  it('a human resolution takes it off the board, and only a human can', () => {
    for (const status of ['approved', 'not_required_verified'] as const) {
      const r = toBoardRow(row({
        status,
        screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
        scheduledFor: '2026-08-05',
      }), TODAY);
      // Resolved beats blocked: the question was answered by a person.
      expect(r.bucket).toBe('resolved');
      expect(r.blocksScheduledWork).toBe(false);
    }
  });

  it('filed-with-the-city is its own state, not "done"', () => {
    const r = toBoardRow(row({
      status: 'applied', formRef: '2026-DSC-000123',
      screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
    }), TODAY);
    expect(r.bucket).toBe('applied_waiting');
    expect(r.headline).toContain('2026-DSC-000123');
    expect(r.nextStep).toMatch(/Chase/i);
  });
});

describe('a stale ruleset is surfaced, never hidden', () => {
  it('flags a screen run against rules nobody has re-checked', () => {
    const r = toBoardRow(row({
      screen: { status: 'REVIEW_NEEDED', inRpa: false, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2024-01-01' },
    }), TODAY);
    expect(r.staleRulesetNote).toMatch(/last checked \d+ days ago/i);
  });

  it('says so when the screen did not record which rules it used', () => {
    const r = toBoardRow(row({
      screen: { status: 'REVIEW_NEEDED', inRpa: false, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: null },
    }), TODAY);
    expect(r.staleRulesetNote).toMatch(/did not record which version/i);
  });

  it('stays quiet on a fresh ruleset, and on a property with no screen', () => {
    expect(toBoardRow(row(), TODAY).staleRulesetNote).toBeNull();
    // No screen means there is no ruleset age to talk about — the loud thing
    // there is the missing screen itself, and a second note would dilute it.
    expect(toBoardRow(row({ screen: null }), TODAY).staleRulesetNote).toBeNull();
  });

  it('the threshold is the documented one', () => {
    const justInside = new Date(Date.parse(`${TODAY}T00:00:00Z`) - (RULESET_STALE_DAYS - 1) * 86_400_000)
      .toISOString().slice(0, 10);
    expect(toBoardRow(row({
      screen: { status: 'REVIEW_NEEDED', inRpa: false, overlays: [], ranAt: TODAY, rulesetLastVerified: justInside },
    }), TODAY).staleRulesetNote).toBeNull();
  });
});

describe('the board sorts so the thing that bites today is first', () => {
  const board = () => buildPermitBoard([
    row({ propertyId: 'resolved', addressLabel: 'Z resolved', status: 'approved' }),
    row({ propertyId: 'clean', addressLabel: 'C clean' }),
    row({ propertyId: 'unscreened', addressLabel: 'U unscreened', screen: null }),
    row({
      propertyId: 'blocked-late', addressLabel: 'B late', scheduledFor: '2026-08-20',
      screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
    }),
    row({
      propertyId: 'blocked-soon', addressLabel: 'A soon', scheduledFor: '2026-08-04',
      screen: { status: 'REVIEW_NEEDED', inRpa: false, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
    }),
  ], TODAY);

  it('blocked jobs come first, soonest crew arrival at the top', () => {
    const b = board();
    expect(b.rows[0]!.propertyId).toBe('blocked-soon');
    expect(b.rows[1]!.propertyId).toBe('blocked-late');
  });

  it('never-screened outranks everything except a blocked crew', () => {
    expect(board().rows[2]!.propertyId).toBe('unscreened');
  });

  it('resolved sinks to the bottom', () => {
    const b = board();
    expect(b.rows[b.rows.length - 1]!.propertyId).toBe('resolved');
  });

  it('counts the two numbers that matter, and the summary carries no address', () => {
    const b = board();
    expect(b.blockedCount).toBe(2);
    expect(b.neverScreenedCount).toBe(1);
    expect(b.summary).toMatch(/2 booked-but-blocked/);
    expect(b.summary).toMatch(/1 never screened/);
    // §4.3 — the summary line is safe to log.
    expect(b.summary).not.toMatch(/Sim Row|unscreened|Z resolved/);
  });

  it('an empty board says zero without pretending it screened anything', () => {
    const b = buildPermitBoard([], TODAY);
    expect(b.rows).toEqual([]);
    expect(b.blockedCount).toBe(0);
    expect(b.summary).toMatch(/^0 properties/);
  });

  it('every bucket has a label — no undefined headings on the tab', () => {
    for (const r of board().rows) expect(BUCKET_LABEL[r.bucket]).toBeTruthy();
  });
});

describe('the board and the crew door cannot drift apart', () => {
  it('clearance goes through the existing gate, including the null case', () => {
    expect(boardClearance(row({ screen: null })).mayStart).toBe(false);
    expect(boardClearance(row({
      screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
    })).mayStart).toBe(false);
    expect(boardClearance(row({
      status: 'approved',
      screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
    })).mayStart).toBe(true);
    // A clean screen was never gated to begin with.
    expect(boardClearance(row()).mayStart).toBe(true);
  });
});

describe('no row on a permitting screen can read as permission (§6B.3)', () => {
  const everything = buildPermitBoard([
    row({ screen: null }),
    row(),
    row({ screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' } }),
    row({ screen: { status: 'REVIEW_NEEDED', inRpa: false, overlays: [CBPA], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' }, scheduledFor: '2026-08-04' }),
    row({ status: 'applied' }),
    row({ status: 'approved' }),
    row({ status: 'not_required_verified' }),
  ], TODAY);

  it('passes the structural assertion on every reachable row', () => {
    expect(() => assertBoardNeverClear(everything)).not.toThrow();
  });

  it('the assertion bites', () => {
    const tampered = {
      ...everything,
      rows: [{ ...everything.rows[0]!, headline: "You're clear.", nextStep: 'Nothing outstanding.' }],
    };
    expect(() => assertBoardNeverClear(tampered)).toThrow(/forbidden/i);
  });

  it('a quiet-looking row that stops pointing at a human is caught', () => {
    const quiet = everything.rows.find((r) => r.bucket === 'no_overlay_verify')!;
    const tampered = {
      ...everything,
      rows: [{ ...quiet, headline: 'Nothing found.', nextStep: 'Carry on.' }],
    };
    expect(() => assertBoardNeverClear(tampered)).toThrow(/point at a human/i);
  });

  it('never uses the forbidden vocabulary anywhere', () => {
    for (const r of everything.rows) {
      expect(`${r.headline} ${r.nextStep}`).not.toMatch(/no permit (needed|required)|all clear|you'?re clear|good to (go|cut)/i);
    }
  });
});
