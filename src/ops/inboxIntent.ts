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
// The inbox INTENT engine (R17 build, Mike's go: 2026-09-23 "yes to all of
// it use opus and build it"). Classifies mail by what it MEANS, on the whole
// thread, with the deterministic channel parsers kept as a fast path — the
// prompt's rule, verbatim: sender/subject rules may fast-path the known
// notification formats, "but the model classification must still run so an
// oddly-formatted one isn't dropped."
//
// ═══ WHERE THE MODEL SITS ═══
// `IntentModel` is injected, exactly like GmailReader and the GIS provider,
// so every decision in this file is testable offline. The live implementation
// is Opus (Mike's pick — CLAUDE.md: agents run on claude-opus-5, do not
// downgrade for cost). A model failure NEVER invents a verdict: `decide()`
// takes `verdict: null` and says so, and the pass is marked degraded upstream
// — §1B, "we couldn't ask the model" and "the model said no" are different
// facts.
//
// ═══ WHAT NEVER LEAVES THIS FILE ═══
// The model's `reason` strings can quote the mail they judged, so every
// reason is redact()ed before it is stored or logged. Customer contact
// fields ride ONLY on SurfacedItem (src/ops/inboxSurface.ts), which serves
// the keywall-gated app UI and never a log line — R17 rules the app surface,
// §4.3 still rules logs and chat.

import Anthropic from '@anthropic-ai/sdk';
import type { LeadMailProvider, LeadMailResult } from '../reception/leadMail.js';
import { redact } from './inboxWatch.js';

/** Same model as every other agent (CLAUDE.md; Mike re-confirmed 2026-09-23). */
export const INTENT_MODEL = 'claude-opus-5';

/**
 * The intents Mike approved in the build prompt, plus Yelp — the prompt's
 * table lists five, but ruling R12 keeps Yelp ON as a lead channel and the
 * brief wins on any conflict, so a Yelp lead surfaces rather than falling
 * into the ignore log by omission.
 */
export const CORE_INTENTS: ReadonlyArray<{ id: string; label: string; description: string }> = [
  {
    id: 'quote_request',
    label: 'Quote request',
    description:
      'A person directly asking for a quote, estimate, bid, or for someone to come look at a tree.',
  },
  {
    id: 'callrail',
    label: 'CallRail',
    description:
      'A CallRail call/text/voicemail/missed-call notification (Tree Leads Today / TSP trackers).',
  },
  {
    id: 'website_form',
    label: 'Website form',
    description: 'A contact-form submission notification from the artistreevabeach.com website.',
  },
  {
    id: 'ads_lsa_lead',
    label: 'Google Ads / LSA lead',
    description: 'A Google Ads lead-form submittal or a Local Services Ads lead notification.',
  },
  {
    id: 'yelp_lead',
    label: 'Yelp lead',
    description: 'A Yelp request-a-quote or message notification.',
  },
  {
    id: 'contract_approval',
    label: 'Contract approval',
    description:
      'The customer approving quoted work — often a plain, casual reply in an existing thread: "we approved your work", "go ahead", "let\'s do it", a signed work order.',
  },
];

/**
 * Fast path: the deterministic channel parsers already know these formats.
 * `direct_email` splits on which of Mike's two R12 rules matched — the
 * parser records that in `details`, and the work order is the stronger fact.
 */
export function fastPathIntent(c: LeadMailResult): string | null {
  if (!c.isLeadNotification || c.provider === null) return null;
  const map: Record<LeadMailProvider, string | null> = {
    callrail_call: 'callrail',
    callrail_web_form: 'callrail',
    website_form: 'website_form',
    google_ads_lead_form: 'ads_lsa_lead',
    lsa_call: 'ads_lsa_lead',
    yelp: 'yelp_lead',
    home_advisor: null, // channel is OFF — the watch already routed it away
    direct_email: /work order/i.test(c.lead.details ?? '') ? 'contract_approval' : 'quote_request',
  };
  return map[c.provider];
}

/** One message of a thread, as the model sees it. */
export interface ThreadMessage {
  from: string;
  subject: string;
  body: string;
  receivedAtIso: string;
}

/**
 * What the model returns. `intent: null` with `matters: true` is the
 * learn-and-adapt seed: "this looks like it needs Mike but I have no name
 * for it" — it becomes a PROPOSAL for Mike to approve, never a new intent
 * on its own (human-in-the-loop only; autonomous self-learning is cut).
 */
export interface ModelVerdict {
  intent: string | null;
  /** 0–1. Thresholds below turn this into surface / maybe / ignore. */
  confidence: number;
  matters: boolean;
  /** One line. Redacted before storage — the model may quote the mail. */
  reason: string;
  /** Only with intent:null + matters:true — the model's suggested name. */
  proposedLabel?: string;
}

/**
 * A whole thread, or the named reason we could not read it — §1B shape,
 * same as InboxRead. There is no `messages: []` on the failure arm.
 */
export type ThreadRead = { ok: true; messages: ThreadMessage[] } | { ok: false; reason: string };

/**
 * The thread door. ONE method, and it reads — same structural read-only
 * discipline as GmailReader (R4): an interface that cannot express a write
 * cannot drift into one.
 */
export interface GmailThreadReader {
  thread(threadId: string): Promise<ThreadRead>;
}

/** A redacted owner correction, shown to the model as a worked example. */
export interface IntentExample {
  intent: string;
  snippetRedacted: string;
}

/** The whole model surface. One method. It judges — it never writes. */
export interface IntentModel {
  classify(
    thread: ThreadMessage[],
    intents: ReadonlyArray<{ id: string; label: string; description: string }>,
    examples?: IntentExample[],
  ): Promise<ModelVerdict>;
}

/**
 * Surfacing thresholds, in one place. Above HIGH the item is shown as real;
 * between MAYBE and HIGH it is shown as "Maybe — check this" (the prompt:
 * low confidence is never silently dropped OR silently surfaced); below
 * MAYBE it is logged ignored with the model's reason.
 */
export const CONFIDENCE_HIGH = 0.8;
export const CONFIDENCE_MAYBE = 0.5;

export type Lane = 'surface' | 'maybe' | 'ignore';

export interface IntentDecision {
  lane: Lane;
  /** Set on surface/maybe. */
  intent?: string;
  /** Why, in one redacted line. Every lane carries one — misses are reviewable. */
  reason: string;
  /** True when the model could not be asked — the pass degrades upstream. */
  modelUnavailable: boolean;
}

/**
 * Combine the three voices: Mike's correction (absolute), the fast path
 * (anchored, format-known), and the model (thread-aware).
 *
 * Precedence, and why:
 * - A correction from Mike wins over everything — that is the whole point
 *   of one-tap re-labeling. `'ignored'` is a valid correction.
 * - Fast path and model agree, or only fast path fires → surface. A known
 *   notification format does not need the model's permission.
 * - Both fire and DISAGREE → the model wins only for `contract_approval`
 *   at high confidence: an approval is usually a casual reply inside a
 *   thread the fast path reads as something else, and that is exactly the
 *   case the model exists for. Any other disagreement keeps the fast-path
 *   intent — anchored beats inferred.
 * - Model alone → thresholds above.
 * - No model available → fast path only, said out loud.
 */
export function decide(
  fast: string | null,
  verdict: ModelVerdict | null,
  correction: string | null,
): IntentDecision {
  if (correction !== null) {
    if (correction === 'ignored') {
      return { lane: 'ignore', reason: 'Mike re-labeled this thread: not one to surface.', modelUnavailable: false };
    }
    return { lane: 'surface', intent: correction, reason: 'Mike re-labeled this thread.', modelUnavailable: false };
  }

  if (verdict === null) {
    if (fast !== null) {
      return {
        lane: 'surface',
        intent: fast,
        reason: 'Known notification format (pattern pass; intent model unavailable).',
        modelUnavailable: true,
      };
    }
    return {
      lane: 'ignore',
      reason: 'Intent model unavailable — pattern pass only saw nothing. Review when the model is back.',
      modelUnavailable: true,
    };
  }

  const reason = redact(verdict.reason).slice(0, 300);

  if (fast !== null) {
    if (
      verdict.intent === 'contract_approval' &&
      fast !== 'contract_approval' &&
      verdict.confidence >= CONFIDENCE_HIGH
    ) {
      return { lane: 'surface', intent: 'contract_approval', reason, modelUnavailable: false };
    }
    return { lane: 'surface', intent: fast, reason, modelUnavailable: false };
  }

  if (verdict.intent !== null && verdict.confidence >= CONFIDENCE_HIGH) {
    return { lane: 'surface', intent: verdict.intent, reason, modelUnavailable: false };
  }
  if (verdict.intent !== null && verdict.confidence >= CONFIDENCE_MAYBE) {
    return { lane: 'maybe', intent: verdict.intent, reason, modelUnavailable: false };
  }
  if (verdict.intent === null && verdict.matters && verdict.confidence >= CONFIDENCE_MAYBE) {
    // Matters, but no intent fits: the maybe lane shows it to Mike while the
    // registry collects it toward a proposed new intent.
    return { lane: 'maybe', reason, modelUnavailable: false };
  }
  return { lane: 'ignore', reason: reason || 'Model saw no lead intent.', modelUnavailable: false };
}

// ─── The live Opus model ───────────────────────────────────────────────────

/**
 * Body text handed to the model is capped per message. Threads carry quoted
 * reply chains and HTML tables; 4000 chars keeps the meaning and drops the
 * megabytes. The NEWEST messages matter most, so the cap trims each message,
 * never the thread's tail.
 */
const BODY_CAP = 4000;
const THREAD_CAP = 12;

function promptFor(
  thread: ThreadMessage[],
  intents: ReadonlyArray<{ id: string; label: string; description: string }>,
  examples: IntentExample[] = [],
): { system: string; user: string } {
  const exampleLines =
    examples.length === 0
      ? []
      : [
          'The owner corrected earlier classifications. Weigh these as ground truth for similar mail:',
          ...examples.slice(0, 30).map((e) => `- ${e.intent} ← "${e.snippetRedacted}"`),
        ];
  const system = [
    'You classify emails for Arbo, the ops assistant of a tree-work company in Virginia Beach.',
    'You are given the most recent messages of ONE email thread, oldest first, and a list of intents.',
    'Decide what the thread MEANS for the business — judge meaning, not sender addresses or templates.',
    'Reply with ONLY a JSON object, no prose, no code fence:',
    '{"intent": <intent id or null>, "confidence": <0..1>, "matters": <boolean>, "reason": <one short line>, "proposed_label": <string, only when intent is null and matters is true>}',
    '- intent: the single best-fitting id from the list, or null if none fits.',
    '- matters: true when the thread needs the owner\'s attention even if no intent fits (then suggest proposed_label, 2-4 words).',
    '- Personal mail, receipts, newsletters, vendor marketing, spam: intent null, matters false.',
    '- A casual reply approving quoted work ("go ahead", "we approved it", "let\'s do it") in an estimate thread IS contract_approval.',
    '- reason: one line. NEVER include a person\'s name, phone number, email address, or street address in it.',
    'Intents:',
    ...intents.map((i) => `- ${i.id}: ${i.description}`),
    ...exampleLines,
  ].join('\n');

  const tail = thread.slice(-THREAD_CAP);
  const user = tail
    .map(
      (m, i) =>
        `--- message ${i + 1} of ${tail.length} (${m.receivedAtIso}) ---\nFrom: ${m.from}\nSubject: ${m.subject}\n\n${m.body.slice(0, BODY_CAP)}`,
    )
    .join('\n\n');
  return { system, user };
}

/** Parse the model's JSON, strictly. Anything malformed throws — the caller
 *  treats a throw as "model unavailable", never as a verdict. */
export function parseVerdict(raw: string): ModelVerdict {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const v = JSON.parse(text) as Record<string, unknown>;
  const intent = v.intent === null || typeof v.intent === 'string' ? (v.intent as string | null) : undefined;
  const confidence = typeof v.confidence === 'number' ? v.confidence : undefined;
  const matters = typeof v.matters === 'boolean' ? v.matters : undefined;
  const reason = typeof v.reason === 'string' ? v.reason : undefined;
  if (intent === undefined || confidence === undefined || matters === undefined || reason === undefined) {
    throw new Error('intent model returned malformed verdict');
  }
  const proposedLabel = typeof v.proposed_label === 'string' ? v.proposed_label : undefined;
  return {
    intent,
    confidence: Math.max(0, Math.min(1, confidence)),
    matters,
    reason,
    ...(proposedLabel ? { proposedLabel } : {}),
  };
}

/**
 * Opus-backed IntentModel. Throws on API failure or malformed output — the
 * orchestrator catches, records the miss, and degrades the pass. Effort is
 * NOT lowered here: this is not a live phone call, and a wrong "ignore" is
 * a lost lead.
 */
export function createOpusIntentModel(apiKey: string): IntentModel {
  const client = new Anthropic({ apiKey });
  return {
    async classify(thread, intents, examples) {
      const { system, user } = promptFor(thread, intents, examples);
      const response = await client.messages.create({
        model: INTENT_MODEL,
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return parseVerdict(text);
    },
  };
}
