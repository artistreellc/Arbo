/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
// Agent — Safety (brief §6V, §4, §8A.5). Ties the three safety feeds together
// into one answer for the morning: what the weather is doing, whose credentials
// have run out, and what near-misses are still open.
//
// The rule that makes it worth having: EVERY feed reports its own blindness.
// A safety brief that silently omits a feed it could not read is worse than no
// brief at all, because it reads as "nothing to worry about" (§1B, §12).
//
// Arbo never claims a credential the company does not hold (no Suffolk, no
// TCIA), never diagnoses, and this agent cannot stand anyone down — it raises
// events and stops.

import { findCertProblems, type CertFinding, type CertRow, type CrewMemberRef } from '../safety/certifications.js';
import { isWorkStopping, type AlertsProvider } from '../ops/stormWatch.js';
import { startAgentRun } from '../binder/agentRun.js';
import { emitSafe } from '../binder/eventBus.js';
import { getDb, hasDb } from '../db/client.js';
import { etToday } from '../lib/etDay.js';
import { env } from '../env.js';

/** Every feed is tri-state: a value, or an explicit 'unavailable'. */
export type FeedState = 'ok' | 'unavailable';

export interface SafetyAgentResult {
  agent: 'safety';
  certs: { feed: FeedState; lapsed: number; missing: number; unknown: number; urgent: number; aerialBlocked: number };
  nearMisses: { feed: FeedState; openLast30: number; uncategorised: number };
  weather: { feed: FeedState; workStopping: number };
  newlyRaised: number;
  /** Named feeds that could not be read. Empty is the ONLY all-clear. */
  blindSpots: string[];
  llm: 'not_configured' | 'available';
  status: 'ok' | 'error';
}

async function readCrewAndCerts(): Promise<{ crew: CrewMemberRef[]; certs: CertRow[] } | null> {
  if (!hasDb()) return null;
  const db = getDb();
  const [crew, certs] = await Promise.all([
    db.from('crew_member').select('id, name, role, active').eq('active', true),
    db.from('certification').select('id, crew_member_id, type, expires_at'),
  ]);
  if (crew.error || certs.error) return null;
  return {
    crew: (crew.data ?? []).map((c) => ({
      id: c.id as string, name: c.name as string, role: c.role as string, active: c.active as boolean,
    })),
    certs: (certs.data ?? []).map((c) => ({
      id: c.id as string,
      crewMemberId: c.crew_member_id as string,
      type: c.type as CertRow['type'],
      expiresOn: (c.expires_at as string | null) ?? null,
    })),
  };
}

async function readNearMisses(todayEt: string): Promise<{ openLast30: number; uncategorised: number } | null> {
  if (!hasDb()) return null;
  const since = new Date(Date.parse(`${todayEt}T00:00:00Z`) - 30 * 86400_000).toISOString().slice(0, 10);
  const res = await getDb()
    .from('near_miss')
    .select('id, hazard_category, generated_training_item_id')
    .gte('occurred_on', since);
  if (res.error) return null;
  const rows = res.data ?? [];
  return {
    // "Open" = no training item generated from it yet: the loop from incident
    // to lesson is what makes a near-miss programme worth anything.
    openLast30: rows.filter((r) => !r.generated_training_item_id).length,
    uncategorised: rows.filter((r) => !r.hazard_category || r.hazard_category === 'uncategorised').length,
  };
}

/** Cert findings already raised in the trailing window, keyed member+type+state. */
async function alreadyRaised(now: Date): Promise<Set<string>> {
  if (!hasDb()) return new Set();
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const res = await getDb()
    .from('event')
    .select('payload')
    .eq('type', 'safety.cert.problem')
    .gte('emitted_at', since);
  if (res.error) return new Set();
  const out = new Set<string>();
  for (const r of res.data ?? []) {
    const p = r.payload as { crewMemberId?: string; certType?: string; state?: string };
    if (p.crewMemberId) out.add(`${p.crewMemberId}:${p.certType ?? ''}:${p.state ?? ''}`);
  }
  return out;
}

export async function runSafetyAgent(alerts: AlertsProvider, now = new Date()): Promise<SafetyAgentResult> {
  const run = await startAgentRun({ agent: 'safety', modelUsed: env.anthropic.apiKey ? 'claude-opus-5' : undefined });
  const llm = env.anthropic.apiKey ? 'available' as const : 'not_configured' as const;
  const blindSpots: string[] = [];
  const result: SafetyAgentResult = {
    agent: 'safety',
    certs: { feed: 'unavailable', lapsed: 0, missing: 0, unknown: 0, urgent: 0, aerialBlocked: 0 },
    nearMisses: { feed: 'unavailable', openLast30: 0, uncategorised: 0 },
    weather: { feed: 'unavailable', workStopping: 0 },
    newlyRaised: 0,
    blindSpots,
    llm,
    status: 'ok',
  };

  try {
    const todayEt = etToday(now);

    // --- credentials -------------------------------------------------------
    let findings: CertFinding[] = [];
    const cc = await readCrewAndCerts();
    if (!cc) {
      blindSpots.push('certifications: could not read crew or certification records');
    } else {
      findings = findCertProblems(cc.crew, cc.certs, todayEt);
      const count = (s: CertFinding['state']) => findings.filter((f) => f.state === s).length;
      result.certs = {
        feed: 'ok',
        lapsed: count('lapsed'),
        missing: count('missing'),
        unknown: count('unknown'),
        urgent: count('urgent'),
        aerialBlocked: new Set(findings.filter((f) => f.blocksAerialWork).map((f) => f.crewMemberId)).size,
      };
    }

    // --- near misses -------------------------------------------------------
    const nm = await readNearMisses(todayEt);
    if (!nm) blindSpots.push('near_miss: could not read the incident log');
    else result.nearMisses = { feed: 'ok', ...nm };

    // --- weather -----------------------------------------------------------
    try {
      const active = await alerts.activeAlerts();
      result.weather = { feed: 'ok', workStopping: active.filter(isWorkStopping).length };
    } catch {
      blindSpots.push('weather: NWS feed did not answer');
    }

    // --- raise what a human must act on ------------------------------------
    const seen = await alreadyRaised(now);
    let raised = 0;
    for (const f of findings) {
      // Only the states that STOP something get an event. 'upcoming' is a
      // calendar nudge, not a decision, and drowning the bus in them would
      // teach everyone to ignore it.
      if (f.state !== 'lapsed' && f.state !== 'missing' && f.state !== 'unknown') continue;
      const key = `${f.crewMemberId}:${f.type}:${f.state}`;
      if (seen.has(key)) continue;
      // No names on the bus — crew PII stays out of the event log (§4.3).
      const ok = await emitSafe('safety.cert.problem', {
        crewMemberId: f.crewMemberId, certType: f.type, state: f.state,
        blocksAerialWork: f.blocksAerialWork,
      }, 'safety-agent');
      if (ok) raised++;
    }
    result.newlyRaised = raised;

    await run.finish({
      status: 'ok',
      outputSummary:
        `certs=${result.certs.feed} lapsed=${result.certs.lapsed} missing=${result.certs.missing} ` +
        `unknown=${result.certs.unknown} aerial_blocked=${result.certs.aerialBlocked} ` +
        `near_miss=${result.nearMisses.feed} open=${result.nearMisses.openLast30} ` +
        `weather=${result.weather.feed} stopping=${result.weather.workStopping} ` +
        `raised=${raised} blind_spots=[${blindSpots.join('|')}] llm=${llm}`,
    });
    return result;
  } catch (err) {
    result.status = 'error';
    blindSpots.push('safety agent failed before it finished');
    await run.finish({ status: 'error', outputSummary: err instanceof Error ? err.message : 'error' });
    return result;
  }
}
