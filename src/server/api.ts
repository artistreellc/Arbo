// Backend API handlers (brief §8: one service hosting the policy engine and
// the app's data). Pure functions over an injected DataSource, so every route
// is testable offline and the same handlers run live on the server.
//
// Admin-only surface: in production these sit behind auth (the app's admin
// session). No customer PII in errors or logs (§4.3).

import { loadAllConfig } from '../config/loadConfig.js';
import { buildMorningBrief, briefToSpeech, type MorningBrief, type StopInput } from '../ops/morningBrief.js';
import { buildFollowUpQueue, buildSeasonalOutreach, type EstimateState, type JobState, type PastCustomer } from '../ops/followUps.js';
import { flagStopsAtRisk, isWorkStopping, type AlertsProvider } from '../ops/stormWatch.js';
import { assessRunningLate, detectVisits, withinWorkingHours, type LocationPing, type GeoStop } from '../ops/locationIntel.js';
import { buildDueProperties, buildGrowthOutreach, type GrowthTarget } from '../ops/growthForecast.js';
import { findOpenLoops, type LoopSnapshot } from '../ops/loopCloser.js';
import { quoteCheck, deriveLeakagePct, type QuoteCheckInput } from '../ops/estimating.js';
import { buildCrewPayload, sequenceRoute, type WorkOrderSource } from '../crew/workOrder.js';
import { evaluateGate, buildAcknowledgment, type BriefingContent } from '../crew/briefingGate.js';
import { etToday, etDayWindow } from '../lib/etDay.js';
import { buildActionPlan, isSchedulable, type BreakdownReport, type KnownPart, type UnitStatus } from '../fleet/breakdown.js';
import type { TtsClient } from '../voice/elevenlabsTts.js';
import { scoreLead, type LeadQualityResult } from '../reception/leadQuality.js';
import { integrationStatus } from '../env.js';

/** The §6B screen flag riding a lead — the property's latest permit track. */
export interface ApiPermitFlag {
  screenStatus: 'PERMIT_LIKELY' | 'REVIEW_NEEDED' | 'NO_OVERLAY_VERIFY';
  inRpa: boolean;
  status: string; // lifecycle: needed / applied / approved / not_required_verified
}

export interface ApiLead {
  id: string;
  source: string;
  details: string | null;
  isEmergency: boolean;
  status: string;
  createdAt: string;
  name: string | null;
  /** First phone on file — powers the app's tap-to-call-back (§3 speed-to-lead). */
  phone: string | null;
  /** Missed/abandoned calls and voicemails: the leads most at risk of going cold. */
  needsCallback: boolean;
  city: string | null;
  zip: string | null;
  isFirstTimer: boolean | null;
  quality: LeadQualityResult;
  /** Latest permit screen for the lead's property, when one is on file. */
  permit: ApiPermitFlag | null;
  /** True when the lead HAS a property but NO screen on file — it still needs one (§6B.1). */
  screenPending: boolean;
  /** §5A #27 repeat-customer memory — one human line, e.g. "Job completed Mar 2025 — oak removal". */
  history: string | null;
}

/** What the API needs from storage — live impl wraps the repositories. */
export interface DataSource {
  ready(): boolean;
  stopsBetween(fromIso: string, toIso: string): Promise<StopInput[]>;
  newLeads(limit: number): Promise<ApiLeadInput[]>;
  /** §16–20 queue inputs. Optional until the live source wires it. */
  followUpInputs?(): Promise<{ estimates: EstimateState[]; jobs: JobState[] }>;
  /** Write side of the app's buttons (§5A #14, #16–20 bookkeeping). */
  recordOutcome?(estimateId: string, outcome: 'pending' | 'won' | 'lost' | 'no_show'): Promise<void>;
  recordFollowUpSent?(estimateId: string, atIso: string): Promise<void>;
  recordReviewRequested?(jobId: string, atIso: string): Promise<void>;
  /** §19 seasonal outreach targets: past customers with consent facts. */
  pastCustomers?(): Promise<PastCustomer[]>;
  /** §21–24 location intelligence (owner pings — never customer data). */
  recordPing?(p: { lat: number; lng: number; accuracyM?: number }): Promise<void>;
  pingsSince?(sinceIso: string): Promise<LocationPing[]>;
  getTracking?(): Promise<boolean>;
  setTracking?(on: boolean): Promise<void>;
  /** Day's stops with geocoded coordinates (null when the geocoder had no confident match). */
  geoStops?(fromIso: string, toIso: string): Promise<ApiGeoStop[]>;
  markVisited?(estimateId: string, atIso: string): Promise<void>;
  /** §29 review-loop backlog. */
  conversations?(limit: number, unreviewedOnly: boolean): Promise<unknown[]>;
  markReviewed?(conversationId: string): Promise<void>;
  /** §6 predictive layer: the twin's trees with service history + contact consent facts. */
  growthTargets?(): Promise<GrowthTarget[]>;
  saveTreeForecast?(treeId: string, dueFromIso: string): Promise<void>;
  /** The Book (#36): browse every property; open one to its full twin. */
  properties?(): Promise<unknown[]>;
  propertyTwin?(id: string): Promise<unknown | null>;
  setLeadStatus?(leadId: string, status: 'new' | 'qualified' | 'spam' | 'converted' | 'lost'): Promise<void>;
  /** §1E Loop-Closer: the silence-detection snapshot. */
  loopSnapshot?(): Promise<LoopSnapshot>;
  /** §6J2.4 leakage line: trailing-window actuals + event logging. */
  leakageWindow?(): Promise<{ leakageTotal: number | null; revenueTotal: number | null }>;
  logLeakage?(input: { jobId?: string; unitId?: string; kind: 'equipment_repair' | 'property_damage'; cause?: string; cost: number; notes?: string }): Promise<{ id: string }>;
  /** §8A.6g: recent agent runs for the admin surface. */
  agentRuns?(limit: number): Promise<unknown[]>;
  /** §8A.6b: fire-and-forget event emission (must never break a write). */
  emit?(type: string, payload: Record<string, unknown>): Promise<boolean>;
  /** §3.22: Mike's Google Calendar, mirrored — the app's calendar surface. */
  calendarEvents?(fromIso: string, toIso: string): Promise<unknown[]>;
  /** §6F crew surface: the day's jobs with the site facts a crew may see. */
  crewJobs?(fromIso: string, toIso: string): Promise<CrewJobSource[]>;
  /** §6E fleet: units with their open-task counts. */
  units?(): Promise<unknown[]>;
  /** This unit's OWN parts history — the only source a suggestion may draw on. */
  unitParts?(unitId: string): Promise<KnownPart[]>;
  /** Open maintenance tasks on this unit — NOT a schedule check (see §1B note). */
  unitOpenTaskCount?(unitId: string): Promise<number>;
  /** Current status, or null when no such unit exists. */
  unitStatus?(unitId: string): Promise<UnitStatus | null>;
  recordBreakdown?(input: { unitId: string; newStatus: string; description: string; reportedBy: string; mediaRefs: string[] }): Promise<{ taskId: string }>;
  closeMaintenanceTask?(input: { taskId: string; proofPhotoFile: string; completedBy: string }): Promise<void>;
  /** §6M.8: today's published tailgate briefing, or null if none. */
  todaysBriefing?(): Promise<{ id: string; body: string; standardRefs: string[] } | null>;
  /** §6V.4 gated briefing acknowledgment + its payable time entry (§4.6). */
  recordBriefingAck?(input: {
    crewMemberId: string; itemIds: string[];
    startedAtIso: string; completedAtIso: string; payableMinutes: number;
  }): Promise<{ trainingEventId: string; timeEntryId: string }>;
}

/** What the crew work-order builder needs from storage. */
export interface CrewJobSource {
  jobId: string;
  scheduledFor: string | null;
  address: string;
  city: string;
  scope: string | null;
  hazardPowerLines: boolean;
  hazardStructures: boolean;
  permitStatus: string | null;
  permitScreenPending?: boolean;
  propertyId: string;
}

export interface ApiGeoStop {
  id: string;
  kind: 'estimate' | 'job';
  timeIso: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

/** Optional live feeds beyond the database (weather + voice). */
export interface ApiExtras {
  alerts?: AlertsProvider;
  tts?: TtsClient;
}

export interface ApiLeadInput {
  id: string;
  source: string;
  details: string | null;
  qualification: Record<string, unknown> | null;
  isEmergency: boolean;
  status: string;
  createdAt: string;
  name: string | null;
  phone: string | null;
  propertyId: string | null;
  city: string | null;
  zip: string | null;
  isFirstTimer: boolean | null;
  /** Latest permit track for the lead's property; null when none on file. */
  permit: ApiPermitFlag | null;
  /** Latest prior work at the property (§5A #27); null when none. */
  history: { kind: 'job' | 'estimate'; when: string | null; scope: string | null; status: string | null } | null;
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const IN_AREA = new Set(['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth']);

const OUTCOMES = new Set(['pending', 'won', 'lost', 'no_show']);

const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'America/New_York' });

/** §27: one warm, human line of property memory. */
function formatHistory(h: ApiLeadInput['history']): string | null {
  if (!h) return null;
  const when = h.when ? MONTH_FMT.format(new Date(h.when)) : null;
  if (h.kind === 'job') {
    return `Job ${h.status === 'paid' ? 'done & paid' : 'completed'}${when ? ` ${when}` : ''}${h.scope ? ` — ${h.scope}` : ''}`;
  }
  return `Estimate ${h.status ?? ''}${when ? ` ${when}` : ''}`.trim();
}

export function createApi(source: DataSource, extras: ApiExtras = {}) {
  return {
    /** GET /health — config versions + which integrations are wired. Never leaks values. */
    async health(): Promise<ApiResult> {
      const { guardrails, legal } = loadAllConfig();
      return {
        status: 200,
        body: {
          ok: true,
          guardrailsVersion: guardrails.version,
          legalVersion: legal.version,
          db: source.ready(),
          integrations: integrationStatus(),
        },
      };
    },

    /** GET /api/brief?from=ISO&to=ISO — the Morning Brief for a window. */
    async brief(fromIso: string, toIso: string): Promise<ApiResult> {
      if (!source.ready()) return { status: 503, body: { error: 'db_not_configured' } };
      if (!fromIso || !toIso || Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso))) {
        return { status: 400, body: { error: 'bad_window' } };
      }
      const stops = await source.stopsBetween(fromIso, toIso);
      const brief: MorningBrief = buildMorningBrief(stops);
      return { status: 200, body: brief };
    },

    /** GET /api/leads — inbox with the quiet hot/warm/cool read (§3.14). */
    async leads(limit = 25): Promise<ApiResult> {
      if (!source.ready()) return { status: 503, body: { error: 'db_not_configured' } };
      const rows = await source.newLeads(limit);
      const leads: ApiLead[] = rows.map((r) => {
        const q = r.qualification ?? {};
        const needsCallback = ['missed', 'abandoned', 'voicemail'].includes(String(q['kind'] ?? ''));
        return {
          id: r.id,
          source: r.source,
          details: r.details,
          isEmergency: r.isEmergency,
          status: r.status,
          createdAt: r.createdAt,
          name: r.name,
          phone: r.phone,
          needsCallback,
          city: r.city,
          zip: r.zip,
          isFirstTimer: r.isFirstTimer,
          quality: scoreLead({
            inServiceArea: r.city != null ? IN_AREA.has(r.city) : undefined,
            urgency: r.isEmergency ? 'emergency' : (q['urgency'] as never) ?? 'unknown',
            scopeClarity: r.details && r.details.length > 20 ? 'specific' : r.details ? 'vague' : 'unknown',
            gaveAddress: r.city != null,
          }),
          permit: r.permit,
          // A lead with a property but no screen on file still needs one (§6B.1)
          // — surfaced, never silently assumed fine.
          screenPending: r.propertyId != null && r.permit == null,
          history: formatHistory(r.history),
        };
      });
      return { status: 200, body: { leads } };
    },

    /**
     * GET /api/followups — the §16–20 queue: what's due (recommend-only, Mike
     * approves every send) and what's legally suppressed, with reasons.
     */
    async followUps(): Promise<ApiResult> {
      if (!source.ready() || !source.followUpInputs) return { status: 503, body: { error: 'db_not_configured' } };
      const { legal } = loadAllConfig();
      const { estimates, jobs } = await source.followUpInputs();
      const now = new Date();
      const queue = buildFollowUpQueue(legal, estimates, jobs, now);
      // §19 — pre-storm nudges join the queue only when real weather is coming.
      // A dead feed just omits them (honest: absence of nudges is not a claim),
      // flagged so the app can say so.
      // §6 growth outreach: due properties join the queue through the same
      // gates. Auxiliary like seasonal — a failure omits nudges and says so.
      let growthUnavailable = false;
      if (source.growthTargets) {
        try {
          const growth = buildGrowthOutreach(legal, await source.growthTargets(), now);
          queue.due.push(...growth.due);
          queue.suppressed.push(...growth.suppressed);
        } catch {
          growthUnavailable = true;
        }
      }
      let seasonalUnavailable = false;
      if (extras.alerts && source.pastCustomers) {
        try {
          const alerts = (await extras.alerts.activeAlerts()).filter(isWorkStopping);
          if (alerts.length > 0) {
            const cities = [...new Set(alerts.flatMap((a) => a.cities))];
            const seasonal = buildSeasonalOutreach(
              legal,
              { citiesUnderAlert: cities, event: alerts[0]!.event },
              await source.pastCustomers(),
              now,
            );
            queue.due.push(...seasonal.due);
            queue.suppressed.push(...seasonal.suppressed);
          }
        } catch {
          seasonalUnavailable = true;
        }
      }
      return { status: 200, body: { ...queue, seasonalUnavailable, growthUnavailable } };
    },

    /**
     * GET /api/forecast — §6: every property with a tree in its due/overdue
     * window, worst first. Computing here also writes each due tree's
     * next_due_forecast back to the twin (the Phase-1 column, filled at last).
     */
    async forecast(now = new Date()): Promise<ApiResult> {
      if (!source.ready() || !source.growthTargets) return { status: 503, body: { error: 'db_not_configured' } };
      const due = buildDueProperties(await source.growthTargets(), now);
      if (source.saveTreeForecast) {
        for (const p of due) {
          for (const f of p.forecasts) {
            try {
              await source.saveTreeForecast(f.treeId, f.dueFromIso.slice(0, 10));
            } catch {
              // Write-through is bookkeeping; the forecast answer stands without it.
            }
          }
        }
      }
      return { status: 200, body: { due, basis: 'general growth cycles — recommend a look, never a diagnosis' } };
    },

    /** GET /api/brief/audio — the §3.17 SPOKEN brief (MP3). 503 until the TTS key lands. */
    async briefAudio(fromIso: string, toIso: string): Promise<ApiResult & { audio?: Uint8Array }> {
      if (!extras.tts) return { status: 503, body: { error: 'tts_not_configured' } };
      const res = await this.brief(fromIso, toIso);
      if (res.status !== 200) return res;
      const audio = await extras.tts.synthesize(briefToSpeech(res.body as MorningBrief));
      return { status: 200, body: null, audio };
    },

    /** POST /api/estimates/:id/outcome — Mike's won/lost/no-show tap (§5A #14). */
    async setOutcome(estimateId: string, outcome: string): Promise<ApiResult> {
      if (!source.ready() || !source.recordOutcome) return { status: 503, body: { error: 'db_not_configured' } };
      if (!estimateId || !OUTCOMES.has(outcome)) return { status: 400, body: { error: 'bad_outcome' } };
      await source.recordOutcome(estimateId, outcome as 'pending' | 'won' | 'lost' | 'no_show');
      return { status: 200, body: { ok: true } };
    },

    /**
     * POST /api/followups/:kind/:id/sent — records that Mike actually sent a
     * queued follow-up or review request. This is the ONLY way the cadence
     * advances: ARBOR never marks its own recommendations as done.
     */
    async markFollowUpSent(kind: string, id: string): Promise<ApiResult> {
      if (!source.ready()) return { status: 503, body: { error: 'db_not_configured' } };
      const now = new Date().toISOString();
      if (kind === 'estimate' && source.recordFollowUpSent) {
        await source.recordFollowUpSent(id, now);
        return { status: 200, body: { ok: true } };
      }
      if (kind === 'review' && source.recordReviewRequested) {
        await source.recordReviewRequested(id, now);
        return { status: 200, body: { ok: true } };
      }
      return { status: 400, body: { error: 'bad_kind' } };
    },

    /**
     * GET /api/storm — §5A #26. Honest tri-state: alerts (possibly empty) when
     * the feed answered, 503 when it didn't. A dead feed is NEVER clear skies.
     */
    async storm(): Promise<ApiResult> {
      if (!extras.alerts) return { status: 503, body: { error: 'weather_not_configured' } };
      let alerts;
      try {
        alerts = await extras.alerts.activeAlerts();
      } catch (err) {
        console.error('[storm] feed failed:', err instanceof Error ? err.message : 'error');
        return { status: 503, body: { error: 'weather_unavailable' } };
      }
      let atRisk: ReturnType<typeof flagStopsAtRisk> = [];
      if (source.ready() && alerts.length > 0) {
        const from = new Date();
        const to = new Date(from.getTime() + 48 * 60 * 60 * 1000);
        const stops = await source.stopsBetween(from.toISOString(), to.toISOString());
        atRisk = flagStopsAtRisk(
          alerts,
          stops.map((s) => ({ id: s.id, city: s.city, timeIso: s.timeIso ?? null })),
          from,
        );
      }
      return { status: 200, body: { alerts, atRisk } };
    },

    /**
     * POST /api/location/ping — Mike's phone checks in. The §24 law runs
     * HERE, before anything touches storage: master switch ON, working hours
     * only. Refusals carry a named reason — never a silent drop.
     */
    async locationPing(body: { lat?: unknown; lng?: unknown; accuracyM?: unknown }, now = new Date()): Promise<ApiResult> {
      if (!source.ready() || !source.recordPing || !source.getTracking) return { status: 503, body: { error: 'db_not_configured' } };
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return { status: 400, body: { error: 'bad_coordinates' } };
      }
      if (!(await source.getTracking())) return { status: 403, body: { error: 'tracking_off' } };
      if (!withinWorkingHours(now)) return { status: 403, body: { error: 'after_hours' } };
      const accuracyM = Number(body.accuracyM);
      await source.recordPing({ lat, lng, ...(Number.isFinite(accuracyM) ? { accuracyM } : {}) });
      return { status: 200, body: { ok: true } };
    },

    /** POST /api/location/tracking — the §24 master switch, clear ON/OFF. */
    async locationTracking(on: unknown): Promise<ApiResult> {
      if (!source.ready() || !source.setTracking) return { status: 503, body: { error: 'db_not_configured' } };
      if (typeof on !== 'boolean') return { status: 400, body: { error: 'bad_toggle' } };
      await source.setTracking(on);
      return { status: 200, body: { tracking: on } };
    },

    /**
     * GET /api/location/status — tracking state + the #23 running-late read
     * against the next timed stop. recommendOnly always: ARBOR drafts, Mike
     * sends.
     */
    async locationStatus(now = new Date()): Promise<ApiResult> {
      if (!source.ready() || !source.getTracking || !source.pingsSince) return { status: 503, body: { error: 'db_not_configured' } };
      const tracking = await source.getTracking();
      const pings = tracking ? await source.pingsSince(new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()) : [];
      const latest = pings.length > 0 ? pings[pings.length - 1]! : null;
      let next: GeoStop | null = null;
      if (latest && source.geoStops) {
        const from = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
        const to = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
        const upcoming = (await source.geoStops(from, to))
          .filter((s) => s.timeIso && s.lat != null && s.lng != null)
          .sort((a, b) => (a.timeIso ?? '').localeCompare(b.timeIso ?? ''));
        const s = upcoming[0];
        if (s) next = { id: s.id, kind: s.kind, lat: s.lat!, lng: s.lng!, timeIso: s.timeIso, ...(s.name ? { name: s.name } : {}) };
      }
      return {
        status: 200,
        body: {
          tracking,
          lastPingIso: latest?.atIso ?? null,
          late: tracking ? assessRunningLate(latest, next, now) : { state: 'no_data', recommendOnly: true },
        },
      };
    },

    /**
     * GET /api/location/day — #21: which estimate stops the pings actually
     * reached. Tri-state honest per stop; confirmed visits are persisted so
     * the follow-up engine anchors on the REAL visit, not the slot.
     */
    async locationDay(fromIso: string, toIso: string): Promise<ApiResult> {
      if (!source.ready() || !source.pingsSince || !source.geoStops) return { status: 503, body: { error: 'db_not_configured' } };
      if (!fromIso || !toIso || Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso))) {
        return { status: 400, body: { error: 'bad_window' } };
      }
      const [stops, pings] = await Promise.all([source.geoStops(fromIso, toIso), source.pingsSince(fromIso)]);
      const windowPings = pings.filter((p) => p.atIso <= toIso);
      const located = stops.filter((s): s is ApiGeoStop & { lat: number; lng: number } => s.lat != null && s.lng != null);
      const checks = detectVisits(
        windowPings,
        located.map((s) => ({ id: s.id, kind: s.kind, lat: s.lat, lng: s.lng, timeIso: s.timeIso })),
      );
      if (source.markVisited) {
        for (const c of checks) {
          const stop = located.find((s) => s.id === c.stopId);
          if (c.visited === true && c.firstSeenIso && stop?.kind === 'estimate') {
            await source.markVisited(c.stopId, c.firstSeenIso);
          }
        }
      }
      const unlocatable = stops.filter((s) => s.lat == null || s.lng == null).map((s) => ({ stopId: s.id, visited: 'no_data' as const }));
      return { status: 200, body: { checks: [...checks, ...unlocatable], pingCount: windowPings.length } };
    },

    /** GET /api/review/backlog — §29: the logged conversations awaiting review. */
    async reviewBacklog(limit = 20, unreviewedOnly = true): Promise<ApiResult> {
      if (!source.ready() || !source.conversations) return { status: 503, body: { error: 'db_not_configured' } };
      return { status: 200, body: { conversations: await source.conversations(limit, unreviewedOnly) } };
    },

    /**
     * GET /api/properties — the Book: every property, with the §6 coming-due
     * read merged on so the money list and the property list are one surface.
     */
    async properties(now = new Date()): Promise<ApiResult> {
      if (!source.ready() || !source.properties) return { status: 503, body: { error: 'db_not_configured' } };
      const list = await source.properties();
      let due: ReturnType<typeof buildDueProperties> = [];
      let forecastUnavailable = false;
      if (source.growthTargets) {
        try {
          due = buildDueProperties(await source.growthTargets(), now);
        } catch {
          // Forecast read failure never hides the Book itself — but it must
          // be NAMED: a dead forecast is not "nothing due" (§1B).
          forecastUnavailable = true;
        }
      }
      const dueById = new Map(due.map((d) => [d.propertyId, d]));
      const properties = (list as Array<{ id: string }>).map((p) => ({
        ...p,
        due: dueById.get(p.id) ? { state: dueById.get(p.id)!.state, note: dueById.get(p.id)!.note } : null,
      }));
      return { status: 200, body: { properties, comingDue: forecastUnavailable ? null : due, forecastUnavailable } };
    },

    /** GET /api/properties/:id — one property's full twin. */
    async propertyTwin(id: string): Promise<ApiResult> {
      if (!source.ready() || !source.propertyTwin) return { status: 503, body: { error: 'db_not_configured' } };
      if (!id) return { status: 400, body: { error: 'bad_id' } };
      const twin = await source.propertyTwin(id);
      if (!twin) return { status: 404, body: { error: 'not_found' } };
      return { status: 200, body: twin };
    },

    /** POST /api/leads/:id/status — Mike's qualify/spam/converted/lost tap. */
    async setLeadStatus(id: string, status: string): Promise<ApiResult> {
      if (!source.ready() || !source.setLeadStatus) return { status: 503, body: { error: 'db_not_configured' } };
      if (!id || !['new', 'qualified', 'spam', 'converted', 'lost'].includes(status)) {
        return { status: 400, body: { error: 'bad_status' } };
      }
      await source.setLeadStatus(id, status as 'new' | 'qualified' | 'spam' | 'converted' | 'lost');
      return { status: 200, body: { ok: true } };
    },

    /** POST /api/review/:id/reviewed — Mike (or the chat analyst on his behalf) closes one out. */
    async markReviewed(id: string): Promise<ApiResult> {
      if (!source.ready() || !source.markReviewed) return { status: 503, body: { error: 'db_not_configured' } };
      if (!id) return { status: 400, body: { error: 'bad_id' } };
      await source.markReviewed(id);
      return { status: 200, body: { ok: true } };
    },

    /**
     * GET /api/queue — the §1E backup brain: every open loop the day left
     * behind, worst first. Silence is never treated as success; each item is
     * a decision Mike still owes someone.
     */
    async queue(): Promise<ApiResult> {
      if (!source.ready() || !source.loopSnapshot) return { status: 503, body: { error: 'db_not_configured' } };
      const snapshot = await source.loopSnapshot();
      const open = findOpenLoops(snapshot);
      // Read-only by design: a GET must be idempotent. needs_decision events
      // are emitted by the scheduled agent sweep (deduped there), never by
      // the app polling this endpoint every minute.
      return { status: 200, body: { open, checkedAtIso: snapshot.nowIso } };
    },

    /**
     * POST /api/estimating/check — the §6J2 yard check. INTERNAL ONLY: this
     * result is Mike's instrument, never a customer artifact; the leakage load
     * is re-derived from logged actuals, defaulting honestly when data is thin.
     */
    async estimatingCheck(body: Record<string, unknown>): Promise<ApiResult> {
      const jobType = String(body.jobType ?? '');
      const hours = Number(body.truckToTruckHours);
      const crew = Number(body.crewSize);
      const price = Number(body.quotedPrice);
      const labor = Number(body.loadedLaborPerManHour);
      if (!['removal', 'pruning', 'other'].includes(jobType)) return { status: 400, body: { error: 'bad_job_type' } };
      if (!Number.isFinite(hours) || hours <= 0) return { status: 400, body: { error: 'bad_hours' } };
      if (!Number.isFinite(crew) || crew < 1) return { status: 400, body: { error: 'bad_crew' } };
      if (!Number.isFinite(price) || price <= 0) return { status: 400, body: { error: 'bad_price' } };
      if (!Number.isFinite(labor) || labor <= 0) return { status: 400, body: { error: 'bad_labor_rate' } };

      let leakage: ReturnType<typeof deriveLeakagePct> = { pct: 0.08, basis: 'default_insufficient_data' };
      if (source.ready() && source.leakageWindow) {
        try {
          leakage = deriveLeakagePct(await source.leakageWindow());
        } catch {
          // DB hiccup: the default 8% stands, named as default below.
        }
      }
      const input: QuoteCheckInput = {
        jobType: jobType as QuoteCheckInput['jobType'],
        truckToTruckHours: hours,
        crewSize: crew,
        quotedPrice: price,
        loadedLaborPerManHour: labor,
        leakagePct: leakage.pct,
        ...(Number.isFinite(Number(body.equipmentCost)) ? { equipmentCost: Number(body.equipmentCost) } : {}),
        ...(Number.isFinite(Number(body.dumpFees)) ? { dumpFees: Number(body.dumpFees) } : {}),
        ...(Number.isFinite(Number(body.materials)) ? { materials: Number(body.materials) } : {}),
      };
      return { status: 200, body: { ...quoteCheck(input), leakageBasis: leakage.basis } };
    },

    /** POST /api/leakage — log one §6J2.4 leakage event (repair or damage). */
    async logLeakage(body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.logLeakage) return { status: 503, body: { error: 'db_not_configured' } };
      const kind = String(body.kind ?? '');
      const cost = Number(body.cost);
      if (!['equipment_repair', 'property_damage'].includes(kind)) return { status: 400, body: { error: 'bad_kind' } };
      if (!Number.isFinite(cost) || cost < 0) return { status: 400, body: { error: 'bad_cost' } };
      const created = await source.logLeakage({
        kind: kind as 'equipment_repair' | 'property_damage',
        cost,
        ...(typeof body.jobId === 'string' ? { jobId: body.jobId } : {}),
        ...(typeof body.unitId === 'string' ? { unitId: body.unitId } : {}),
        ...(typeof body.cause === 'string' ? { cause: body.cause } : {}),
        ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
      });
      if (source.emit) await source.emit('leakage.logged', { id: created.id, kind });
      return { status: 200, body: { ok: true, id: created.id } };
    },

    /**
     * GET /api/calendar?from=ISO&to=ISO — THE CALENDAR. These are Mike's own
     * Google Calendar events (mirrored hourly, his manual moves win — §3.22);
     * Arbo never creates a calendar of its own and never writes to his.
     */
    async calendar(fromIso: string, toIso: string): Promise<ApiResult> {
      if (!source.ready() || !source.calendarEvents) return { status: 503, body: { error: 'db_not_configured' } };
      if (!fromIso || !toIso || Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso))) {
        return { status: 400, body: { error: 'bad_window' } };
      }
      return {
        status: 200,
        body: {
          events: await source.calendarEvents(fromIso, toIso),
          calendarId: 'artistreeofvirginia@gmail.com',
          source: 'google_calendar_mirror',
          readOnly: true,
        },
      };
    },

    /**
     * GET /api/crew/workorders?date=YYYY-MM-DD — the §6F crew day. The payload
     * is built by buildCrewPayload(), which has NO slot for price, tracking,
     * or customer contact: admin data is excluded by construction, not by
     * remembering to filter it (§8C.1).
     */
    async crewWorkOrders(dateIso: string, briefingId: string | null = null): Promise<ApiResult> {
      if (!source.ready() || !source.crewJobs) return { status: 503, body: { error: 'db_not_configured' } };
      // The crew's day is the HAMPTON ROADS day, not the server's UTC day —
      // a 9pm-ET open must not hand them tomorrow's sheet.
      const day = dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : etToday();
      const { startUtc, endUtc } = etDayWindow(day);
      const rows = await source.crewJobs(startUtc.toISOString(), endUtc.toISOString());
      const sources: WorkOrderSource[] = rows.map((r, i) => ({
        jobId: r.jobId,
        routeOrder: i + 1,
        address: r.address,
        city: r.city,
        timeIso: r.scheduledFor,
        scope: r.scope,
        hazardPowerLines: r.hazardPowerLines,
        hazardStructures: r.hazardStructures,
        permitStatus: (['PERMIT_LIKELY', 'REVIEW_NEEDED', 'NO_OVERLAY_VERIFY'] as const)
          .find((s) => s === r.permitStatus) ?? null,
        permitScreenPending: r.permitScreenPending === true,
        photoRefs: [],
        briefingId,
      }));
      return {
        status: 200,
        body: { date: day, workOrders: sequenceRoute(sources).map(buildCrewPayload) },
      };
    },

    /**
     * GET /api/crew/briefing — today's published tailgate briefing (§6M.8).
     * Standards are cited BY CLAUSE, never reproduced (§6U.3). 404 when the
     * office hasn't published one — the crew is told, never given a blank.
     */
    async crewBriefing(): Promise<ApiResult> {
      if (!source.ready() || !source.todaysBriefing) return { status: 503, body: { error: 'db_not_configured' } };
      const brief = await source.todaysBriefing();
      if (!brief) return { status: 404, body: { error: 'no_briefing_published' } };
      return { status: 200, body: brief };
    },

    /**
     * POST /api/crew/briefing/ack — the §6V.4 gate. All three conditions or
     * the day stays locked; a passing gate ALWAYS writes payable time (§4.6).
     */
    async ackBriefing(body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.recordBriefingAck) return { status: 503, body: { error: 'db_not_configured' } };
      const crewMemberId = String(body.crewMemberId ?? '');
      const content = body.content as BriefingContent | undefined;
      const state = body.state as { scrolledToBottom?: boolean; checkboxTicked?: boolean; secondsOnScreen?: number } | undefined;
      const startedAtIso = String(body.startedAtIso ?? '');
      const completedAtIso = String(body.completedAtIso ?? '');
      if (!crewMemberId || !content?.id || !content?.body || !state) return { status: 400, body: { error: 'bad_request' } };
      const startedMs = Date.parse(startedAtIso);
      const completedMs = Date.parse(completedAtIso);
      if (Number.isNaN(startedMs) || Number.isNaN(completedMs)) {
        return { status: 400, body: { error: 'bad_times' } };
      }
      // Client-supplied timestamps decide PAY. Reject reversed spans outright;
      // buildAcknowledgment clamps the upper end (a briefing ack is seconds,
      // never hours — an unclamped span writes a fraudulent payroll row).
      if (completedMs <= startedMs) return { status: 400, body: { error: 'bad_times' } };
      // item_ids is uuid[]: a non-UUID here commits the paid time entry and
      // then fails the acknowledgment insert, which is the worst outcome.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(content.id)) {
        return { status: 400, body: { error: 'bad_item_id' } };
      }
      const gateState = {
        scrolledToBottom: state.scrolledToBottom === true,
        checkboxTicked: state.checkboxTicked === true,
        secondsOnScreen: Number(state.secondsOnScreen ?? 0),
      };
      const verdict = evaluateGate(content, gateState);
      if (!verdict.unlocked) {
        // Not an error — the honest answer is "not yet, and here's what's left".
        return { status: 200, body: { unlocked: false, missing: verdict.missing, requiredSeconds: verdict.requiredSeconds } };
      }
      const ack = buildAcknowledgment({ content, state: gateState, crewMemberId, startedAtIso, completedAtIso });
      const saved = await source.recordBriefingAck({
        crewMemberId: ack.crewMemberId,
        itemIds: ack.itemIds,
        startedAtIso: ack.startedAtIso,
        completedAtIso: ack.completedAtIso,
        payableMinutes: ack.payableMinutes,
      });
      if (source.emit) await source.emit('briefing.acknowledged', { crewMemberId, trainingEventId: saved.trainingEventId });
      return { status: 200, body: { unlocked: true, payableMinutes: ack.payableMinutes, ...saved } };
    },

    /** GET /api/fleet/units — the fleet with what each unit still owes (§6E). */
    async fleetUnits(): Promise<ApiResult> {
      if (!source.ready() || !source.units) return { status: 503, body: { error: 'db_not_configured' } };
      const units = (await source.units()) as Array<{ status: string }>;
      return {
        status: 200,
        body: {
          units: units.map((u) => ({ ...u, schedulable: isSchedulable(u.status as never) })),
          down: units.filter((u) => u.status === 'down').length,
        },
      };
    },

    /**
     * POST /api/fleet/breakdown — the §6E field report. Marks the unit DOWN
     * (scheduling stops assigning it) and returns an action plan. Arbo NEVER
     * orders and holds no card (§6E2.3): the plan deep-links, a human buys.
     */
    async reportBreakdown(body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.recordBreakdown || !source.unitParts) {
        return { status: 503, body: { error: 'db_not_configured' } };
      }
      const unitId = String(body.unitId ?? '');
      const description = String(body.description ?? '').trim();
      const reportedBy = String(body.reportedBy ?? '');
      if (!unitId || !description) return { status: 400, body: { error: 'bad_request' } };
      const report: BreakdownReport = {
        unitId,
        reportedBy,
        description,
        mediaRefs: Array.isArray(body.mediaRefs) ? (body.mediaRefs as unknown[]).map(String) : [],
        immobilized: body.immobilized === true,
        atIso: new Date().toISOString(),
      };
      let parts: KnownPart[] = [];
      try {
        parts = await source.unitParts(unitId);
      } catch {
        // No parts history is not "no parts needed" — the plan says so below.
        parts = [];
      }
      // The unit must exist before we write anything — otherwise the status
      // update silently hits zero rows and the task insert dies on the FK.
      const current = source.unitStatus ? await source.unitStatus(unitId) : null;
      if (source.unitStatus && !current) return { status: 404, body: { error: 'unknown_unit' } };
      if (current === 'retired') return { status: 409, body: { error: 'unit_retired' } };
      let openTasks = 0;
      try {
        openTasks = source.unitOpenTaskCount ? await source.unitOpenTaskCount(unitId) : 0;
      } catch { /* absence of the count is not a claim either way */ }
      // 'unknown' is the truth today: no unit→job link exists in the schema.
      // currentStatus is passed so a "still drivable" report can never
      // un-ground a unit that is already DOWN.
      const plan = buildActionPlan(report, parts, {
        openTasks, assignment: 'unknown', currentStatus: current ?? 'up',
      });
      const saved = await source.recordBreakdown({
        unitId, newStatus: plan.newStatus, description, reportedBy, mediaRefs: report.mediaRefs,
      });
      if (source.emit) await source.emit('equipment.failed', { unitId, taskId: saved.taskId, status: plan.newStatus });
      return { status: 200, body: { ...plan, taskId: saved.taskId } };
    },

    /**
     * POST /api/fleet/maintenance/:id/close — §6E2.4: a maintenance task can
     * ONLY close with a photo of the serviced part. Never a checkbox.
     */
    async closeMaintenance(taskId: string, body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.closeMaintenanceTask) return { status: 503, body: { error: 'db_not_configured' } };
      const proofPhotoFile = String(body.proofPhotoFile ?? '').trim();
      if (!taskId) return { status: 400, body: { error: 'bad_id' } };
      if (!proofPhotoFile) return { status: 400, body: { error: 'photo_proof_required' } };
      await source.closeMaintenanceTask({
        taskId, proofPhotoFile, completedBy: String(body.completedBy ?? ''),
      });
      if (source.emit) await source.emit('maintenance.closed', { taskId });
      return { status: 200, body: { ok: true } };
    },

    /** GET /api/agents/runs — §8A.6g audit visibility: what the agents did. */
    async agentRuns(limit = 20): Promise<ApiResult> {
      if (!source.ready() || !source.agentRuns) return { status: 503, body: { error: 'db_not_configured' } };
      return { status: 200, body: { runs: await source.agentRuns(limit) } };
    },
  };
}
