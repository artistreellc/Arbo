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
// R9 — the lead/job boundary. Mike, 2026-08-04. These tests are written from
// his sentences, one at a time, because the rule is his and the code is only
// carrying it.

import { describe, it, expect } from 'vitest';
import {
  authorizeBooking,
  splitByContract,
  assertEveryWorkOrderHasContract,
  jobStanding,
  LEAD_STAGES,
  type SignedContractOnFile,
  type LeadStage,
} from '../src/ops/jobBoundary.js';

const CONTRACT: SignedContractOnFile = {
  kind: 'signed_contract_on_file',
  contractId: 'c1',
  driveFileId: 'drive-signed-1',
  propertyId: 'p1',
};

describe('R9 — everything before a filed contract is a lead', () => {
  it('refuses EVERY lead stage Mike named, with no contract', () => {
    // "when a customer contacts us, initially, it is a lead. Then after they
    //  text me or email me, a signed proposal or I take a picture myself
    //  on-site, it is still simply just a lead."
    for (const stage of LEAD_STAGES) {
      const out = authorizeBooking({ propertyId: 'p1', stage, contract: null });
      expect(out.ok, `stage ${stage} must not book`).toBe(false);
      if (out.ok) continue;
      expect(out.stillALead).toBe(stage);
    }
  });

  it('a SIGNED PROPOSAL is still a lead, and says so in those words', () => {
    // The single most correctable point in the ruling: signing the proposal
    // does not make it money.
    const out = authorizeBooking({ propertyId: 'p1', stage: 'proposal_signed', contract: null });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/signed proposal is still a lead/i);
  });

  it("Mike's own site photos do not make it a job either", () => {
    const out = authorizeBooking({ propertyId: 'p1', stage: 'site_photographed', contract: null });
    expect(out.ok).toBe(false);
  });

  it('a filed contract — and only that — books it', () => {
    const out = authorizeBooking({ propertyId: 'p1', stage: 'proposal_signed', contract: CONTRACT });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.job.contractId).toBe('c1');
    expect(out.job.propertyId).toBe('p1');
  });

  it('a contract that was never FILED does not count', () => {
    // "Booked jobs are those contracts that you're putting in the signed
    //  contract file." Filed is the whole point.
    const out = authorizeBooking({
      propertyId: 'p1',
      stage: 'proposal_signed',
      contract: { ...CONTRACT, driveFileId: '   ' },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/not in the Signed Contracts file/i);
  });

  it("refuses a contract belonging to someone else's property", () => {
    const out = authorizeBooking({
      propertyId: 'p1',
      stage: 'proposal_signed',
      contract: { ...CONTRACT, propertyId: 'p2' },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/different property/i);
  });

  it('carries the estimate through when one is known', () => {
    const out = authorizeBooking({
      propertyId: 'p1', stage: 'proposal_signed',
      contract: { ...CONTRACT, estimateId: 'e9' },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.job.estimateId).toBe('e9');
  });

  it('there is no bypass — no force flag, no stage that self-books', () => {
    // Structural: if a future edit adds a shortcut, this is what notices. The
    // ONLY input that produced ok:true above was a non-null filed contract.
    const everyStage = LEAD_STAGES.map((stage: LeadStage) =>
      authorizeBooking({ propertyId: 'p1', stage, contract: null }).ok,
    );
    expect(everyStage).toEqual(LEAD_STAGES.map(() => false));
  });

  it('an unnamed property is refused even with a contract', () => {
    const out = authorizeBooking({ propertyId: '', stage: 'proposal_signed', contract: { ...CONTRACT, propertyId: '' } });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/no property/i);
  });
});

describe('R9 — jobStanding has exactly two states', () => {
  it('and neither of them is a maybe', () => {
    expect(jobStanding(true)).toBe('contract_on_file');
    expect(jobStanding(false)).toBe('no_contract_on_file');
  });
});

describe('R9 — the split names what it holds back', () => {
  const rows = [{ jobId: 'a' }, { jobId: 'b' }, { jobId: 'c' }];
  const filed = new Set(['a']);
  const has = (r: { jobId: string }) => filed.has(r.jobId);

  it('dispatches only contracted rows', () => {
    const s = splitByContract(rows, has);
    expect(s.workOrders.map((r) => r.jobId)).toEqual(['a']);
    expect(s.notWorkOrders.map((r) => r.jobId)).toEqual(['b', 'c']);
  });

  it('says how many it held back and why — never a silent short day', () => {
    const s = splitByContract(rows, has);
    expect(s.note).toContain('2 scheduled item(s)');
    expect(s.note).toMatch(/no signed contract on file/i);
    expect(s.note).toMatch(/still leads/i);
  });

  it('says nothing when there is nothing to say', () => {
    expect(splitByContract(rows, () => true).note).toBe('');
  });

  it('holds back everything when nothing is contracted — the production case', () => {
    // 11 job rows, 0 contracts. This is today's real database.
    const s = splitByContract(rows, () => false);
    expect(s.workOrders).toEqual([]);
    expect(s.notWorkOrders).toHaveLength(3);
  });
});

describe('R9 — the structural assertion', () => {
  it('passes when every work order has a contract', () => {
    expect(() => assertEveryWorkOrderHasContract([{ jobId: 'a' }], () => true)).not.toThrow();
  });

  it('THROWS rather than dispatch a crew on an uncontracted row', () => {
    // The failure this exists to make impossible, and it has already happened
    // once: a row reaching a crew phone with nothing behind it.
    expect(() => assertEveryWorkOrderHasContract([{ jobId: 'a' }], () => false))
      .toThrow(/no signed contract on file/i);
  });

  it('an empty day is fine — nothing scheduled is not a violation', () => {
    expect(() => assertEveryWorkOrderHasContract([], () => false)).not.toThrow();
  });
});
