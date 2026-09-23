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
// The intent ORCHESTRATOR: the piece that sits on the inbox watch's observer
// hook and runs each new message through thread context, Mike's corrections,
// the fast path, and the Opus model — then files the outcome in the surface
// store. It never touches the watch's own report, never writes to Gmail, and
// never converts anything (a contract approval PROMPTS the estimate→job
// step; the tap is Mike's, and while the links are cut there is nothing to
// convert into anyway).

import type { InboxMessage, MessageOutcome } from './inboxWatch.js';
import { redact } from './inboxWatch.js';
import {
  decide,
  fastPathIntent,
  type GmailThreadReader,
  type IntentModel,
  type ThreadMessage,
} from './inboxIntent.js';
import { IntentRegistry } from './intentRegistry.js';
import { InboxSurfaceStore, type SurfacedItem } from './inboxSurface.js';
import { extractVaZip } from '../reception/routingHint.js';

export interface IntentWatchStatus {
  processed: number;
  modelCalls: number;
  /** Consecutive is what matters for alarming; total for the record. */
  modelFailures: number;
  consecutiveModelFailures: number;
  /** Error class only — a message body never rides an error (§4.3). */
  lastModelErrorName: string | null;
  threadFetchFailures: number;
  /** No model was configured at all (no API key) — every verdict is pattern-only. */
  modelConfigured: boolean;
}

/** From: display name and address, split. The name is a customer's (R17: UI only). */
function splitFrom(raw: string): { name?: string; email?: string } {
  const m = raw.trim().match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.trim(), email: m[2]!.trim().toLowerCase() };
  return raw.includes('@') ? { email: raw.trim().toLowerCase() } : {};
}

export class IntentWatch {
  private readonly status: IntentWatchStatus;
  /** Serial queue: one model call at a time, in arrival order. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly model: IntentModel | null,
    private readonly threadReader: GmailThreadReader | null,
    readonly registry: IntentRegistry,
    readonly store: InboxSurfaceStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.status = {
      processed: 0,
      modelCalls: 0,
      modelFailures: 0,
      consecutiveModelFailures: 0,
      lastModelErrorName: null,
      threadFetchFailures: 0,
      modelConfigured: model !== null,
    };
  }

  /** Hand this to WatchOptions.onMessage. Synchronous by contract; the real
   *  work queues behind the previous message's. */
  observer = (msg: InboxMessage, outcome: MessageOutcome): void => {
    this.chain = this.chain
      .then(() => this.handle(msg, outcome))
      .catch((err) => {
        // The queue must survive anything one message does.
        console.error('[intent] message failed:', err instanceof Error ? err.name : 'error');
      });
  };

  /** Tests (and a graceful shutdown) can await the queue draining. */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  snapshotStatus(): IntentWatchStatus {
    return { ...this.status };
  }

  /**
   * Mike's one-tap re-label. Stores the correction (absolute from now on for
   * this thread), pulls the old card, and — when the thread is reachable —
   * folds a REDACTED one-line example back into the classifier so the next
   * similar mail is judged with his correction in view. The example is
   * redacted mail text held in memory, same exposure class as classification
   * itself; nothing durable, nothing in logs.
   */
  async relabel(threadId: string, intent: string): Promise<boolean> {
    if (!this.registry.relabel(threadId, intent)) return false;
    this.store.removeThread(threadId);
    if (this.threadReader && intent !== 'ignored') {
      try {
        const t = await this.threadReader.thread(threadId);
        if (t.ok && t.messages.length > 0) {
          const last = t.messages[t.messages.length - 1]!;
          this.registry.addExample({
            intent,
            snippetRedacted: redact(`${last.subject} — ${last.body}`).slice(0, 240),
          });
        }
      } catch {
        // The correction itself already stuck; the example is best-effort.
      }
    }
    return true;
  }

  private async handle(msg: InboxMessage, outcome: MessageOutcome): Promise<void> {
    const now = this.now();
    this.status.processed++;
    this.store.countRead(now);
    const threadId = msg.threadId ?? null;

    // Mike's channel toggle and the sweep's own city lane are decisions
    // already made — the model is not asked to second-guess them, and Opus
    // is not spent on HomeAdvisor marketing. Logged, reviewable, not shown.
    if (outcome.kind === 'channel_off') {
      this.store.addIgnored(
        {
          messageId: msg.id,
          threadId,
          reason: `Channel '${outcome.provider}' is switched off in Settings.`,
          receivedAtIso: msg.receivedAtIso,
        },
        now,
      );
      return;
    }
    if (outcome.kind === 'city') {
      this.store.addIgnored(
        {
          messageId: msg.id,
          threadId,
          reason: 'City permit correspondence — reported by the sweep, not a lead.',
          receivedAtIso: msg.receivedAtIso,
        },
        now,
      );
      return;
    }

    const fast = outcome.kind === 'lead' ? fastPathIntent(outcome.classification) : null;
    const correction = threadId ? this.registry.correctionFor(threadId) : null;

    // The thread, when we can get it — meaning lives in the replies. A
    // fetch failure quietly narrowing to one message would hide exactly the
    // "casual approval in an old thread" case, so it is counted.
    let thread: ThreadMessage[] = [
      { from: msg.from, subject: msg.subject, body: msg.body, receivedAtIso: msg.receivedAtIso },
    ];
    if (this.threadReader && threadId && correction === null) {
      try {
        const t = await this.threadReader.thread(threadId);
        if (t.ok && t.messages.length > 0) thread = t.messages;
        else if (!t.ok) this.status.threadFetchFailures++;
      } catch {
        this.status.threadFetchFailures++;
      }
    }

    // The model pass ALWAYS runs when a model exists (the prompt's rule) —
    // except behind a correction, where Mike has already answered.
    let verdict = null;
    if (this.model && correction === null) {
      this.status.modelCalls++;
      try {
        verdict = await this.model.classify(thread, this.registry.intents(), this.registry.examples());
        this.status.consecutiveModelFailures = 0;
      } catch (err) {
        this.status.modelFailures++;
        this.status.consecutiveModelFailures++;
        this.status.lastModelErrorName = err instanceof Error ? err.name : 'error';
        verdict = null;
      }
    }

    const d = decide(fast, verdict, correction);

    // The learn loop's raw material: matters, fits nothing, has a name.
    if (
      verdict &&
      verdict.intent === null &&
      verdict.matters &&
      verdict.proposedLabel &&
      threadId
    ) {
      this.registry.observe(verdict.proposedLabel, threadId, now.toISOString());
    }

    if (d.lane === 'ignore') {
      this.store.addIgnored(
        { messageId: msg.id, threadId, reason: d.reason, receivedAtIso: msg.receivedAtIso },
        now,
      );
      return;
    }

    const lead = outcome.kind === 'lead' ? outcome.classification.lead : undefined;
    const from = splitFrom(msg.from);
    const label = this.registry.intents().find((i) => i.id === d.intent)?.label ?? d.intent ?? 'Needs a look';
    const item: SurfacedItem = {
      messageId: msg.id,
      threadId,
      intent: d.intent ?? 'unclassified',
      intentLabel: label,
      confidence: d.lane === 'surface' ? 'high' : 'maybe',
      receivedAtIso: msg.receivedAtIso,
      reason: d.reason,
      // R17 card fields: the parsed lead wins; the raw headers back-fill.
      ...(lead?.name ?? from.name ? { name: lead?.name ?? from.name } : {}),
      ...(lead?.phone ? { phone: lead.phone } : {}),
      ...(lead?.email ?? from.email ? { email: lead?.email ?? from.email } : {}),
      // "always gather the ZIP code" (Cycle 39) — the form field first, else
      // the first VA ZIP anywhere in the mail.
      ...(zipOf(lead?.zip, msg) ? { zip: zipOf(lead?.zip, msg) } : {}),
      ...(lead?.address ? { address: lead.address } : {}),
      ...(lead?.details ? { details: lead.details } : {}),
      ...(lead?.source ? { source: lead.source } : {}),
      gmailLink: threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null,
      subjectHint: msg.subject.slice(0, 120),
      ...(d.intent === 'contract_approval' ? { contractApproval: true } : {}),
      ...(d.modelUnavailable ? { modelUnavailable: true } : {}),
    };

    if (d.lane === 'surface') this.store.addSurfaced(item, now);
    else this.store.addMaybe(item, now);
  }
}

function zipOf(fromLead: string | undefined, msg: InboxMessage): string | undefined {
  return fromLead ?? extractVaZip(`${msg.subject}\n${msg.body}`) ?? undefined;
}
