// THE policy engine (brief §8A.6d) — guardrails as deterministic CODE
// inspecting every human-reaching message and every gated tool call. This is
// the single enforcement point; the voice output guard (reception/outputGuard)
// supplies the golden-rule patterns so there is exactly ONE source of rules
// (§12: duplicate guardrail sources are a named rabbit hole).
//
// Blocks are logged by callers (agent_run.policy_blocks), never silently
// rewritten — except customer-facing text, which pivots to the approved line
// exactly as the voice path always has.

import type { Guardrails } from '../config/guardrails.schema.js';
import { guardReply } from '../reception/outputGuard.js';
import { scanForbidden } from '../lint/forbiddenStrings.js';

export type Audience = 'customer' | 'crew' | 'admin' | 'internal';
export type Channel = 'voice' | 'sms' | 'email' | 'app' | 'none';

export interface PolicyBlock {
  rule: string;
  detail: string;
}

export interface MessageVerdict {
  allowed: boolean;
  blocks: PolicyBlock[];
  /** For customer audience: the text to actually send (pivot line when blocked). */
  safeText?: string;
}

export interface ContactFacts {
  consented: boolean;
  optedOut: boolean;
}

/** Fields that must NEVER appear in anything a customer or crew member sees. */
const ADMIN_ONLY_MARKERS = [
  'quality_score', 'lead_quality', 'behavior_profile', 'price_sensitivity',
  'margin', 'quoted_vs_actual', 'normalized_rate', 'leakage', 'effective_rate',
  'tracking', 'bouncie', 'competency_level', 'training_profile', 'pay_rate',
];

/** Quiet hours per §4.1: outbound customer messages 8am–9pm ET only. */
export function withinQuietHoursSafe(atIso: string, timeZone = 'America/New_York'): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone })
      .format(new Date(atIso)),
  );
  return hour >= 8 && hour < 21;
}

const DATE_PROMISE_PATTERNS: RegExp[] = [
  /\bwe(?:'ll| will) be (?:there|out) (?:on|by|at) [A-Z][a-z]+day\b/i,
  /\bguarantee[ds]? (?:you )?(?:a|the) (?:date|slot|time)\b/i,
  /\bI(?:'ve| have) booked you (?:in )?for\b/i,
];

/**
 * Inspect an outbound message. Customer audience gets the full wall: golden
 * rules (price/diagnosis/forbidden terms via the ONE outputGuard), date
 * promises, TCPA consent + STOP + quiet hours, and the admin-data wall.
 * Crew audience gets the admin-data wall (no pricing/tracking leaks, §8C).
 * Admin/internal text passes untouched — Mike sees everything.
 */
export function inspectMessage(params: {
  audience: Audience;
  channel: Channel;
  text: string;
  guardrails: Guardrails;
  contact?: ContactFacts;
  atIso?: string;
  /** True when this is a reply inside a conversation the customer initiated. */
  inboundReply?: boolean;
}): MessageVerdict {
  const blocks: PolicyBlock[] = [];
  const { audience, text } = params;

  if (audience === 'admin' || audience === 'internal') {
    return { allowed: true, blocks: [] };
  }

  // Admin-data wall applies to BOTH customer and crew surfaces.
  const lower = text.toLowerCase();
  for (const marker of ADMIN_ONLY_MARKERS) {
    if (lower.includes(marker)) {
      blocks.push({ rule: 'admin-data-wall', detail: marker });
    }
  }

  if (audience === 'crew') {
    // Crew content additionally must not carry customer-facing forbidden terms
    // in anything that could be shown outward (Suffolk/TCIA lint is global law).
    for (const hit of scanForbidden(text, 'crew-surface')) {
      blocks.push({ rule: 'forbidden-term', detail: hit.term });
    }
    return { allowed: blocks.length === 0, blocks };
  }

  // ---- customer audience ----
  const guard = guardReply(text, params.guardrails);
  for (const v of guard.violations) {
    blocks.push({ rule: v.rule, detail: v.matched });
  }

  for (const re of DATE_PROMISE_PATTERNS) {
    const m = text.match(re);
    if (m) blocks.push({ rule: 'no-date-promise', detail: m[0] });
  }

  // TCPA gates apply to OUTBOUND reach-outs (not replies the customer initiated).
  if (!params.inboundReply && params.channel !== 'none' && params.channel !== 'app') {
    const c = params.contact;
    if (!c || !c.consented) blocks.push({ rule: 'tcpa-consent', detail: 'no consent on file' });
    if (c?.optedOut) blocks.push({ rule: 'tcpa-stop', detail: 'contact opted out' });
    if (params.atIso && !withinQuietHoursSafe(params.atIso)) {
      blocks.push({ rule: 'quiet-hours', detail: 'outside 8am-9pm ET' });
    }
  }

  const hardStop = blocks.some((b) =>
    b.rule === 'tcpa-consent' || b.rule === 'tcpa-stop' || b.rule === 'quiet-hours' || b.rule === 'admin-data-wall');

  if (hardStop) {
    // Nothing goes out at all — a pivot line at 2am is still a TCPA violation.
    return { allowed: false, blocks };
  }
  if (blocks.length > 0) {
    // Content violation on a permitted send: speak the approved pivot instead.
    return { allowed: false, blocks, safeText: guard.reply };
  }
  return { allowed: true, blocks, safeText: text };
}

export type ToolPermission = 'read' | 'write' | 'outbound' | 'money' | 'legal';

/**
 * Gate a tool call (§8A.7 rules of engagement). Structural law from §8A.8:
 * no agent may spend money or send a legal commitment — those tiers are
 * human-only, no exceptions, regardless of which agent asks.
 */
export function inspectToolCall(params: {
  tool: string;
  permission: ToolPermission;
  actor: 'agent' | 'human';
}): { allowed: boolean; blocks: PolicyBlock[] } {
  const blocks: PolicyBlock[] = [];
  if (params.actor === 'agent' && (params.permission === 'money' || params.permission === 'legal')) {
    blocks.push({
      rule: 'agent-cannot-commit',
      detail: `${params.tool} is ${params.permission}-tier: human approval required (§8A.8)`,
    });
  }
  return { allowed: blocks.length === 0, blocks };
}
