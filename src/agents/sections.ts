/*
  SLOW::ARBO — see src/agents/sweep.ts for the full marker.
*/
// The eight SECTION agents — owner ruling R25 (Mike, 2026-09-28): "Make the 8
// agents you need to have working in each section of the app". One agent per
// section; together they carry all 14 brief roles (§8A.5). The table lives in
// docs/BUILD_R25.md.
//
// A section agent is a thin composition, not a new brain. It runs the agents
// that already exist (weather, booking, collections, safety, permitting,
// owner briefing) and the app's own READ handlers, then reports what it read,
// what it found, and what it proposes for Mike. Nothing here is new logic
// about trees, money or permits — that stays in the modules it wraps.
//
// Law for all eight (§8A, §8A.8, R17): a section never calls another section
// (they share state and events only — each one sees only its injected deps);
// never spends; never sends (the only send in Arbo is the R22 Quo text behind
// inspectMessage — paused while Quo is read-only, R33 — and nothing here
// imports it); never edits a calendar event;
// never rewrites its own rules or code. Every run is recorded (agent_run).
//
// §1B, the spine: every input has one of six states. 'cut' = its data link
// is closed on purpose. 'sim' = a feed the practice data does not carry.
// 'notrun' = deliberately not read here — an agent left to the hourly check,
// or a piece not connected in this run. 'notbuilt' = no reader exists yet.
// 'unreadable' = we tried and could not. 'read' = a real answer. Only 'read'
// is an answer; the other five are never a zero.
//
// Failure rule, one line: an input read that fails is 'unreadable' and the
// section is 'degraded'; a WRAPPED existing agent that throws has broken its
// own contract (they all catch internally), so the section is 'blocked' with
// that error named. One section failing never stops the other seven.

import type { createApi, ApiResult } from '../server/api.js';
import type { AlertsProvider } from '../ops/stormWatch.js';
import { isWorkStopping } from '../ops/stormWatch.js';
import type { NeedsDecision } from '../ops/loopCloser.js';
import type { AreaReport } from '../ops/areaPerformance.js';
import type { PermitBoard } from '../permitting/permitBoard.js';
import type { TrainingBoard } from '../training/board.js';
import type { Guardrails } from '../config/guardrails.schema.js';
import type { LegalConfig } from '../config/legal.schema.js';
import { loadGuardrails, loadLegal } from '../config/loadConfig.js';
import { KNOWLEDGE_BASE, type KbEntry } from '../reception/knowledgeBase.js';
import { redact } from '../ops/inboxWatch.js';
import { startAgentRun, type AgentRunHandle } from '../binder/agentRun.js';
import { hasDb } from '../db/client.js';
import { linkOpen, type DataLink } from '../db/links.js';
import { runWeatherAgent, type WeatherAgentResult } from './weatherAgent.js';
import { runBookingAgent, type BookingAgentResult } from './bookingAgent.js';
import { runCollectionsAgent, type CollectionsAgentResult } from './collectionsAgent.js';
import { runSafetyAgent, type SafetyAgentResult } from './safetyAgent.js';
import { runPermittingAgent, type PermittingSweepResult } from './permittingAgent.js';
import { runOwnerBriefingAgent, type OwnerBriefingResult } from './ownerBriefingAgent.js';

type Api = ReturnType<typeof createApi>;

// ─── Definitions ────────────────────────────────────────────────────────────

export type SectionId =
  | 'front-desk' | 'dispatcher' | 'chief-of-staff' | 'permit-desk'
  | 'arborist' | 'crew-chief' | 'yard-boss' | 'analyst';

export interface SectionAgentDef {
  id: SectionId;
  name: string;
  /** The section of the app this agent works in. */
  section: string;
  /** Brief roles carried (§8A.5 numbering). */
  roles: string[];
  /** Existing modules it wraps — it composes them, it does not copy them. */
  carries: string[];
  /** Named inputs, in the order it reads them. */
  reads: string[];
  /** Allowed actions. Every one is `read:` or `propose:` — nothing else. */
  can: string[];
  /** The law, in plain words. */
  cannot: string[];
  model: 'claude-opus-5';
}

/** What every one of the eight is structurally unable to do (§8A.8, R17, R4). */
const LAW: readonly string[] = [
  'call another agent — agents share state and events, nothing else',
  'spend money or commit the company to anything',
  'send anything to anyone (Arbo sends nothing while Quo is read-only — R33; the compliance-checked Quo text, if Mike turns it back on, is never called by a section agent)',
  'edit a calendar event',
  'rewrite its own rules, prompts or code',
  'import or store leads or live business records (R4, §3)',
  'set a price, diagnose a tree, or promise a date',
];

// Input names are constants so `reads` and the report can never drift apart.
const IN = {
  guardrails: 'guardrails (golden rules in code)',
  callBacklog: 'call review backlog',
  weather: 'NWS weather alerts',
  bookedStops: "tomorrow's booked stops",
  openLoops: 'open loops on the Queue',
  briefing: 'owner briefing',
  permitScreens: 'permit screens for recent leads',
  permitBoard: 'permit board',
  legal: 'legal & codes config',
  knowledge: 'arboriculture knowledge base',
  referenceDrafts: 'reference library drafts',
  photos: 'site photos',
  crewSafety: 'crew certifications & near-miss log',
  training: 'training board',
  invoices: 'open invoices',
  fleet: 'fleet units',
  performance: 'area & campaign performance',
} as const;
export const RULEBOOK_INPUTS: ReadonlySet<string> = new Set([IN.guardrails, IN.legal, IN.knowledge]); // static rulebooks: loading one is not looking at the business

export const SECTION_AGENTS: readonly SectionAgentDef[] = [
  {
    id: 'front-desk', name: 'Front Desk', section: 'Calls',
    roles: ['#1 Receptionist'],
    carries: ['reception/receptionist', 'reception/outputGuard'],
    reads: [IN.guardrails, IN.callBacklog],
    can: ['read:guardrails', 'read:call_review_backlog', 'propose:call_review'],
    cannot: [...LAW],
    model: 'claude-opus-5',
  },
  {
    id: 'dispatcher', name: 'Dispatcher', section: 'Calendar & route',
    roles: ['#2 Booking & dispatch', '#9 Weather & Conditions'],
    carries: ['agents/bookingAgent', 'agents/weatherAgent'],
    reads: [IN.weather, IN.bookedStops],
    can: ['read:nws_alerts', 'read:booked_stops', 'propose:route_fix', 'propose:weather_hold_review', 'propose:flag_on_event_bus'],
    cannot: [...LAW, 'move a stop — it suggests, Mike moves the event (§3.22)'],
    model: 'claude-opus-5',
  },
  {
    id: 'chief-of-staff', name: 'Chief of Staff', section: 'Today & Queue',
    roles: ['#3 Loop-Closer', '#13 Owner Briefing'],
    carries: ['ops/loopCloser (via the read-only queue)', 'agents/ownerBriefingAgent'],
    reads: [IN.openLoops, IN.briefing],
    can: ['read:open_loops', 'read:owner_briefing', 'propose:decide_open_loops', 'propose:flag_on_event_bus'],
    cannot: [...LAW],
    model: 'claude-opus-5',
  },
  {
    id: 'permit-desk', name: 'Permit Desk', section: 'Permits',
    roles: ['#4 Permitting & Site Intel', '#14 Legal & Codes'],
    carries: ['agents/permittingAgent', 'permitting/permitBoard', 'config/legal'],
    reads: [IN.permitScreens, IN.permitBoard, IN.legal],
    can: ['read:permit_screens', 'read:permit_board', 'read:legal_config', 'propose:run_screen', 'propose:flag_on_event_bus'],
    cannot: [
      ...LAW,
      'tell anyone a property needs no permit — the words are PERMIT LIKELY / REVIEW NEEDED / NO OVERLAY–VERIFY',
      'file a permit — it prepares, a human files (§6B.3)',
    ],
    model: 'claude-opus-5',
  },
  {
    id: 'arborist', name: 'Arborist', section: 'Measure & Book',
    roles: ['#5 Master Arborist Knowledge', '#8 Vision & Labeling'],
    carries: ['reception/knowledgeBase', 'reference library (via the read-only drafts queue)'],
    reads: [IN.knowledge, IN.referenceDrafts, IN.photos],
    can: ['read:knowledge_base', 'read:reference_drafts', 'read:site_photos', 'propose:vet_reference'],
    cannot: [...LAW, 'publish a library entry — a named human vets it (§4.7)'],
    model: 'claude-opus-5',
  },
  {
    id: 'crew-chief', name: 'Crew Chief', section: 'Crew',
    roles: ['#6 Safety', '#7 Trainer'],
    carries: ['agents/safetyAgent', 'training/board (via the read-only training board)'],
    reads: [IN.crewSafety, IN.training, IN.weather],
    can: ['read:certifications', 'read:near_miss_log', 'read:training_board', 'read:nws_alerts',
      'propose:fix_credentials', 'propose:lesson_draft', 'propose:stand_down_review', 'propose:flag_on_event_bus'],
    cannot: [...LAW, 'stand a crew down or clear anyone to climb — Mike decides',
      'claim a credential the company does not hold'],
    model: 'claude-opus-5',
  },
  {
    // R26: named by the screen it works on — the fleet & money part of the Queue.
    id: 'yard-boss', name: 'Yard Boss', section: 'Queue — fleet & money',
    roles: ['#10 Equipment & parts', 'Collections (§4.8, §5B)'],
    carries: ['agents/collectionsAgent', 'fleet (via the read-only units list)'],
    reads: [IN.invoices, IN.fleet],
    can: ['read:open_invoices', 'read:fleet_units', 'propose:collections_review', 'propose:parts_review', 'propose:signback_review', 'propose:flag_on_event_bus'],
    cannot: [...LAW, 'charge, order parts, or hold a card (§6E2.3)'],
    model: 'claude-opus-5',
  },
  {
    id: 'analyst', name: 'Analyst', section: 'Numbers',
    roles: ['#11 Marketing', '#12 Analyst'],
    carries: ['ops/areaPerformance (via the read-only performance read)'],
    reads: [IN.performance],
    can: ['read:area_performance', 'read:campaign_performance', 'propose:area_review'],
    cannot: [...LAW, 'touch the website, Resend, or anything SEO-adjacent (R7)'],
    model: 'claude-opus-5',
  },
];

export function isSectionId(id: string): id is SectionId {
  return SECTION_AGENTS.some((a) => a.id === id);
}

// ─── Report shape ───────────────────────────────────────────────────────────

export type InputState = 'read' | 'cut' | 'sim' | 'notrun' | 'notbuilt' | 'unreadable';

export interface InputReport { name: string; state: InputState; detail: string }
export interface Finding { severity: 'info' | 'watch' | 'act'; text: string; ref?: string }
export interface Proposal { kind: string; text: string; needsMike: true }
/** One line per wrapped existing agent: counts only, never a customer. */
export interface WrappedSummary { agent: string; status: string; summary: string }

export interface AgentReport {
  agentId: SectionId;
  name: string;
  section: string;
  ranAt: string;
  status: 'ok' | 'degraded' | 'blocked';
  inputs: InputReport[];
  findings: Finding[];
  proposals: Proposal[];
  wrapped: WrappedSummary[];
  /** Set only when blocked: the named error. */
  error?: string;
}

// ─── Deps (injected so tests run with fakes) ────────────────────────────────

/** The app's read-only handlers a section may use. No writer is on this list. */
export type SectionReadApi = Partial<Pick<Api,
  'queue' | 'reviewBacklog' | 'permitBoard' | 'fleetUnits' | 'trainingBoard' | 'referenceDrafts' | 'performance'>>;

export interface SectionDeps {
  now?: Date;
  /** The §3 master switch. False = every DB-backed input is 'cut'. */
  hasDb: () => boolean;
  /** The R19 per-link switch. */
  linkOpen: (link: DataLink) => boolean;
  /**
   * Whether the hourly sweep is actually armed — the REAL hasDb(), which the
   * practice-data run does not override. Undefined = assume armed.
   */
  hourlySweep?: boolean;
  api?: SectionReadApi;
  alerts?: AlertsProvider;
  // The existing agents, wrapped. Undefined = not wired this run (named).
  weather?: () => Promise<WeatherAgentResult>;
  booking?: () => Promise<BookingAgentResult>;
  collections?: () => Promise<CollectionsAgentResult>;
  safety?: () => Promise<SafetyAgentResult>;
  permitting?: () => Promise<PermittingSweepResult>;
  ownerBriefing?: () => Promise<OwnerBriefingResult>;
  // Config the code already ships (no database).
  guardrails?: () => Guardrails;
  legal?: () => LegalConfig;
  knowledgeBase?: () => readonly KbEntry[];
  /** Audit recorder; defaults to the binder's agent_run log. */
  startRun?: typeof startAgentRun;
}

/**
 * The live wiring. NOTE for the route: when links are open, the wrapped agents
 * behave exactly as they do in the hourly sweep — they record agent_run rows
 * and raise deduped events on the bus, and the owner-briefing agent's
 * forecast read writes tree forecasts back. With the links cut (today) none
 * of that can happen.
 */
export function liveSectionDeps(api: Api, alerts: AlertsProvider, now = new Date()): SectionDeps {
  return {
    now,
    hasDb,
    linkOpen,
    api,
    alerts,
    weather: () => runWeatherAgent(alerts, now),
    booking: () => runBookingAgent(now),
    collections: () => runCollectionsAgent(now),
    safety: () => runSafetyAgent(alerts, now),
    permitting: () => runPermittingAgent(now),
    ownerBriefing: () => runOwnerBriefingAgent(api, now),
    guardrails: loadGuardrails,
    legal: loadLegal,
    knowledgeBase: () => KNOWLEDGE_BASE,
    startRun: startAgentRun,
  };
}

/**
 * The ON-DEMAND wiring (Mike's "Run all eight" tap). Strictly read-only even
 * with the links open: the six scheduled agents are left out — each records
 * an agent_run row and raises bus events, and the owner briefing writes tree
 * forecasts — so they run on the hourly sweep only, and here each is named
 * by hourlyOnly (state 'notrun'; the Dispatcher reads the weather feed itself
 * instead). The section run itself is not recorded.
 */
export function onDemandSectionDeps(api: Api, alerts: AlertsProvider, now = new Date()): SectionDeps {
  const live = liveSectionDeps(api, alerts, now);
  return {
    now: live.now,
    hasDb: live.hasDb,
    linkOpen: live.linkOpen,
    // Read here, from the real switch: the sweep's tick runs only when hasDb()
    // is true (sweep.ts), and the practice-data route overrides hasDb, not this.
    hourlySweep: hasDb(),
    api: live.api,
    alerts: live.alerts,
    guardrails: live.guardrails,
    legal: live.legal,
    knowledgeBase: live.knowledgeBase,
    startRun: async () => ({ id: null, finish: async () => {} }),
  };
}

// ─── Input machinery ────────────────────────────────────────────────────────

interface Read {
  state: 'read' | 'sim' | 'notrun' | 'notbuilt' | 'unreadable';
  detail: string;
  findings?: Finding[];
  proposals?: Proposal[];
  wrapped?: WrappedSummary;
}

interface InputSpec {
  name: string;
  /** Data links this input needs. Empty = not DB-backed. */
  links: DataLink[];
  /** Set when this input IS an existing agent: its throw blocks the section. */
  wraps?: string;
  read: (d: SectionDeps) => Promise<Read>;
}

class WrappedAgentThrew extends Error {}

/** An error from outside, made safe to show: customer shapes scrubbed, capped. */
function errText(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return redact(raw).slice(0, 200);
}

/** The same, with a network failure said in plain words instead of a raw exception. */
function plainErr(err: unknown): string {
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return "the service didn't answer";
  return errText(err);
}

// Not read on purpose — never 'unreadable', which means we tried and could not.
const notWired = (what: string): Read => ({ state: 'notrun', detail: `not connected in this run: ${what}` });
// A wrapped agent left to the hourly sweep: it records runs and raises events, so the button never starts it.
// "Runs on the hourly check" only when that check is armed — in practice data nothing else reads it (§1B).
const hourlyOnly = (d: SectionDeps): Read => d.hourlySweep === false
  ? { state: 'notrun', detail: 'left to the hourly check, which is off until its data is connected' }
  : { state: 'notrun', detail: 'runs on the hourly check, not from this button' };
const propose = (kind: string, text: string): Proposal => ({ kind, text, needsMike: true });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function readInput(spec: InputSpec, d: SectionDeps): Promise<InputReport & { got?: Read }> {
  if (spec.links.length > 0) {
    // The screen names the switch once (Settings carries the variables), never per row.
    if (!d.hasDb()) {
      return { name: spec.name, state: 'cut', detail: 'cut on purpose' };
    }
    if (spec.links.some((l) => !d.linkOpen(l))) {
      return { name: spec.name, state: 'cut', detail: 'cut on purpose — this link is not opened yet' };
    }
  }
  try {
    const got = await spec.read(d);
    return { name: spec.name, state: got.state, detail: got.detail, got };
  } catch (err) {
    // A cut link that slipped past the map above is still a cut — said in the
    // same words; its message names a table and a variable, not for the screen.
    if (err instanceof Error && err.name === 'LinkCutError') {
      return { name: spec.name, state: 'cut', detail: 'cut on purpose' };
    }
    if (spec.wraps) throw new WrappedAgentThrew(`wrapped agent '${spec.wraps}' threw — ${errText(err)}`);
    // The screen prints the input's name and an UNREADABLE chip; the detail is only the why.
    return { name: spec.name, state: 'unreadable', detail: plainErr(err) };
  }
}

/**
 * One app read handler. A non-200 is 'unreadable' with the status named —
 * except the practice data's own gap word (not_simulated): that feed is not
 * in the simulation at all, so nothing was tried and nothing failed.
 */
async function viaApi<T>(
  what: string,
  call: (() => Promise<ApiResult>) | undefined,
  onBody: (body: T) => Read,
): Promise<Read> {
  if (!call) return notWired(what);
  const r = await call();
  if (r.status !== 200) {
    const code = (r.body as { error?: unknown } | null)?.error;
    if (r.status === 503 && code === 'not_simulated') return { state: 'sim', detail: 'not in the practice data' };
    return { state: 'unreadable', detail: `answered ${r.status}${typeof code === 'string' ? ` ${code}` : ''}` };
  }
  return onBody(r.body as T);
}

// ─── The inputs, per section ────────────────────────────────────────────────

/** The Dispatcher's weather read — one shape whether the agent or the feed answered. */
function dispatcherWeather(active: number, stopping: number): Read {
  return {
    state: 'read',
    detail: `${plural(active, 'active alert', 'active alerts')}, ${stopping} work-stopping`,
    findings: stopping > 0
      ? [{ severity: 'act', text: `${plural(stopping, 'work-stopping weather alert is', 'work-stopping weather alerts are')} active over the service area.` }]
      : [{ severity: 'info', text: `${plural(active, 'active NWS alert', 'active NWS alerts')}; none work-stopping.` }],
    proposals: stopping > 0
      ? [propose('weather_hold_review', 'Review outdoor work against the active alerts. Mike moves any event — Arbo never edits the calendar.')]
      : [],
  };
}

const weatherFromAgent: InputSpec = {
  name: IN.weather, links: [], wraps: 'weatherAgent',
  async read(d) {
    if (!d.weather) {
      // On demand the weather agent is left out (it raises bus events), so
      // read the same NWS feed read-only, as the Crew Chief does. Caught
      // here: this input wraps an agent, and a throw would BLOCK the desk.
      if (!d.alerts) return notWired('weather agent');
      try {
        const active = await d.alerts.activeAlerts();
        return dispatcherWeather(active.length, active.filter(isWorkStopping).length);
      } catch (err) {
        return { state: 'unreadable', detail: plainErr(err) };
      }
    }
    const r = await d.weather();
    const wrapped = { agent: 'weather', status: r.status, summary: `feed=${r.feed} active=${r.activeAlerts} work_stopping=${r.workStopping} newly_raised=${r.newlyRaised}` };
    if (r.status !== 'ok' || r.feed !== 'ok') {
      return { state: 'unreadable', detail: 'NWS alerts did not answer — not "no storm"', wrapped };
    }
    return { ...dispatcherWeather(r.activeAlerts, r.workStopping), wrapped };
  },
};

// Read-only twin for the Crew Chief: straight from the feed, raises nothing.
const weatherFromFeed: InputSpec = {
  name: IN.weather, links: [],
  async read(d) {
    if (!d.alerts) return notWired('NWS alerts provider');
    const active = await d.alerts.activeAlerts();
    const stopping = active.filter(isWorkStopping).length;
    return {
      state: 'read',
      detail: `${plural(active.length, 'active alert', 'active alerts')}, ${stopping} work-stopping`,
      findings: stopping > 0
        ? [{ severity: 'act', text: `${plural(stopping, 'work-stopping alert', 'work-stopping alerts')} — the crew briefing must cover it before anyone climbs.` }]
        : [],
      proposals: stopping > 0
        ? [propose('stand_down_review', 'Decide whether crews stand down. Arbo cannot stand anyone down.')]
        : [],
    };
  },
};

const INPUTS: Record<SectionId, InputSpec[]> = {
  'front-desk': [
    {
      name: IN.guardrails, links: [],
      async read(d) {
        if (!d.guardrails) return notWired('guardrails loader');
        const g = d.guardrails();
        return { state: 'read', detail: `guardrails ${g.version}: ${plural(g.goldenRules.length, 'golden rule', 'golden rules')} enforced by guardReply()` };
      },
    },
    {
      name: IN.callBacklog, links: ['calls'],
      read: (d) => viaApi<{ conversations: unknown[] }>(IN.callBacklog, d.api?.reviewBacklog && (() => d.api!.reviewBacklog!(50, true)), (b) => {
        const n = b.conversations.length;
        const shown = n >= 50 ? '50 or more' : String(n);
        return {
          state: 'read', detail: `${shown} unreviewed`,
          findings: n > 0 ? [{ severity: 'watch', text: `${n === 1 ? '1 logged conversation awaits' : `${shown} logged conversations await`} review (§29).` }] : [],
          proposals: n > 0 ? [propose('call_review', `Review ${n === 1 ? '1 logged conversation' : `${shown} logged conversations`}.`)] : [],
        };
      }),
    },
  ],

  dispatcher: [
    weatherFromAgent,
    {
      name: IN.bookedStops, links: ['jobs', 'estimates', 'properties', 'ops'], wraps: 'bookingAgent',
      async read(d) {
        if (!d.booking) return hourlyOnly(d);
        const r = await d.booking();
        const wrapped = { agent: 'booking', status: r.status, summary: `stops=${r.stopsChecked} issues=${r.issues} newly_raised=${r.newlyRaised}` };
        if (r.status !== 'ok') return { state: 'unreadable', detail: 'the booking agent reported an error', wrapped };
        return {
          state: 'read', wrapped,
          detail: `${plural(r.stopsChecked, 'stop', 'stops')} checked for tomorrow`,
          findings: r.issues > 0
            ? [{ severity: 'act', text: `${plural(r.issues, 'booking issue', 'booking issues')} on tomorrow's route (double-booked slot or ZIP-run break).` }]
            : [{ severity: 'info', text: `No double-booking or ZIP-run break across ${plural(r.stopsChecked, 'stop', 'stops')} tomorrow.` }],
          proposals: r.issues > 0
            ? [propose('route_fix', `Resolve ${plural(r.issues, 'booking issue', 'booking issues')} tonight. A suggestion only — Mike moves the event (§3.22).`)]
            : [],
        };
      },
    },
  ],

  'chief-of-staff': [
    {
      name: IN.openLoops, links: ['leads', 'estimates', 'jobs'],
      read: (d) => viaApi<{ open: NeedsDecision[] }>(IN.openLoops, d.api?.queue, (b) => {
        const urgent = b.open.filter((i) => i.severity === 'urgent').length;
        const attention = b.open.length - urgent;
        const findings: Finding[] = [];
        if (urgent > 0) findings.push({ severity: 'act', text: `${plural(urgent, 'urgent open loop', 'urgent open loops')} — someone is waiting on a decision.` });
        if (attention > 0) findings.push({ severity: 'watch', text: `${plural(attention, 'open loop needs', 'open loops need')} attention.` });
        return {
          state: 'read', detail: `${b.open.length} open (${urgent} urgent)`, findings,
          proposals: urgent > 0 ? [propose('decide_open_loops', `Decide ${plural(urgent, 'urgent loop', 'urgent loops')} on the Queue.`)] : [],
        };
      }),
    },
    {
      name: IN.briefing, links: ['estimates', 'jobs', 'properties', 'contacts', 'leads'], wraps: 'ownerBriefingAgent',
      async read(d) {
        if (!d.ownerBriefing) return hourlyOnly(d);
        const r = await d.ownerBriefing();
        const s = r.sections;
        const wrapped = { agent: 'owner-briefing', status: r.status, summary: `brief=${s.brief} loops=${s.openLoops} storm=${s.storm} due=${s.comingDue}` };
        const blind = Object.entries(s).filter(([, v]) => v === 'unavailable').map(([k]) => k);
        if (r.status !== 'ok' || blind.length > 0) {
          return { state: 'unreadable', detail: `briefing incomplete — unreadable: ${blind.join(', ') || 'agent error'}`, wrapped };
        }
        const findings: Finding[] = [];
        if (s.storm === 'alerts') findings.push({ severity: 'watch', text: 'The briefing carries active storm alerts.' });
        if (typeof s.comingDue === 'number' && s.comingDue > 0) findings.push({ severity: 'info', text: `${plural(s.comingDue, 'property is', 'properties are')} coming due for a look.` });
        return { state: 'read', detail: 'every briefing section read', findings, wrapped };
      },
    },
  ],

  'permit-desk': [
    {
      name: IN.permitScreens, links: ['leads', 'permits', 'ops'], wraps: 'permittingAgent',
      async read(d) {
        if (!d.permitting) return hourlyOnly(d);
        const r = await d.permitting();
        const wrapped = { agent: 'permitting', status: r.status, summary: `events=${r.eventsProcessed} screens_missing=${r.screensMissing}` };
        if (r.status !== 'ok') return { state: 'unreadable', detail: 'the permitting agent reported an error', wrapped };
        const n = r.screensMissing;
        return {
          state: 'read', wrapped,
          detail: `${plural(n, 'property', 'properties')} with a recent lead and no screen on file`,
          findings: n > 0
            ? [{ severity: 'act', text: `${plural(n, 'property has', 'properties have')} a lead in the last 14 days and no permit screen on file — PERMIT SCREEN PENDING.`, ref: r.flaggedPropertyIds.slice(0, 10).join(',') }]
            : [{ severity: 'info', text: 'Every property with a lead in the last 14 days has a screen on file.' }],
          proposals: n > 0 ? [propose('run_screen', `Run the permit screen for ${plural(n, 'property', 'properties')}.`)] : [],
        };
      },
    },
    {
      name: IN.permitBoard, links: ['properties', 'permits', 'jobs'],
      read: (d) => viaApi<PermitBoard>(IN.permitBoard, d.api?.permitBoard, (b) => {
        const findings: Finding[] = [];
        if (b.blockedCount > 0) findings.push({ severity: 'act', text: `${plural(b.blockedCount, 'booked job', 'booked jobs')} a crew may not start yet — the permit is not in hand.` });
        if (b.neverScreenedCount > 0) findings.push({ severity: 'watch', text: `${plural(b.neverScreenedCount, 'property has', 'properties have')} never been screened.` });
        // `summary` is counts only by contract (permitBoard.ts) — safe to show.
        return { state: 'read', detail: b.summary, findings };
      }),
    },
    {
      name: IN.legal, links: [],
      async read(d) {
        if (!d.legal) return notWired('legal config loader');
        return { state: 'read', detail: `legal config ${d.legal().version}` };
      },
    },
  ],

  arborist: [
    {
      name: IN.knowledge, links: [],
      async read(d) {
        if (!d.knowledgeBase) return notWired('knowledge base');
        return { state: 'read', detail: `${plural(d.knowledgeBase().length, 'vetted basic-answer entry', 'vetted basic-answer entries')}` };
      },
    },
    {
      name: IN.referenceDrafts, links: ['ops'],
      read: (d) => viaApi<{ count: number }>(IN.referenceDrafts, d.api?.referenceDrafts, (b) => ({
        state: 'read', detail: `${plural(b.count, 'draft', 'drafts')} awaiting a vetter`,
        findings: b.count > 0 ? [{ severity: 'watch', text: `${plural(b.count, 'library draft awaits', 'library drafts await')} a named vetter (§4.7).` }] : [],
        proposals: b.count > 0 ? [propose('vet_reference', `Vet ${plural(b.count, 'library draft', 'library drafts')} — only a named human publishes.`)] : [],
      })),
    },
    {
      // #8 Vision & Labeling has no photo reader in the code yet. Said, not hidden.
      name: IN.photos, links: ['photos'],
      read: async () => ({ state: 'notbuilt', detail: 'there is no photo reader yet' }),
    },
  ],

  'crew-chief': [
    {
      name: IN.crewSafety, links: ['crew', 'safety', 'ops'], wraps: 'safetyAgent',
      async read(d) {
        if (!d.safety) return hourlyOnly(d);
        const r = await d.safety();
        const c = r.certs;
        const wrapped = {
          agent: 'safety', status: r.status,
          summary: `certs=${c.feed} lapsed=${c.lapsed} missing=${c.missing} unknown=${c.unknown} aerial_blocked=${c.aerialBlocked} near_miss=${r.nearMisses.feed} open=${r.nearMisses.openLast30} blind_spots=${r.blindSpots.length}`,
        };
        if (r.status !== 'ok' || c.feed !== 'ok' || r.nearMisses.feed !== 'ok') {
          return { state: 'unreadable', detail: `blind spots: ${r.blindSpots.join('; ') || 'safety agent error'}`, wrapped };
        }
        const findings: Finding[] = [];
        const problems = c.lapsed + c.missing + c.unknown;
        if (problems > 0) findings.push({ severity: 'act', text: `${plural(problems, 'credential problem', 'credential problems')} (lapsed, missing or unknown).` });
        if (c.aerialBlocked > 0) findings.push({ severity: 'act', text: `${plural(c.aerialBlocked, 'crew member is', 'crew members are')} blocked from aerial work until credentials are fixed.` });
        if (c.urgent > 0) findings.push({ severity: 'watch', text: `${plural(c.urgent, 'credential expires', 'credentials expire')} soon.` });
        if (r.nearMisses.openLast30 > 0) findings.push({ severity: 'watch', text: `${plural(r.nearMisses.openLast30, 'near-miss', 'near-misses')} in 30 days with no lesson yet (§6M).` });
        for (const b of r.blindSpots) findings.push({ severity: 'watch', text: `Safety agent blind spot: ${b}` });
        const proposals: Proposal[] = [];
        if (problems > 0) proposals.push(propose('fix_credentials', `Fix ${plural(problems, 'credential problem', 'credential problems')}.`));
        if (r.nearMisses.openLast30 > 0) proposals.push(propose('lesson_draft', 'Turn the open near-misses into lessons — a named human vets each one.'));
        return { state: 'read', detail: `certifications and near-miss log read`, findings, proposals, wrapped };
      },
    },
    {
      name: IN.training, links: ['crew'],
      read: (d) => viaApi<TrainingBoard>(IN.training, d.api?.trainingBoard, (b) => {
        const findings: Finding[] = [];
        if (b.owingThisWeek.length > 0) findings.push({ severity: 'watch', text: `${plural(b.owingThisWeek.length, 'crew member owes', 'crew members owe')} this week's questionnaire.` });
        for (const s of b.blindSpots) findings.push({ severity: 'watch', text: `Training board blind spot: ${s}` });
        return { state: 'read', detail: `${plural(b.rows.length, 'crew member', 'crew members')} on the board`, findings };
      }),
    },
    weatherFromFeed,
  ],

  'yard-boss': [
    {
      name: IN.invoices, links: ['jobs', 'ops'], wraps: 'collectionsAgent',
      async read(d) {
        if (!d.collections) return hourlyOnly(d);
        const r = await d.collections();
        const wrapped = { agent: 'collections', status: r.status, summary: `feed=${r.feed} overdue=${r.overdue} suppressed=${r.suppressed} unknown=${r.unknown} newly_raised=${r.newlyRaised}` };
        if (r.status !== 'ok' || r.feed !== 'ok') {
          return { state: 'unreadable', detail: 'the invoice ledger could not be read — not "nothing overdue"', wrapped };
        }
        const findings: Finding[] = [];
        if (r.overdue > 0) findings.push({ severity: 'act', text: `${plural(r.overdue, 'invoice is', 'invoices are')} past due.` });
        if (r.unknown > 0) findings.push({ severity: 'watch', text: `${plural(r.unknown, 'invoice', 'invoices')} could not be evaluated — unknown, not current.` });
        return {
          state: 'read', detail: `${r.overdue} overdue, ${r.unknown} unknown`, findings, wrapped,
          proposals: r.overdue > 0
            ? [propose('collections_review', `Review ${plural(r.overdue, 'overdue invoice', 'overdue invoices')}. Arbo charges nothing and sends nothing — Mike decides.`)]
            : [],
        };
      },
    },
    {
      name: IN.fleet, links: ['equipment'],
      read: (d) => viaApi<{ units: unknown[]; down: number; held?: number }>(IN.fleet, d.api?.fleetUnits, (b) => {
        // R26: a brake/steering HOLD is its own state — off the schedule until Mike signs it back on.
        const held = b.held ?? 0;
        const them = (n: number) => (n === 1 ? 'it' : 'them');
        return {
          state: 'read', detail: `${plural(b.units.length, 'unit', 'units')}, ${b.down} down${held > 0 ? `, ${held} on hold` : ''}`,
          findings: [
            ...(b.down > 0 ? [{ severity: 'act' as const, text: `${plural(b.down, 'unit is', 'units are')} DOWN — scheduling will not assign ${them(b.down)}.` }] : []),
            ...(held > 0 ? [{ severity: 'act' as const, text: `${plural(held, 'unit is', 'units are')} on a brake/steering HOLD — off the schedule until Mike signs ${them(held)} back on.` }] : []),
          ],
          // Points at what exists: the unit's card under Fleet on the Queue. No breakdown plan is
          // kept to review — it is only shown when a breakdown is filed — so the copy never names one.
          proposals: [
            ...(b.down > 0 ? [propose('parts_review', `Decide on the repair for ${b.down === 1 ? 'the DOWN unit' : `the ${b.down} DOWN units`} under Fleet on the Queue. Arbo never orders parts — a human buys (§6E2.3).`)] : []),
            ...(held > 0 ? [propose('signback_review', `Decide whether ${held === 1 ? 'the held unit is' : `the ${held} held units are`} fixed, then sign ${them(held)} back on under Fleet on the Queue. Only Mike signs a unit back on; Arbo never clears a hold.`)] : []),
          ],
        };
      }),
    },
  ],

  analyst: [
    {
      name: IN.performance, links: ['jobs', 'properties', 'estimates', 'leads'],
      read: (d) => viaApi<AreaReport & { campaignsKnown: boolean }>(IN.performance, d.api?.performance && (() => d.api!.performance!(365)), (b) => {
        const below = b.areas.filter((a) => a.verdict === 'below').length;
        const findings: Finding[] = [];
        if (below > 0) findings.push({ severity: 'watch', text: `${plural(below, 'area rates', 'areas rate')} below the company average per crew-hour.` });
        if (b.withheld.length > 0) findings.push({ severity: 'info', text: `${plural(b.withheld.length, 'area is', 'areas are')} held back for thin data — visible, not judged.` });
        if (!b.campaignsKnown) findings.push({ severity: 'watch', text: 'Campaign performance could not be read — unknown, not "no campaigns".' });
        for (const s of b.blindSpots) findings.push({ severity: 'watch', text: `Performance blind spot: ${s}` });
        return {
          state: 'read', detail: `${plural(b.areas.length, 'area', 'areas')} rated over 365 days`, findings,
          proposals: below > 0
            ? [propose('area_review', below === 1
              ? 'Look at the area rated below the company average before spending there.'
              : `Look at the ${below} areas rated below the company average before spending there.`)]
            : [],
        };
      }),
    },
  ],
};

// ─── Running ────────────────────────────────────────────────────────────────

/** "read:2,cut:1" — counts only, for the audit row (§4.3). */
function tally(values: string[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([k, n]) => `${k}:${n}`).join(',');
}

/** Run one section agent. Never throws for a known id: a failure is 'blocked'. */
export async function runSectionAgent(id: SectionId, deps: SectionDeps): Promise<AgentReport> {
  const def = SECTION_AGENTS.find((a) => a.id === id);
  if (!def) throw new Error(`unknown section agent: ${String(id)}`);
  const report: AgentReport = {
    agentId: def.id, name: def.name, section: def.section,
    ranAt: (deps.now ?? new Date()).toISOString(),
    status: 'ok', inputs: [], findings: [], proposals: [], wrapped: [],
  };

  // Every run is recorded. A recorder that fails is said, never skipped.
  let run: AgentRunHandle | null = null;
  try {
    run = await (deps.startRun ?? startAgentRun)({ agent: `section:${def.id}` });
  } catch (err) {
    report.findings.push({ severity: 'watch', text: `This run was not recorded: ${errText(err)}` });
  }

  try {
    for (const spec of INPUTS[def.id]) {
      const { got, ...input } = await readInput(spec, deps);
      report.inputs.push(input);
      if (got?.wrapped) report.wrapped.push(got.wrapped);
      report.findings.push(...(got?.findings ?? []));
      report.proposals.push(...(got?.proposals ?? []));
    }
    report.status = report.inputs.every((i) => i.state === 'read') ? 'ok' : 'degraded';
  } catch (err) {
    report.status = 'blocked';
    report.error = err instanceof WrappedAgentThrew ? err.message : `section agent failed — ${errText(err)}`;
  }

  try {
    await run?.finish({
      status: report.status === 'blocked' ? 'error' : 'ok',
      // Counts only (§4.3).
      outputSummary: `status=${report.status} inputs=[${tally(report.inputs.map((i) => i.state))}] findings=[${tally(report.findings.map((f) => f.severity))}] proposals=${report.proposals.length}`,
    });
  } catch (err) {
    report.findings.push({ severity: 'watch', text: `This run's audit row did not close: ${errText(err)}` });
  }
  return report;
}

/** Run all eight independently. One failing never stops the other seven. */
export async function runAllSections(deps: SectionDeps): Promise<AgentReport[]> {
  return Promise.all(SECTION_AGENTS.map(async (def) => {
    try {
      return await runSectionAgent(def.id, deps);
    } catch (err) {
      return {
        agentId: def.id, name: def.name, section: def.section,
        ranAt: (deps.now ?? new Date()).toISOString(),
        status: 'blocked' as const, inputs: [], findings: [], proposals: [], wrapped: [],
        error: `section agent failed — ${errText(err)}`,
      };
    }
  }));
}
