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
// The money loop (brief §4.8, §5B, §3). Pure and deterministic: given the
// pipeline state and "now", it says what should be invoiced and which invoices
// have gone quiet. It never sends anything and it never sets a price.
//
// Four laws this module carries, all as CODE and not prose:
//   §3  Arbo NEVER prices. (OWNER RULING R3 — docs/OWNER_RULINGS.md.) An invoice amount is the figure the CUSTOMER already
//       agreed to on the signed estimate. No agreed figure on file → NO draft,
//       and the reason is named. Arbo does not "estimate" what to bill.
//   §4.8 The late fee is capped at 5%. Virginia makes the 20% figure that
//       appears on old paper terms unlawful to charge, so 5% is a hard ceiling
//       here, in the repository, and in the DB CHECK — three layers deep.
//   §4  Every outbound nudge passes the same gates as the rest of the app:
//       consent on file, not on the STOP list, inside 8am–9pm America/New_York.
//   §1B An invoice whose state cannot be computed (sent with no sent date) is
//       reported as UNKNOWN. It is never quietly counted as current.
//
// Nothing here can collect money, charge a card, or threaten anyone. Every
// output is a recommendation for Mike (§5B #1).

import { clampToQuietHours } from './followUps.js';
import type { LegalConfig } from '../config/legal.schema.js';

/** §4.8: the ceiling. Nothing in Arbo may propose a late fee above this. */
export const VA_LATE_FEE_CAP_PCT = 5;

/** Default payment terms when the job carries none. */
export const DEFAULT_NET_DAYS = 14;

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export interface InvoiceableJob {
  jobId: string;
  name?: string;
  /** Completed work is the only thing that can be billed. */
  completedAtIso: string | null;
  /** The figure the customer AGREED to. Arbo never invents this. */
  agreedAmount: number | null;
  hasInvoice: boolean;
}

export interface InvoiceDraft {
  jobId: string;
  name?: string;
  /** Straight from the agreed estimate — never computed by Arbo. */
  amount: number;
  /** Always ≤ VA_LATE_FEE_CAP_PCT. */
  lateFeePct: number;
  netDays: number;
  /** ALWAYS true: Arbo drafts, Mike sends. */
  recommendOnly: true;
}

export type UndraftableReason = 'not_completed' | 'no_agreed_amount' | 'already_invoiced';

export interface UndraftableJob {
  jobId: string;
  name?: string;
  reason: UndraftableReason;
  /** Plain-language line for the admin surface. */
  line: string;
}

const UNDRAFTABLE_LINE: Record<UndraftableReason, string> = {
  not_completed: 'Job is not marked complete — nothing to bill yet.',
  no_agreed_amount: 'No agreed figure on file for this job. Arbo does not set prices — put the signed number on the job and the draft appears.',
  already_invoiced: 'An invoice already exists for this job.',
};

/**
 * Clamp any proposed late fee to the Virginia-safe ceiling. Called on every
 * path that can write one; the DB CHECK is the last line, not the first.
 */
export function safeLateFeePct(requested?: number | null): number {
  if (requested == null || !Number.isFinite(requested) || requested < 0) return VA_LATE_FEE_CAP_PCT;
  return Math.min(requested, VA_LATE_FEE_CAP_PCT);
}

/**
 * Build invoice drafts for completed work. A job with no agreed figure is
 * REPORTED, never guessed at — that is the §3 no-pricing rule applied to the
 * one place it would be most tempting to break.
 */
export function buildInvoiceDrafts(
  jobs: InvoiceableJob[],
  opts: { lateFeePct?: number; netDays?: number } = {},
): { drafts: InvoiceDraft[]; blocked: UndraftableJob[] } {
  const drafts: InvoiceDraft[] = [];
  const blocked: UndraftableJob[] = [];
  const lateFeePct = safeLateFeePct(opts.lateFeePct);
  const netDays = opts.netDays && opts.netDays > 0 ? Math.floor(opts.netDays) : DEFAULT_NET_DAYS;

  for (const j of jobs) {
    const reason: UndraftableReason | null = j.hasInvoice
      ? 'already_invoiced'
      : !j.completedAtIso
        ? 'not_completed'
        : j.agreedAmount == null || !(j.agreedAmount > 0)
          ? 'no_agreed_amount'
          : null;
    if (reason) {
      // "already_invoiced" is bookkeeping noise, not a decision Mike owes.
      if (reason !== 'already_invoiced') {
        blocked.push({ jobId: j.jobId, name: j.name, reason, line: UNDRAFTABLE_LINE[reason] });
      }
      continue;
    }
    drafts.push({
      jobId: j.jobId, name: j.name, amount: j.agreedAmount!, lateFeePct, netDays, recommendOnly: true,
    });
  }
  return { drafts, blocked };
}

export interface OpenInvoice {
  id: string;
  jobId: string;
  name?: string;
  phone?: string;
  amount: number;
  lateFeePct: number;
  status: InvoiceStatus;
  sentAtIso: string | null;
  paidAtIso: string | null;
  netDays?: number;
  consentOnFile?: boolean;
  suppressed?: boolean;
}

const DAY = 86_400_000;

/** When payment is due, or null when the invoice was never actually sent. */
export function dueDateIso(inv: Pick<OpenInvoice, 'sentAtIso' | 'netDays'>): string | null {
  if (!inv.sentAtIso) return null;
  const sent = Date.parse(inv.sentAtIso);
  if (!Number.isFinite(sent)) return null;
  return new Date(sent + (inv.netDays ?? DEFAULT_NET_DAYS) * DAY).toISOString();
}

/**
 * The invoice's REAL state right now. A stored status of 'sent' says nothing
 * about whether the clock has run out — this derives that. Returns null when
 * the state genuinely cannot be computed, so the caller reports UNKNOWN
 * instead of assuming current (§1B).
 */
export function derivedStatus(inv: OpenInvoice, nowIso: string): InvoiceStatus | null {
  if (inv.status === 'paid' || inv.status === 'void' || inv.status === 'draft') return inv.status;
  const due = dueDateIso(inv);
  if (!due) return null; // marked sent, but no send date — unknowable
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return null;
  return Date.parse(due) < now ? 'overdue' : 'sent';
}

/** Days past due, floored at 0. Null when the due date is unknowable. */
export function daysOverdue(inv: OpenInvoice, nowIso: string): number | null {
  const due = dueDateIso(inv);
  if (!due) return null;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - Date.parse(due)) / DAY));
}

/**
 * The late fee actually owed today. Zero until the invoice is genuinely past
 * due, and never above the 5% ceiling however the row was stored.
 */
export function lateFeeOwed(inv: OpenInvoice, nowIso: string): number {
  const over = daysOverdue(inv, nowIso);
  if (over == null || over <= 0) return 0;
  return Math.round(inv.amount * (safeLateFeePct(inv.lateFeePct) / 100) * 100) / 100;
}

export type CollectionStage = 'reminder' | 'second_notice' | 'final_notice';

export interface CollectionAction {
  invoiceId: string;
  jobId: string;
  name?: string;
  stage: CollectionStage;
  daysOverdue: number;
  /** What to say — for Mike's queue, never an auto-send body. */
  note: string;
  /** Earliest legal contact time, already clamped into quiet hours. */
  scheduledFor: string;
  /** ALWAYS true — Arbo recommends, Mike acts (§5B #1). */
  recommendOnly: true;
}

export interface SuppressedCollection {
  invoiceId: string;
  reason: 'stop_suppressed' | 'no_consent';
}

export interface UnknownInvoice {
  invoiceId: string;
  line: string;
}

export interface CollectionQueue {
  due: CollectionAction[];
  suppressed: SuppressedCollection[];
  /** Invoices whose state could not be computed — named, never assumed fine. */
  unknown: UnknownInvoice[];
}

function stageFor(days: number): CollectionStage {
  if (days >= 21) return 'final_notice';
  if (days >= 7) return 'second_notice';
  return 'reminder';
}

// Deliberately plain. No threat, no legal language, no promise of a date, no
// figure — the amount is on the invoice Mike is looking at, not in the nudge.
const STAGE_NOTE: Record<CollectionStage, string> = {
  reminder: 'Invoice is past due — a friendly check-in that it landed.',
  second_notice: 'Still unpaid after two weeks. Worth a direct call rather than another message.',
  final_notice: 'Three weeks past due. This one needs you personally — decide whether to keep pursuing it or write it off.',
};

/**
 * Which overdue invoices need Mike's attention, worst first. Same legal gates
 * as every other outbound path; nothing here sends, charges, or threatens.
 */
export function buildCollectionQueue(
  legal: LegalConfig,
  invoices: OpenInvoice[],
  now: Date,
): CollectionQueue {
  const due: CollectionAction[] = [];
  const suppressed: SuppressedCollection[] = [];
  const unknown: UnknownInvoice[] = [];
  const nowIso = now.toISOString();
  const scheduledFor = clampToQuietHours(legal, now).toISOString();

  for (const inv of invoices) {
    const state = derivedStatus(inv, nowIso);
    if (state === null) {
      unknown.push({
        invoiceId: inv.id,
        line: 'Marked sent but carries no send date — Arbo cannot tell whether this one is overdue.',
      });
      continue;
    }
    if (state !== 'overdue') continue;

    if (inv.suppressed) { suppressed.push({ invoiceId: inv.id, reason: 'stop_suppressed' }); continue; }
    if (inv.consentOnFile === false) { suppressed.push({ invoiceId: inv.id, reason: 'no_consent' }); continue; }

    const days = daysOverdue(inv, nowIso) ?? 0;
    const stage = stageFor(days);
    due.push({
      invoiceId: inv.id, jobId: inv.jobId, name: inv.name, stage, daysOverdue: days,
      note: STAGE_NOTE[stage], scheduledFor, recommendOnly: true,
    });
  }

  // Worst first: the oldest debt is the one most likely to never be paid.
  due.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { due, suppressed, unknown };
}
