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
// Agent — Collections (brief §4.8, §5B, §8A.5). Watches invoices that have
// gone quiet and raises them onto the event bus so the money loop closes the
// same way the lead loop does. Deterministic; every gate is the same one the
// rest of the app uses.
//
// What this agent structurally CANNOT do: charge anything, send anything, or
// threaten anyone. It raises `invoice.overdue` events and stops. Mike decides.
//
// §1B: an invoice whose state cannot be computed is counted as UNKNOWN and
// reported, never folded into "nothing overdue".

import { buildCollectionQueue, type OpenInvoice } from '../ops/invoicing.js';
import { loadLegal } from '../config/loadConfig.js';
import { startAgentRun } from '../binder/agentRun.js';
import { emitSafe } from '../binder/eventBus.js';
import { getDb, hasDb } from '../db/client.js';
import { env } from '../env.js';

export interface CollectionsAgentResult {
  agent: 'collections';
  feed: 'ok' | 'unavailable';
  overdue: number;
  newlyRaised: number;
  suppressed: number;
  /** Invoices Arbo could not evaluate — named, never assumed current. */
  unknown: number;
  llm: 'not_configured' | 'available';
  status: 'ok' | 'error';
}

/** Invoice ids already raised in the trailing window (dedupe, same as weather). */
async function alreadyRaised(now: Date): Promise<Set<string>> {
  if (!hasDb()) return new Set();
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const res = await getDb()
    .from('event')
    .select('payload')
    .eq('type', 'invoice.overdue')
    .gte('emitted_at', since);
  if (res.error) return new Set(); // a failed dedupe read must not block raising
  const out = new Set<string>();
  for (const r of res.data ?? []) {
    const p = r.payload as { invoiceId?: string; stage?: string };
    // Keyed by invoice AND stage: an invoice that escalates from reminder to
    // final notice is a NEW fact and must surface again, not be deduped away.
    if (p.invoiceId) out.add(`${p.invoiceId}:${p.stage ?? ''}`);
  }
  return out;
}

/**
 * Read every invoice that is not settled. `null` means the read FAILED — which
 * is different from "no open invoices" and is reported as such.
 */
async function openInvoices(): Promise<OpenInvoice[] | null> {
  if (!hasDb()) return null;
  const res = await getDb()
    .from('invoice')
    .select('id, job_id, amount, late_fee_pct, net_days, status, sent_at, paid_at')
    .in('status', ['sent', 'overdue']);
  if (res.error) return null;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    jobId: r.job_id as string,
    amount: Number(r.amount),
    lateFeePct: Number(r.late_fee_pct),
    netDays: Number(r.net_days ?? 14),
    status: r.status as OpenInvoice['status'],
    sentAtIso: (r.sent_at as string | null) ?? null,
    paidAtIso: (r.paid_at as string | null) ?? null,
  }));
}

export async function runCollectionsAgent(now = new Date()): Promise<CollectionsAgentResult> {
  const run = await startAgentRun({ agent: 'collections', modelUsed: env.anthropic.apiKey ? 'claude-opus-5' : undefined });
  const llm = env.anthropic.apiKey ? 'available' as const : 'not_configured' as const;
  const dead = (status: 'ok' | 'error'): CollectionsAgentResult => ({
    agent: 'collections', feed: 'unavailable', overdue: 0, newlyRaised: 0,
    suppressed: 0, unknown: 0, llm, status,
  });
  try {
    const invoices = await openInvoices();
    if (!invoices) {
      // A ledger we could not read is not a ledger with nothing overdue.
      await run.finish({ status: 'ok', outputSummary: `feed=unavailable llm=${llm}` });
      return dead('ok');
    }
    const queue = buildCollectionQueue(loadLegal(), invoices, now);
    const seen = await alreadyRaised(now);
    let raised = 0;
    for (const a of queue.due) {
      if (seen.has(`${a.invoiceId}:${a.stage}`)) continue;
      // No dollar figure on the bus — the amount lives on the invoice row, and
      // events are read by surfaces that must not leak money detail (§4.3).
      const ok = await emitSafe('invoice.overdue', {
        invoiceId: a.invoiceId, jobId: a.jobId, stage: a.stage, daysOverdue: a.daysOverdue,
      }, 'collections-agent');
      if (ok) raised++;
    }
    await run.finish({
      status: 'ok',
      outputSummary: `feed=ok overdue=${queue.due.length} newly_raised=${raised} suppressed=${queue.suppressed.length} unknown=${queue.unknown.length} llm=${llm}`,
    });
    return {
      agent: 'collections', feed: 'ok', overdue: queue.due.length, newlyRaised: raised,
      suppressed: queue.suppressed.length, unknown: queue.unknown.length, llm, status: 'ok',
    };
  } catch (err) {
    await run.finish({ status: 'error', outputSummary: err instanceof Error ? err.message : 'error' });
    return dead('error');
  }
}
