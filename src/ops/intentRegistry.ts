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
// The intent REGISTRY: which intents exist, which threads Mike re-labeled,
// and which new intents the classifier is PROPOSING. This is the whole
// learn-and-adapt surface, and it is human-in-the-loop by construction:
// the classifier can propose, Mike approves — nothing in here changes what
// the classifier recognises without his tap (brief: autonomous self-learning
// is CUT; Mike decides).
//
// ═══ WHAT SURVIVES A REDEPLOY, HONESTLY (§1B for state) ═══
// Approved-durable intents come from src/policy/inboxIntents.json, committed
// to the repo like guardrails.json. Everything Mike does IN the app —
// approvals, rejections, re-labels — lives in process memory, because the
// data links are cut (§3) and there is nowhere durable to put it. That is
// not hidden: every runtime item carries `durable: false`, the export
// endpoint hands back exactly what needs committing, and the UI says so.
// Pretending an in-memory approval will outlive a redeploy would be the
// §1B lie applied to settings.
//
// ═══ WHAT IS STORED IS IDS, NEVER MAIL (§4.3 / R4) ═══
// A correction is (threadId → intent). A proposal holds thread IDS as its
// examples — the app fetches the mail from Gmail when Mike taps, it is not
// copied here. Nothing in this file can leak a customer because nothing in
// this file ever holds one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CORE_INTENTS } from './inboxIntent.js';

export interface IntentDef {
  id: string;
  label: string;
  description: string;
  /** false = approved in-app since the last deploy; lost on restart until committed. */
  durable: boolean;
}

export interface IntentProposal {
  /** Normalised proposal key (the model's label, lowercased). */
  id: string;
  label: string;
  /** 2–3 example threads, ids only. The proposal exists once there are 2. */
  exampleThreadIds: string[];
  /** How many sightings in total, including beyond the kept examples. */
  sightings: number;
  firstSeenIso: string;
}

interface PolicyFileShape {
  version: string;
  approved: { id: string; label: string; description: string }[];
}

const here = dirname(fileURLToPath(import.meta.url));

/** Same loader discipline as loadConfig.ts: read from src/, throw loudly. */
export function loadDurableIntents(): PolicyFileShape {
  const abs = resolve(here, '..', 'policy/inboxIntents.json');
  const parsed = JSON.parse(readFileSync(abs, 'utf8')) as PolicyFileShape;
  if (typeof parsed.version !== 'string' || !Array.isArray(parsed.approved)) {
    throw new Error('Invalid policy/inboxIntents.json: needs {version, approved[]}');
  }
  return parsed;
}

/** A proposal becomes visible to Mike at this many distinct threads. */
export const PROPOSAL_MIN_SIGHTINGS = 2;
const PROPOSAL_EXAMPLE_CAP = 3;
const CORRECTIONS_CAP = 500;

/**
 * A correction, made teachable: the intent Mike chose plus one REDACTED line
 * of the thread he chose it on. Redacted before it arrives here (the
 * orchestrator runs redact()), bounded, in-memory — this is the "corrections
 * are fed back as examples" half of learn-and-adapt, without storing a
 * customer anywhere.
 */
export interface CorrectionExample {
  intent: string;
  snippetRedacted: string;
}

const EXAMPLES_CAP = 30;

export class IntentRegistry {
  private readonly runtime: IntentDef[] = [];
  private readonly rejected = new Set<string>();
  /** threadId → intent id, or 'ignored'. Insertion-ordered for the cap. */
  private readonly corrections = new Map<string, string>();
  private readonly proposals = new Map<string, IntentProposal>();
  private readonly exampleList: CorrectionExample[] = [];

  constructor(private readonly durable: PolicyFileShape = loadDurableIntents()) {}

  /** Every intent the classifier may currently use, core first. */
  intents(): IntentDef[] {
    return [
      ...CORE_INTENTS.map((i) => ({ ...i, durable: true })),
      ...this.durable.approved.map((i) => ({ ...i, durable: true })),
      ...this.runtime,
    ];
  }

  /**
   * One sighting of "matters but fits nothing". Groups by the model's label;
   * never creates an intent — only a proposal for Mike.
   */
  observe(proposedLabel: string, threadId: string, nowIso: string): void {
    const id = proposedLabel.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 40);
    if (!id || this.rejected.has(id)) return;
    if (this.intents().some((i) => i.id === id)) return; // already an intent
    const existing = this.proposals.get(id);
    if (existing) {
      existing.sightings++;
      if (!existing.exampleThreadIds.includes(threadId) && existing.exampleThreadIds.length < PROPOSAL_EXAMPLE_CAP) {
        existing.exampleThreadIds.push(threadId);
      }
      return;
    }
    this.proposals.set(id, {
      id,
      label: proposedLabel.trim().slice(0, 60),
      exampleThreadIds: [threadId],
      sightings: 1,
      firstSeenIso: nowIso,
    });
  }

  /** Proposals ready for Mike (≥ 2 distinct example threads). */
  pendingProposals(): IntentProposal[] {
    return [...this.proposals.values()].filter(
      (p) => p.exampleThreadIds.length >= PROPOSAL_MIN_SIGHTINGS,
    );
  }

  /**
   * Mike's tap: the proposal becomes a live intent — in memory. Returns the
   * new def (durable:false) or null when no such proposal exists. Renaming
   * is approving with a different label.
   */
  approve(proposalId: string, label?: string): IntentDef | null {
    const p = this.proposals.get(proposalId);
    if (!p) return null;
    this.proposals.delete(proposalId);
    const def: IntentDef = {
      id: p.id,
      label: label?.trim() || p.label,
      description: `Approved by Mike in-app. ${p.label}.`,
      durable: false,
    };
    this.runtime.push(def);
    return def;
  }

  /** Mike's other tap. A rejected label stops being proposed again. */
  reject(proposalId: string): boolean {
    if (!this.proposals.has(proposalId)) return false;
    this.proposals.delete(proposalId);
    this.rejected.add(proposalId);
    return true;
  }

  /**
   * One-tap re-label of a surfaced or ignored thread. 'ignored' is valid.
   * Any other value must be a known intent id — an unknown one is refused
   * rather than minting an intent by side effect (that would be the
   * autonomous learning the brief cuts).
   */
  relabel(threadId: string, intent: string): boolean {
    if (intent !== 'ignored' && !this.intents().some((i) => i.id === intent)) return false;
    // Re-insert so the cap evicts the OLDEST correction, not the freshest.
    this.corrections.delete(threadId);
    this.corrections.set(threadId, intent);
    while (this.corrections.size > CORRECTIONS_CAP) {
      const oldest = this.corrections.keys().next().value;
      if (oldest === undefined) break;
      this.corrections.delete(oldest);
    }
    return true;
  }

  correctionFor(threadId: string): string | null {
    return this.corrections.get(threadId) ?? null;
  }

  /** Newest-first, bounded. The snippet must arrive already redacted. */
  addExample(ex: CorrectionExample): void {
    this.exampleList.unshift(ex);
    while (this.exampleList.length > EXAMPLES_CAP) this.exampleList.pop();
  }

  examples(): CorrectionExample[] {
    return [...this.exampleList];
  }

  /**
   * Everything that would be lost on a redeploy, shaped for committing into
   * policy/inboxIntents.json. The UI links here so Mike (or a build session)
   * can make an in-app approval durable.
   */
  exportPending(): {
    approvedPendingCommit: IntentDef[];
    corrections: { threadId: string; intent: string }[];
  } {
    return {
      approvedPendingCommit: [...this.runtime],
      corrections: [...this.corrections.entries()].map(([threadId, intent]) => ({ threadId, intent })),
    };
  }
}
