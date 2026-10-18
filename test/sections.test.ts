/*
  SLOW::ARBO — see src/agents/sweep.ts for the full marker.
*/
// R25 — the eight section agents and the Opus brain. Every dep is a fake:
// no database, no network, no real Anthropic client.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  SECTION_AGENTS, runSectionAgent, runAllSections, isSectionId, onDemandSectionDeps,
  type SectionDeps, type AgentReport,
} from '../src/agents/sections.js';
import { createApi } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';
import { createBrain, deterministicSummary, BRAIN_OFFLINE, type BrainTextClient } from '../src/agents/brain.js';
import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import { KNOWLEDGE_BASE } from '../src/reception/knowledgeBase.js';
import { FORBIDDEN_CLEAR } from '../src/permitting/screening.js';
import type { WeatherAgentResult } from '../src/agents/weatherAgent.js';
import type { BookingAgentResult } from '../src/agents/bookingAgent.js';
import type { CollectionsAgentResult } from '../src/agents/collectionsAgent.js';
import type { SafetyAgentResult } from '../src/agents/safetyAgent.js';
import type { PermittingSweepResult } from '../src/agents/permittingAgent.js';
import type { OwnerBriefingResult } from '../src/agents/ownerBriefingAgent.js';
import type { AgentRunHandle } from '../src/binder/agentRun.js';
import type { AlertsProvider } from '../src/ops/stormWatch.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-09-28T14:00:00Z');

// ─── fakes ──────────────────────────────────────────────────────────────────

const weatherOk: WeatherAgentResult = { agent: 'weather', feed: 'ok', activeAlerts: 3, workStopping: 2, newlyRaised: 0, llm: 'not_configured', status: 'ok' };
const bookingOk: BookingAgentResult = { agent: 'booking', stopsChecked: 5, issues: 1, newlyRaised: 1, llm: 'not_configured', status: 'ok' };
const collectionsOk: CollectionsAgentResult = { agent: 'collections', feed: 'ok', overdue: 2, newlyRaised: 0, suppressed: 0, unknown: 1, llm: 'not_configured', status: 'ok' };
const safetyOk: SafetyAgentResult = {
  agent: 'safety',
  certs: { feed: 'ok', lapsed: 1, missing: 0, unknown: 0, urgent: 0, aerialBlocked: 1 },
  nearMisses: { feed: 'ok', openLast30: 2, uncategorised: 0 },
  weather: { feed: 'ok', workStopping: 0 },
  newlyRaised: 0, blindSpots: [], llm: 'not_configured', status: 'ok',
};
const permittingOk: PermittingSweepResult = { agent: 'permitting', eventsProcessed: 0, screensMissing: 2, flaggedPropertyIds: ['p-1', 'p-2'], llm: 'not_configured', status: 'ok' };
const briefingOk: OwnerBriefingResult = {
  agent: 'owner-briefing', sections: { brief: 'ok', openLoops: 2, storm: 'clear', comingDue: 3 }, llm: 'not_configured', status: 'ok',
};

const ok = (body: unknown) => async () => ({ status: 200, body });

/** Everything wired, every link open, every feed answering. Spies on all of it. */
function liveFakes(over: Partial<SectionDeps> = {}): SectionDeps {
  return {
    now: NOW,
    hasDb: () => true,
    linkOpen: () => true,
    api: {
      queue: vi.fn(ok({ open: [{ severity: 'urgent' }, { severity: 'attention' }], checkedAtIso: NOW.toISOString() })),
      reviewBacklog: vi.fn(ok({ conversations: [{}, {}] })),
      permitBoard: vi.fn(ok({ rows: [], counts: {}, blockedCount: 1, neverScreenedCount: 0, summary: '1 blocked' })),
      fleetUnits: vi.fn(ok({ units: [{}, {}, {}], down: 1 })),
      trainingBoard: vi.fn(ok({ rows: [{}], owingThisWeek: ['c-1'], blindSpots: [] })),
      referenceDrafts: vi.fn(ok({ drafts: [{}], count: 1 })),
      performance: vi.fn(ok({ areas: [{ verdict: 'below' }], fleetRatePerCrewHour: 1, withheld: [], blindSpots: [], campaigns: [], campaignsKnown: true })),
    },
    alerts: { activeAlerts: vi.fn(async () => []) },
    weather: vi.fn(async () => weatherOk),
    booking: vi.fn(async () => bookingOk),
    collections: vi.fn(async () => collectionsOk),
    safety: vi.fn(async () => safetyOk),
    permitting: vi.fn(async () => permittingOk),
    ownerBriefing: vi.fn(async () => briefingOk),
    guardrails: loadGuardrails,
    legal: loadLegal,
    knowledgeBase: () => KNOWLEDGE_BASE,
    startRun: async () => ({ id: null, finish: async () => {} }),
    ...over,
  };
}

const byId = (rs: AgentReport[], id: string) => rs.find((r) => r.agentId === id)!;

// ─── the definitions ────────────────────────────────────────────────────────

describe('SECTION_AGENTS — the eight (R25)', () => {
  it('is exactly eight, with unique ids, all on claude-opus-5', () => {
    expect(SECTION_AGENTS).toHaveLength(8);
    expect(new Set(SECTION_AGENTS.map((a) => a.id)).size).toBe(8);
    for (const a of SECTION_AGENTS) {
      expect(a.model).toBe('claude-opus-5');
      expect(isSectionId(a.id)).toBe(true);
    }
    expect(isSectionId('nope')).toBe(false);
  });

  it('carries every one of the 14 brief roles, each exactly once, plus collections', () => {
    const roles = SECTION_AGENTS.flatMap((a) => a.roles);
    for (let n = 1; n <= 14; n++) {
      const hits = roles.filter((r) => new RegExp(`^#${n}\\b`).test(r));
      expect(hits, `role #${n}`).toHaveLength(1);
    }
    expect(roles.some((r) => /collections/i.test(r))).toBe(true);
  });

  it('can only read or propose — never send, spend, write or edit a calendar', () => {
    for (const a of SECTION_AGENTS) {
      expect(a.can.length).toBeGreaterThan(0);
      for (const c of a.can) {
        expect(c, `${a.id}: ${c}`).toMatch(/^(read|propose):[a-z_]+$/);
        expect(c, `${a.id}: ${c}`).not.toMatch(/send|spend|edit_calendar|write|charge|order|delete|pay/);
      }
    }
  });

  it('every agent carries the whole law in its cannot list', () => {
    for (const a of SECTION_AGENTS) {
      const law = a.cannot.join(' | ');
      expect(law).toMatch(/call another agent/);
      expect(law).toMatch(/spend money/);
      expect(law).toMatch(/send anything/);
      expect(law).toMatch(/edit a calendar event/);
      expect(law).toMatch(/rewrite its own rules/);
    }
  });

  it('never uses clearance language anywhere it speaks (§6B.3)', () => {
    const texts = SECTION_AGENTS.flatMap((a) => [...a.cannot, ...a.reads, a.name, a.section]);
    for (const t of texts) expect(t).not.toMatch(FORBIDDEN_CLEAR);
  });
});

// ─── running, links cut (today's production) ────────────────────────────────

describe('with the data links cut (hasDb false)', () => {
  const DB_BACKED = [
    'call review backlog', "tomorrow's booked stops", 'open loops on the Queue', 'owner briefing',
    'permit screens for recent leads', 'permit board', 'reference library drafts', 'site photos',
    'crew certifications & near-miss log', 'training board', 'open invoices', 'fleet units',
    'area & campaign performance',
  ];

  it('names every DB-backed input as cut, never an empty read, and touches no DB-backed dep', async () => {
    const deps = liveFakes({ hasDb: () => false, linkOpen: () => false });
    const reports = await runAllSections(deps);
    expect(reports).toHaveLength(8);

    const inputs = reports.flatMap((r) => r.inputs);
    for (const name of DB_BACKED) {
      const hits = inputs.filter((i) => i.name === name);
      expect(hits.length, name).toBeGreaterThan(0);
      for (const i of hits) {
        expect(i.state, name).toBe('cut');
        expect(i.detail).toMatch(/cut on purpose/);
        expect(i.detail, name).not.toMatch(/ARBO_|\bops\b|photos|\(/); // no env var, no raw link keys
      }
    }
    // What still reads is what needs no database — and it says something.
    for (const i of inputs.filter((x) => x.state === 'read')) {
      expect(DB_BACKED).not.toContain(i.name);
      expect(i.detail.trim()).not.toBe('');
    }
    // The cut is enforced before the call, not after.
    for (const fn of [deps.booking, deps.collections, deps.safety, deps.permitting, deps.ownerBriefing]) {
      expect(fn).not.toHaveBeenCalled();
    }
    for (const fn of Object.values(deps.api!)) expect(fn).not.toHaveBeenCalled();
    // A section with a cut input is degraded, never ok.
    for (const r of reports) {
      if (r.inputs.some((i) => i.state !== 'read')) expect(r.status).toBe('degraded');
    }
  });

  it('reports inputs in the order and names each definition declares', async () => {
    const reports = await runAllSections(liveFakes({ hasDb: () => false }));
    for (const def of SECTION_AGENTS) {
      expect(byId(reports, def.id).inputs.map((i) => i.name)).toEqual(def.reads);
    }
  });
});

// ─── running, links open (fakes) ────────────────────────────────────────────

describe('with the links open (all fakes)', () => {
  it('turns the wrapped agents into findings and proposals that wait for Mike', async () => {
    const reports = await runAllSections(liveFakes());
    for (const r of reports) {
      expect(r.proposals.length + r.findings.length, r.agentId).toBeGreaterThan(0);
      for (const p of r.proposals) expect(p.needsMike).toBe(true);
    }
    const dispatcher = byId(reports, 'dispatcher');
    expect(dispatcher.wrapped.map((w) => w.agent)).toEqual(['weather', 'booking']);
    expect(dispatcher.findings.filter((f) => f.severity === 'act')).toHaveLength(2);
    expect(dispatcher.proposals.map((p) => p.kind)).toEqual(['weather_hold_review', 'route_fix']);

    const permit = byId(reports, 'permit-desk');
    expect(permit.findings[0]!.ref).toBe('p-1,p-2'); // ids only
    expect(permit.findings.map((f) => f.text).join(' ')).toMatch(/REVIEW NEEDED/);

    // Only the photo reader is unbuilt — named, not hidden, and its own state.
    const arborist = byId(reports, 'arborist');
    expect(arborist.status).toBe('degraded');
    expect(arborist.inputs.find((i) => i.name === 'site photos')).toMatchObject({ state: 'notbuilt', detail: 'there is no photo reader yet' });
    for (const r of reports.filter((x) => x.agentId !== 'arborist')) expect(r.status, r.agentId).toBe('ok');
  });

  it('a feed that could not be read is unreadable, never a zero', async () => {
    const reports = await runAllSections(liveFakes({
      collections: async () => ({ ...collectionsOk, feed: 'unavailable', overdue: 0, unknown: 0 }),
      weather: async () => ({ ...weatherOk, feed: 'unavailable', activeAlerts: 0, workStopping: 0 }),
      api: { ...liveFakes().api, fleetUnits: async () => ({ status: 500, body: { error: 'boom' } }) },
    }));
    const yard = byId(reports, 'yard-boss');
    expect(yard.status).toBe('degraded');
    expect(yard.inputs.map((i) => i.state)).toEqual(['unreadable', 'unreadable']);
    expect(yard.inputs[1]!.detail).toMatch(/answered 500 boom/);
    expect(yard.findings).toHaveLength(0); // no invented "0 overdue"
    const dispatcher = byId(reports, 'dispatcher');
    expect(dispatcher.inputs[0]).toMatchObject({ state: 'unreadable' });
    expect(dispatcher.inputs[0]!.detail).toMatch(/not "no storm"/);
  });

  it('names the one link that is cut when the master is open (R19)', async () => {
    const reports = await runAllSections(liveFakes({ linkOpen: (l) => l !== 'equipment' }));
    const fleet = byId(reports, 'yard-boss').inputs.find((i) => i.name === 'fleet units')!;
    expect(fleet.state).toBe('cut');
    expect(fleet.detail).toBe('cut on purpose — this link is not opened yet');
  });

  it('a plain feed that throws is unreadable and the section degrades (not blocked)', async () => {
    const reports = await runAllSections(liveFakes({
      alerts: { activeAlerts: async () => { throw new Error('NWS 503'); } },
    }));
    const crew = byId(reports, 'crew-chief');
    expect(crew.status).toBe('degraded');
    const w = crew.inputs.find((i) => i.name === 'NWS weather alerts')!;
    expect(w.state).toBe('unreadable');
    // The screen prints the name and an UNREADABLE chip, so the detail repeats neither.
    expect(w.detail).toBe('Error: NWS 503');
    expect(w.detail).not.toMatch(/NWS weather alerts|unreadable/);
  });

  it('a network failure is said in plain words, never a raw TypeError', async () => {
    const reports = await runAllSections(liveFakes({
      alerts: { activeAlerts: async () => { throw new TypeError('fetch failed'); } },
    }));
    const w = byId(reports, 'crew-chief').inputs.find((i) => i.name === 'NWS weather alerts')!;
    expect(w.state).toBe('unreadable');
    expect(w.detail).toBe("the service didn't answer");
  });
});

// ─── on demand, and on the practice data ────────────────────────────────────

describe('the on-demand run (Mike\'s tap)', () => {
  const quietAlerts: AlertsProvider = { activeAlerts: async () => [] };

  // The same composition as POST /api/agents/sections/run in SIMULATION mode.
  const simDeps = (alerts: AlertsProvider = quietAlerts): SectionDeps => {
    const base = onDemandSectionDeps(createApi(createSimSource(), { dataLinksSim: true }), alerts, NOW);
    return { ...base, hasDb: () => true, linkOpen: () => true };
  };

  it('on the practice data no input says "link cut" — a feed the simulation lacks is NOT SIMULATED, by name', async () => {
    const reports = await runAllSections(simDeps());
    const inputs = reports.flatMap((r) => r.inputs);
    expect(inputs.filter((i) => i.state === 'cut')).toEqual([]);
    // Fleet units ARE in the practice data, so they are read.
    expect(byId(reports, 'yard-boss').inputs.find((i) => i.name === 'fleet units')!.state).toBe('read');
    // The call backlog is not — named as such, never a failed read or a zero.
    const backlog = byId(reports, 'front-desk').inputs.find((i) => i.name === 'call review backlog')!;
    expect(backlog).toMatchObject({ state: 'sim', detail: 'not in the practice data' });
    // The agents left to the hourly sweep are not run here — not "unreadable".
    const stops = byId(reports, 'dispatcher').inputs.find((i) => i.name === "tomorrow's booked stops")!;
    expect(stops.state).toBe('notrun');
    expect(stops.detail).toMatch(/hourly check/);
    for (const i of inputs) expect(i.detail, i.name).not.toMatch(/wired/);
    // Anything not read still degrades the desk; nothing is blocked.
    for (const r of reports) {
      expect(r.status, r.agentId).not.toBe('blocked');
      if (r.inputs.some((i) => i.state !== 'read')) expect(r.status, r.agentId).toBe('degraded');
    }
  });

  it('the Dispatcher reads the weather feed itself, the same read the Crew Chief gets', async () => {
    const reports = await runAllSections(simDeps());
    const dispatcher = byId(reports, 'dispatcher').inputs.find((i) => i.name === 'NWS weather alerts')!;
    const crew = byId(reports, 'crew-chief').inputs.find((i) => i.name === 'NWS weather alerts')!;
    expect(dispatcher.state).toBe('read');
    expect(crew.state).toBe('read');
  });

  it('a dead weather feed on demand is unreadable for the Dispatcher — never a blocked desk', async () => {
    const reports = await runAllSections(simDeps({ activeAlerts: async () => { throw new TypeError('fetch failed'); } }));
    const d = byId(reports, 'dispatcher');
    expect(d.status).toBe('degraded');
    expect(d.inputs[0]).toMatchObject({ state: 'unreadable', detail: "the service didn't answer" });
    expect(d.findings.filter((f) => f.severity === 'info')).toHaveLength(0); // no invented "none work-stopping"
  });

  it('the run route uses exactly that composition, and only in SIMULATION', () => {
    const server = readFileSync(resolve(here, '..', 'src/server.ts'), 'utf8');
    expect(server).toContain('const base = onDemandSectionDeps(api, alertsProvider);');
    expect(server).toContain('const deps = dataLinksSim() ? { ...base, hasDb: () => true, linkOpen: () => true } : base;');
    expect(server).toContain('const reports = await runAllSections(deps);');
  });
});

// ─── independence ───────────────────────────────────────────────────────────

describe('one failing agent never stops the other seven', () => {
  it('a throwing wrapped agent blocks only its own section, with the error named', async () => {
    const reports = await runAllSections(liveFakes({
      weather: async () => { throw new Error('boom'); },
    }));
    expect(reports).toHaveLength(8);
    const dispatcher = byId(reports, 'dispatcher');
    expect(dispatcher.status).toBe('blocked');
    expect(dispatcher.error).toMatch(/weatherAgent/);
    expect(dispatcher.error).toMatch(/boom/);
    for (const r of reports.filter((x) => x.agentId !== 'dispatcher')) {
      expect(r.status, r.agentId).not.toBe('blocked');
      expect(r.inputs.length).toBeGreaterThan(0);
    }
  });

  it('scrubs customer shapes out of a thrown error before it is shown', async () => {
    const reports = await runAllSections(liveFakes({
      collections: async () => { throw new Error('row for 757-555-0123 failed'); },
    }));
    const yard = byId(reports, 'yard-boss');
    expect(yard.status).toBe('blocked');
    expect(yard.error).not.toMatch(/757-555-0123/);
    expect(yard.error).toMatch(/redacted-phone/);
  });

  it('records every run, and says so when the recorder itself fails', async () => {
    const started: string[] = [];
    const summaries: string[] = [];
    const startRun = async (p: { agent: string }): Promise<AgentRunHandle> => {
      started.push(p.agent);
      return { id: 'r', finish: async (f) => { summaries.push(f.outputSummary ?? ''); } };
    };
    await runAllSections(liveFakes({ startRun }));
    expect(started.sort()).toEqual(SECTION_AGENTS.map((a) => `section:${a.id}`).sort());
    for (const s of summaries) expect(s).toMatch(/^status=\w+ inputs=\[[a-z:0-9,]*\] findings=\[[a-z:0-9,]*\] proposals=\d+$/);

    const r = await runSectionAgent('analyst', liveFakes({ startRun: async () => { throw new Error('agent_run down'); } }));
    expect(r.status).toBe('ok');
    expect(r.findings.some((f) => /not recorded/.test(f.text))).toBe(true);
  });
});

// ─── the brain ──────────────────────────────────────────────────────────────

describe('the Opus brain', () => {
  const sample = async () => runSectionAgent('dispatcher', liveFakes());

  it('without a client is offline and says so once on the page, deterministically', async () => {
    const r = await sample();
    const brain = createBrain();
    expect(brain.online).toBe(false);
    const a = await brain.summarize(r);
    const b = await brain.summarize(r);
    expect(a.source).toBe('deterministic');
    // The Agents page says AI is off once; the card line carries no label of its own.
    expect(a.text).not.toContain(BRAIN_OFFLINE);
    expect(a.note).toBe(BRAIN_OFFLINE);
    expect(a.text).toBe(b.text);
    expect(a.text).toBe(deterministicSummary(r));
  });

  it('shows the model states and counts, never an input detail', async () => {
    const r = await sample();
    r.inputs[0]!.detail = 'call 757-555-0123 back';
    let seen = '';
    const client: BrainTextClient = { complete: async (_s, u) => { seen = u; return 'Two alerts are active and one route issue needs Mike.'; } };
    const out = await createBrain(client).summarize(r);
    expect(out.source).toBe('opus');
    expect(out.text).toBe('Two alerts are active and one route issue needs Mike.');
    expect(seen).not.toMatch(/757/);
    expect(seen).not.toMatch(/detail/);
  });

  it('falls back, with the reason named, when the model line breaks a rule or fails', async () => {
    const r = await sample();
    const say = (text: string): BrainTextClient => ({ complete: async () => text });
    const cases: Array<[BrainTextClient, RegExp]> = [
      [say('That job will cost $450.'), /blocked by guard/],
      [say("The property is fine — you're clear to cut."), /clearance language|blocked by guard/],
      [say('Call the customer at 757-555-0123.'), /customer-shaped|blocked by guard/],
      [say('   '), /returned nothing/],
      [{ complete: async () => { throw new TypeError('network'); } }, /brain call failed \(TypeError\)/],
    ];
    for (const [client, why] of cases) {
      const out = await createBrain(client).summarize(r);
      expect(out.source).toBe('deterministic');
      expect(out.note).toMatch(why);
      expect(out.text).toContain(deterministicSummary(r));
      // What Mike reads is plain words; the exact reason stays on `note`.
      expect(out.text).toMatch(/^AI (read failed|line blocked) — plain count\. /);
    }
  });
});

describe('the plain count (no model) — §1B in words', () => {
  const report = (inputs: AgentReport['inputs'], over: Partial<AgentReport> = {}): AgentReport => ({
    agentId: 'yard-boss', name: 'Yard Boss', section: 'Fleet & money', ranAt: NOW.toISOString(),
    status: 'degraded', inputs, findings: [], proposals: [], wrapped: [], ...over,
  });

  it('a desk that read nothing never prints a zero as if it had looked', () => {
    const s = deterministicSummary(report([
      { name: 'open invoices', state: 'cut', detail: 'x' },
      { name: 'fleet units', state: 'notrun', detail: 'x' },
    ]));
    expect(s).not.toMatch(/0 to act on/);
    expect(s).toContain('does not mean nothing is wrong');
    expect(s).toContain('Could not see 2 of 2 inputs (named below).');
    expect(s).toContain('0 proposals from this run for you to decide.');
    expect(s).not.toMatch(FORBIDDEN_CLEAR);
    expect(s).not.toMatch(/Mike|proposal\(s\)|deterministic/);
    expect(s).not.toMatch(/\) \(|: Could not see:/);
  });

  it('a desk that read only a rulebook has looked at no business data — no zero count either', () => {
    const s = deterministicSummary(report([
      { name: 'guardrails (golden rules in code)', state: 'read', detail: 'x' },
      { name: 'call review backlog', state: 'notrun', detail: 'x' },
    ], { agentId: 'front-desk', name: 'Front Desk', section: 'Calls' }));
    expect(s).not.toMatch(/0 to act on/);
    expect(s).toContain('does not mean nothing is wrong');
    expect(s).toContain('Could not see 1 of 2 inputs (named below).');
    expect(s).not.toMatch(/\) \(|: Could not see:/);
  });

  it('a desk that missed some inputs says its counts are not the whole picture', () => {
    const s = deterministicSummary(report([
      { name: 'open invoices', state: 'read', detail: 'x' },
      { name: 'fleet units', state: 'unreadable', detail: 'x' },
    ], { findings: [{ severity: 'act', text: 'x' }], proposals: [{ kind: 'k', text: 't', needsMike: true }] }));
    expect(s).toContain('Could not see 1 of 2 inputs (named below).');
    expect(s).toContain('From what it could see: 1 to act on, 0 to watch — not the whole picture.');
    expect(s).toContain('1 proposal from this run for you to decide.');
    expect(s).not.toMatch(/\) \(|: Could not see:/);
  });

  it('a desk that read everything says so, and only then gives the plain count', () => {
    const s = deterministicSummary(report([{ name: 'fleet units', state: 'read', detail: 'x' }], { status: 'ok' }));
    expect(s).toBe('Read everything it needs: 0 to act on, 0 to watch. 0 proposals from this run for you to decide.');
  });
});

// ─── static law ─────────────────────────────────────────────────────────────

describe('static source law', () => {
  const files = ['src/agents/sections.ts', 'src/agents/brain.ts'].map((f) => [f, readFileSync(resolve(here, '..', f), 'utf8')] as const);

  it('imports no sender, no outreach, no calendar or mail integration', () => {
    for (const [name, src] of files) {
      const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
      expect(imports, name).not.toMatch(/quoSend|outreach|integrations\/|inspectMessage/);
      expect(src, name).not.toMatch(/createQuoSender|OutreachEngine|emitEvent\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    }
  });

  it('a section never runs another section', () => {
    const [, sections] = files[0]!;
    // Only runAllSections may call runSectionAgent; the input readers may not.
    const body = sections.slice(sections.indexOf('const INPUTS'), sections.indexOf('// ─── Running'));
    expect(body).not.toMatch(/runSectionAgent|runAllSections/);
  });
});
