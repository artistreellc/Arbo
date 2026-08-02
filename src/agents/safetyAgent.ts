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
