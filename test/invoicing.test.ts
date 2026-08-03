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
  buildInvoiceDrafts, buildCollectionQueue, derivedStatus, daysOverdue, lateFeeOwed,
  safeLateFeePct, dueDateIso, VA_LATE_FEE_CAP_PCT, DEFAULT_NET_DAYS,
  type InvoiceableJob, type OpenInvoice,
} from '../src/ops/invoicing.js';
import { findOpenLoops, type LoopSnapshot } from '../src/ops/loopCloser.js';
import { loadLegal } from '../src/config/loadConfig.js';

const legal = loadLegal();

const job = (over: Partial<InvoiceableJob> = {}): InvoiceableJob => ({
  jobId: 'j1', name: 'A. Customer', completedAtIso: '2026-07-01T18:00:00Z',
  agreedAmount: 4500, hasInvoice: false, ...over,
});

describe('§3 — Arbo never sets a price', () => {
  it('drafts only the figure the customer already agreed to', () => {
    const { drafts } = buildInvoiceDrafts([job()]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.amount).toBe(4500);
    expect(drafts[0]!.recommendOnly).toBe(true);
  });

  it('refuses to invent an amount when no agreed figure is on file', () => {
    const { drafts, blocked } = buildInvoiceDrafts([job({ agreedAmount: null })]);
    expect(drafts).toEqual([]);
    expect(blocked[0]!.reason).toBe('no_agreed_amount');
    expect(blocked[0]!.line).toMatch(/does not set prices/i);
  });

  it('treats a zero or negative agreed figure as no figure at all', () => {
    expect(buildInvoiceDrafts([job({ agreedAmount: 0 })]).drafts).toEqual([]);
    expect(buildInvoiceDrafts([job({ agreedAmount: -100 })]).drafts).toEqual([]);
  });

  it('never bills work that is not finished', () => {
    const { drafts, blocked } = buildInvoiceDrafts([job({ completedAtIso: null })]);
    expect(drafts).toEqual([]);
    expect(blocked[0]!.reason).toBe('not_completed');
  });

  it('does not re-draft a job that already has an invoice, and does not nag about it', () => {
    const { drafts, blocked } = buildInvoiceDrafts([job({ hasInvoice: true })]);
    expect(drafts).toEqual([]);
    expect(blocked).toEqual([]);
  });
});

describe('§4.8 — the 5% Virginia late-fee ceiling is structural', () => {
  it('clamps anything above the cap, however it arrives', () => {
    expect(safeLateFeePct(20)).toBe(VA_LATE_FEE_CAP_PCT);
    expect(safeLateFeePct(5.01)).toBe(VA_LATE_FEE_CAP_PCT);
    expect(safeLateFeePct(2)).toBe(2);
  });

  it('falls back to the cap — never higher — on garbage input', () => {
    for (const bad of [undefined, null, NaN, Infinity, -3]) {
      expect(safeLateFeePct(bad as number)).toBeLessThanOrEqual(VA_LATE_FEE_CAP_PCT);
    }
  });

  it('a draft can never carry a fee above the cap even when one is requested', () => {
    const { drafts } = buildInvoiceDrafts([job()], { lateFeePct: 20 });
    expect(drafts[0]!.lateFeePct).toBe(VA_LATE_FEE_CAP_PCT);
  });
});

const inv = (over: Partial<OpenInvoice> = {}): OpenInvoice => ({
  id: 'i1', jobId: 'j1', name: 'A. Customer', amount: 1000, lateFeePct: 5,
  status: 'sent', sentAtIso: '2026-07-01T12:00:00Z', paidAtIso: null,
  netDays: 14, ...over,
});

const NOW = '2026-08-02T12:00:00Z'; // 32 days after the send above

describe('invoice state is computed, not assumed', () => {
  it('derives overdue from the send date and the terms', () => {
    expect(derivedStatus(inv(), NOW)).toBe('overdue');
    expect(daysOverdue(inv(), NOW)).toBe(18);
    expect(derivedStatus(inv({ sentAtIso: '2026-08-01T12:00:00Z' }), NOW)).toBe('sent');
  });

  it('defaults the terms honestly when the row carries none', () => {
    expect(dueDateIso({ sentAtIso: '2026-07-01T12:00:00Z' }))
      .toBe(new Date(Date.parse('2026-07-01T12:00:00Z') + DEFAULT_NET_DAYS * 86400_000).toISOString());
  });

  it('a paid or void invoice is never chased', () => {
    expect(derivedStatus(inv({ status: 'paid' }), NOW)).toBe('paid');
    expect(derivedStatus(inv({ status: 'void' }), NOW)).toBe('void');
  });

  it('§1B — "sent" with no send date is UNKNOWN, not current', () => {
    expect(derivedStatus(inv({ sentAtIso: null }), NOW)).toBeNull();
    expect(daysOverdue(inv({ sentAtIso: null }), NOW)).toBeNull();
  });

  it('the late fee is zero until the invoice is genuinely past due', () => {
    expect(lateFeeOwed(inv({ sentAtIso: '2026-08-01T12:00:00Z' }), NOW)).toBe(0);
    expect(lateFeeOwed(inv(), NOW)).toBe(50); // 5% of 1000
  });

  it('a stored fee above the cap is still charged at the cap', () => {
    expect(lateFeeOwed(inv({ lateFeePct: 20 }), NOW)).toBe(50);
  });
});

describe('collections — recommend-only, gated, and never a threat', () => {
  it('stages by how long the money has been out, worst first', () => {
    const q = buildCollectionQueue(legal, [
      inv({ id: 'fresh', sentAtIso: '2026-07-17T12:00:00Z' }),  // ~2d over
      inv({ id: 'old', sentAtIso: '2026-06-20T12:00:00Z' }),    // ~29d over
      inv({ id: 'mid', sentAtIso: '2026-07-09T12:00:00Z' }),    // ~10d over
    ], new Date(NOW));
    expect(q.due.map((a) => a.invoiceId)).toEqual(['old', 'mid', 'fresh']);
    expect(q.due.map((a) => a.stage)).toEqual(['final_notice', 'second_notice', 'reminder']);
  });

  it('carries no dollar figure, no threat, and no promised date', () => {
    const q = buildCollectionQueue(legal, [inv()], new Date(NOW));
    const text = JSON.stringify(q.due).toLowerCase();
    expect(text).not.toMatch(/\$\s?\d/);
    for (const forbidden of ['lawyer', 'legal action', 'collections agency', 'lien', 'court', 'sue']) {
      expect(text, `collections copy threatened: "${forbidden}"`).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/we (will|'ll) (be|come|arrive)/);
    expect(q.due[0]!.recommendOnly).toBe(true);
  });

  it('honours STOP and missing consent, naming the reason', () => {
    const q = buildCollectionQueue(legal, [
      inv({ id: 'stopped', suppressed: true }),
      inv({ id: 'nocon', consentOnFile: false }),
    ], new Date(NOW));
    expect(q.due).toEqual([]);
    expect(q.suppressed.map((s) => s.reason).sort()).toEqual(['no_consent', 'stop_suppressed']);
  });

  it('schedules inside quiet hours — never at 3am', () => {
    const q = buildCollectionQueue(legal, [inv()], new Date('2026-08-02T07:00:00Z')); // 3am ET
    const hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false,
    }).format(new Date(q.due[0]!.scheduledFor)));
    expect(hour).toBeGreaterThanOrEqual(8);
    expect(hour).toBeLessThan(21);
  });

  it('reports an uncomputable invoice as UNKNOWN rather than skipping it silently', () => {
    const q = buildCollectionQueue(legal, [inv({ sentAtIso: null })], new Date(NOW));
    expect(q.due).toEqual([]);
    expect(q.unknown[0]!.line).toMatch(/cannot tell whether this one is overdue/i);
  });

  it('leaves invoices that are not yet due alone', () => {
    const q = buildCollectionQueue(legal, [inv({ sentAtIso: '2026-08-01T12:00:00Z' })], new Date(NOW));
    expect(q.due).toEqual([]);
    expect(q.unknown).toEqual([]);
  });
});

describe('§1E — finished work that was never billed is an open loop', () => {
  const snap = (jobs: LoopSnapshot['jobs']): LoopSnapshot => ({
    nowIso: NOW, estimates: [], leads: [], jobs,
  });

  it('raises the loop once the work has been done long enough', () => {
    const out = findOpenLoops(snap([
      { id: 'j1', scheduledIso: null, status: 'completed', completedAtIso: '2026-07-20T12:00:00Z', hasInvoice: false },
    ]));
    expect(out.map((o) => o.kind)).toContain('work_done_never_billed');
    expect(out[0]!.severity).toBe('urgent');
  });

  it('stays quiet when the job HAS an invoice', () => {
    const out = findOpenLoops(snap([
      { id: 'j1', scheduledIso: null, status: 'completed', completedAtIso: '2026-07-20T12:00:00Z', hasInvoice: true },
    ]));
    expect(out).toEqual([]);
  });

  it('§1B — an invoice check that could not run does not accuse anyone', () => {
    const out = findOpenLoops(snap([
      { id: 'j1', scheduledIso: null, status: 'completed', completedAtIso: '2026-07-20T12:00:00Z' },
    ]));
    expect(out).toEqual([]);
  });
});
