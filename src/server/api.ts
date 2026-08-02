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
import { etToday, etDayWindow, etWeekStart } from '../lib/etDay.js';
import {
  buildInvoiceDrafts, buildCollectionQueue, derivedStatus, daysOverdue, lateFeeOwed,
  safeLateFeePct, DEFAULT_NET_DAYS, type InvoiceableJob, type OpenInvoice,
} from '../ops/invoicing.js';
import { fileNearMiss, NearMissRejected, type NearMissReport } from '../safety/nearMiss.js';
import { findCertProblems, type CertRow, type CrewMemberRef } from '../safety/certifications.js';
import { buildLessonDraft } from '../training/fromNearMiss.js';
import {
  selectQuestionnaire, buildGateCompletion, updateProfile, GateRejected,
  defaultQuestionnaireConfig, type TrainingItemRef, type TrainingProfile, type GateContext,
} from '../training/questionnaire.js';
import { toCrewFacing, gradeSubmission, type GradableItem } from '../training/grading.js';
import { buildTrainingBoard, type CrewProfileRow, type GateCompletionRow } from '../training/board.js';
import { buildActionPlan, isSchedulable, type BreakdownReport, type KnownPart, type UnitStatus } from '../fleet/breakdown.js';
import type { TtsClient } from '../voice/elevenlabsTts.js';
import { scoreLead, type LeadQualityResult } from '../reception/leadQuality.js';
import { integrationStatus } from '../env.js';

/** Postgres uuid shape. Non-UUID ids must be rejected BEFORE any write. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  /** §4.8 money loop: completed work and whether it has been billed. */
  billableJobs?(): Promise<InvoiceableJob[]>;
  openInvoices?(): Promise<OpenInvoice[]>;
  /** 'already_invoiced' when the one-live-invoice-per-job constraint fired. */
  createInvoice?(input: { jobId: string; amount: number; lateFeePct: number; netDays: number }): Promise<{ id: string } | 'already_invoiced'>;
  /** Returns false when no such invoice exists — never a silent no-op success. */
  setInvoiceStatus?(invoiceId: string, status: 'sent' | 'paid' | 'void'): Promise<boolean>;
  /** §6V safety spine. */
  fileNearMiss?(input: {
    reportedBy: string; jobId: string | null; description: string;
    occurredOn: string; hazardCategory: string;
  }): Promise<{ id: string }>;
  activeCrew?(): Promise<CrewMemberRef[]>;
  certifications?(): Promise<CertRow[]>;
  recentNearMisses?(sinceDate: string): Promise<unknown[]>;
  /** §6M training loop. */
  createLessonDraft?(input: {
    nearMissId: string; topic: string; body: unknown; difficulty: number; vetterNotes: string[];
  }): Promise<{ id: string }>;
  trainingPool?(): Promise<TrainingItemRef[]>;
  /** Full rows INCLUDING the answer key. Server-side only — never serialised. */
  trainingItems?(ids: string[]): Promise<GradableItem[]>;
  /** §6M.5 training board. */
  crewProfiles?(): Promise<CrewProfileRow[]>;
  gateCompletionsSince?(sinceIso: string): Promise<GateCompletionRow[]>;
  /** §4.7 vetting queue: drafts awaiting a named human. */
  pendingDrafts?(): Promise<Array<{ id: string; topic: string; body: Record<string, unknown>; createdAt: string; originNearMissId: string | null }>>;
  /** Returns false when the draft is gone or already published. */
  publishLesson?(itemId: string, vettedBy: string): Promise<boolean>;
  trainingProfile?(crewMemberId: string): Promise<TrainingProfile>;
  saveTrainingProfile?(crewMemberId: string, profile: TrainingProfile): Promise<void>;
  recordGate?(input: {
    crewMemberId: string; context: string; itemIds: string[];
    startedAtIso: string; completedAtIso: string; payableMinutes: number; score: number | null;
  }): Promise<{ trainingEventId: string; timeEntryId: string }>;
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
      if (!UUID_RE.test(content.id)) {
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

    /**
     * GET /api/money — the §4.8 money loop in one read: what should be billed,
     * what is owed, and what Arbo could NOT work out. Arbo never sets a price,
     * so a completed job with no agreed figure appears in `blocked` with the
     * reason, not as an invented amount.
     */
    async money(): Promise<ApiResult> {
      if (!source.ready() || !source.billableJobs || !source.openInvoices) {
        return { status: 503, body: { error: 'db_not_configured' } };
      }
      const nowIso = new Date().toISOString();
      const { legal } = loadAllConfig();
      const [jobs, invoices] = await Promise.all([source.billableJobs(), source.openInvoices()]);
      const { drafts, blocked } = buildInvoiceDrafts(jobs);
      const queue = buildCollectionQueue(legal, invoices, new Date(nowIso));
      return {
        status: 200,
        body: {
          drafts,
          blocked,
          collections: queue.due,
          suppressed: queue.suppressed,
          unknown: queue.unknown,
          invoices: invoices.map((inv) => ({
            id: inv.id,
            jobId: inv.jobId,
            name: inv.name ?? null,
            amount: inv.amount,
            status: derivedStatus(inv, nowIso) ?? 'unknown',
            daysOverdue: daysOverdue(inv, nowIso),
            lateFeeOwed: lateFeeOwed(inv, nowIso),
            lateFeePct: safeLateFeePct(inv.lateFeePct),
          })),
          checkedAtIso: nowIso,
        },
      };
    },

    /**
     * POST /api/invoices — create the draft for a completed job. The amount is
     * NOT accepted from the request: it is read from the job's agreed figure,
     * so no client (and no agent) can talk Arbo into a price (§3).
     */
    async createInvoice(body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.billableJobs || !source.createInvoice) {
        return { status: 503, body: { error: 'db_not_configured' } };
      }
      const jobId = String(body.jobId ?? '');
      if (!jobId) return { status: 400, body: { error: 'bad_request' } };
      const job = (await source.billableJobs()).find((j) => j.jobId === jobId);
      if (!job) return { status: 404, body: { error: 'unknown_job' } };
      const { drafts, blocked } = buildInvoiceDrafts([job]);
      const draft = drafts[0];
      if (!draft) {
        const why = blocked[0];
        return { status: 409, body: { error: why?.reason ?? 'already_invoiced', line: why?.line ?? null } };
      }
      const created = await source.createInvoice({
        jobId: draft.jobId, amount: draft.amount,
        lateFeePct: draft.lateFeePct, netDays: draft.netDays ?? DEFAULT_NET_DAYS,
      });
      // A double submit loses the race at the DB, not at the customer's mailbox.
      if (created === 'already_invoiced') {
        return { status: 409, body: { error: 'already_invoiced', line: 'This job already has an invoice.' } };
      }
      if (source.emit) await source.emit('invoice.drafted', { invoiceId: created.id, jobId: draft.jobId });
      return { status: 200, body: { id: created.id, amount: draft.amount, lateFeePct: draft.lateFeePct } };
    },

    /**
     * POST /api/invoices/:id/status — Mike moves an invoice along. Only Mike:
     * there is no path here an agent can reach, and 'paid' is a human fact.
     */
    async setInvoiceStatus(invoiceId: string, body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.setInvoiceStatus) return { status: 503, body: { error: 'db_not_configured' } };
      const status = String(body.status ?? '');
      if (!invoiceId) return { status: 400, body: { error: 'bad_id' } };
      if (!['sent', 'paid', 'void'].includes(status)) return { status: 400, body: { error: 'bad_status' } };
      if (!UUID_RE.test(invoiceId)) return { status: 400, body: { error: 'bad_id' } };
      // A write that touched nothing is not a success — reporting "paid" for an
      // invoice that does not exist is exactly the kind of quiet lie §1B bans.
      const changed = await source.setInvoiceStatus(invoiceId, status as 'sent' | 'paid' | 'void');
      if (!changed) return { status: 404, body: { error: 'unknown_invoice' } };
      if (source.emit) await source.emit('invoice.' + status, { invoiceId });
      return { status: 200, body: { ok: true } };
    },

    /**
     * POST /api/crew/near-miss — §6V blameless filing. Reachable from the CREW
     * door: a report must cost the reporter nothing, so this takes the fewest
     * possible fields and there is no parameter anywhere that records fault.
     */
    async reportNearMiss(body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.fileNearMiss) return { status: 503, body: { error: 'db_not_configured' } };
      // ONE reading of the ET day: computing it twice can straddle midnight
      // and reject a report as "in the future" against a day that just turned.
      const todayEt = etToday();
      const report: NearMissReport = {
        reportedBy: String(body.reportedBy ?? ''),
        jobId: body.jobId ? String(body.jobId) : undefined,
        description: String(body.description ?? ''),
        // Default to today in ET — the crew's day, not the server's UTC day.
        occurredOn: String(body.occurredOn ?? todayEt),
      };
      // Content first: what the crew member typed is their business, and they
      // must hear about a blank box before they hear about a client-side id.
      let filed;
      try {
        filed = fileNearMiss(report, todayEt);
      } catch (err) {
        if (err instanceof NearMissRejected) return { status: 400, body: { error: err.reason } };
        throw err;
      }
      // reported_by and job_id are uuid columns. A non-UUID reaches Postgres
      // as a cast error and surfaces as a 500 — which on THIS surface means a
      // crew member believes they filed a near miss that does not exist.
      if (!UUID_RE.test(filed.reportedBy)) return { status: 400, body: { error: 'bad_reporter_id' } };
      if (filed.jobId && !UUID_RE.test(filed.jobId)) return { status: 400, body: { error: 'bad_job_id' } };
      let saved;
      try {
        saved = await source.fileNearMiss({
          reportedBy: filed.reportedBy, jobId: filed.jobId, description: filed.description,
          occurredOn: filed.occurredOn, hazardCategory: filed.hazardCategory,
        });
      } catch (err) {
        // A reporter id that passes the UUID shape but matches no crew member
        // trips the foreign key. Name it, so the crew is told plainly rather
        // than being shown a generic failure they might read as "saved".
        const code = (err as { code?: string }).code;
        if (code === '23503') return { status: 400, body: { error: 'unknown_reporter' } };
        throw err;
      }
      if (source.emit) {
        // Category and id only: a near-miss narrative can name people, and the
        // event bus is read by surfaces that must not carry that (§4.3).
        await source.emit('safety.near_miss.filed', {
          nearMissId: saved.id, hazardCategory: filed.hazardCategory,
        });
      }
      // §6M: the incident becomes a lesson. A DRAFT — §4.7 forbids publishing
      // life-safety content without a named human vetter, and nothing here
      // supplies one. Failure to draft must never lose the near miss itself.
      let lessonDraftId: string | null = null;
      if (source.createLessonDraft) {
        try {
          const draft = buildLessonDraft({
            id: saved.id, description: filed.description,
            hazardCategory: filed.hazardCategory, occurredOn: filed.occurredOn,
          });
          const made = await source.createLessonDraft({
            nearMissId: saved.id, topic: draft.topic, body: draft.body,
            difficulty: draft.difficulty, vetterNotes: draft.vetterNotes,
          });
          lessonDraftId = made.id;
        } catch {
          // The report is filed and that is what matters. The safety board
          // still counts this one as "no lesson yet", which is the truth.
        }
      }
      return {
        status: 200,
        body: { id: saved.id, hazardCategory: filed.hazardCategory, blameless: true, lessonDraftId },
      };
    },

    /**
     * GET /api/safety — the admin safety board. Every section is tri-state:
     * a real answer or a NAMED blind spot. There is no path here that says
     * anyone is qualified — only that no expiry problem was found.
     */
    async safety(): Promise<ApiResult> {
      if (!source.ready()) return { status: 503, body: { error: 'db_not_configured' } };
      const todayEt = etToday();
      const blindSpots: string[] = [];

      let certProblems: ReturnType<typeof findCertProblems> = [];
      if (!source.activeCrew || !source.certifications) {
        blindSpots.push('certifications: no source wired');
      } else {
        try {
          const [crew, certs] = await Promise.all([source.activeCrew(), source.certifications()]);
          certProblems = findCertProblems(crew, certs, todayEt);
        } catch {
          blindSpots.push('certifications: could not read crew or certification records');
        }
      }

      let nearMisses: unknown[] = [];
      // null = we could not read the log. A 0 here would say "every incident
      // has a lesson", which is the opposite of what a dead feed means (§1B).
      let nearMissesWithoutLesson: number | null = null;
      if (!source.recentNearMisses) {
        blindSpots.push('near_miss: no source wired');
      } else {
        try {
          const since = new Date(Date.parse(`${todayEt}T00:00:00Z`) - 90 * 86400_000).toISOString().slice(0, 10);
          nearMisses = await source.recentNearMisses(since);
          nearMissesWithoutLesson = (nearMisses as Array<{ hasTrainingItem?: boolean }>)
            .filter((n) => n.hasTrainingItem === false).length;
        } catch {
          blindSpots.push('near_miss: could not read the incident log');
        }
      }

      return {
        status: 200,
        body: {
          certProblems,
          aerialBlocked: [...new Set(certProblems.filter((f) => f.blocksAerialWork).map((f) => f.crewMemberId))],
          nearMisses,
          // §6M: the loop only closes when an incident becomes a lesson. This
          // is the count that says whether it is closing — null when unknown.
          nearMissesWithoutLesson,
          // Empty is the ONLY all-clear. A populated list means part of this
          // board is guesswork and the UI must say so (§1B).
          blindSpots,
          checkedAtIso: new Date().toISOString(),
        },
      };
    },

    /**
     * GET /api/crew/quiz — the §6M gate set for one crew member. Weighted to
     * the topics they are weak on, and to the ones Arbo has NEVER tested them
     * on, because untested is a gap and not a pass (§1B).
     */
    async crewQuiz(crewMemberId: string, context: string): Promise<ApiResult> {
      if (!source.ready() || !source.trainingPool) return { status: 503, body: { error: 'db_not_configured' } };
      if (!UUID_RE.test(crewMemberId)) return { status: 400, body: { error: 'bad_crew_id' } };
      const ctx = ['clock_in_gate', 'clock_out_gate', 'friday_questionnaire', 'micro_lesson'].includes(context)
        ? (context as GateContext) : null;
      if (!ctx) return { status: 400, body: { error: 'bad_context' } };

      const pool = await source.trainingPool();
      let profile: TrainingProfile = {};
      let profileKnown = true;
      try {
        profile = source.trainingProfile ? await source.trainingProfile(crewMemberId) : {};
      } catch {
        // An unreadable profile is not a clean slate: without it every topic
        // looks untested, which is the SAFE direction, but say so.
        profileKnown = false;
      }
      // A clock-in gate is one item; the Friday questionnaire is the full set.
      const count = ctx === 'friday_questionnaire' ? defaultQuestionnaireConfig.questionCount : 1;
      const sel = selectQuestionnaire(pool, profile, { ...defaultQuestionnaireConfig, questionCount: count });

      // A phone gets the question and never the key. Grading happens on the
      // server (see completeQuiz) — a client-asserted score is not a score.
      let items: ReturnType<typeof toCrewFacing> = [];
      let itemsLoaded = true;
      try {
        items = source.trainingItems ? toCrewFacing(await source.trainingItems(sel.itemIds)) : [];
      } catch {
        itemsLoaded = false;
      }
      return {
        status: 200,
        body: {
          ...sel, items, context: ctx, profileKnown, poolSize: pool.length,
          // A quiz whose questions could not be loaded is NOT an empty quiz.
          itemsLoaded,
        },
      };
    },

    /**
     * POST /api/crew/quiz/complete — record a finished gate. §4.6: this ALWAYS
     * writes payable time. There is no branch that records a completion
     * without the pay.
     */
    async completeQuiz(body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.recordGate) return { status: 503, body: { error: 'db_not_configured' } };
      const crewMemberId = String(body.crewMemberId ?? '');
      if (!UUID_RE.test(crewMemberId)) return { status: 400, body: { error: 'bad_crew_id' } };
      const itemIds = Array.isArray(body.itemIds) ? (body.itemIds as unknown[]).map(String) : [];
      // item_ids is uuid[]: a non-UUID commits the PAID time and then fails
      // the event insert — the cycle-4 lesson, applied here before it repeats.
      if (itemIds.some((id) => !UUID_RE.test(id))) return { status: 400, body: { error: 'bad_item_id' } };

      // Grade against the REAL key, server-side. `correct`/`answered`/
      // `topicScores` are deliberately NOT read from the request: a client
      // that can assert its own score can quiz itself out of the weak-topic
      // weighting, which makes the whole loop decorative.
      const answers: Record<string, number> = {};
      const rawAnswers = body.answers;
      if (rawAnswers && typeof rawAnswers === 'object') {
        for (const [k, v] of Object.entries(rawAnswers as Record<string, unknown>)) {
          const n = Number(v);
          if (UUID_RE.test(k) && Number.isInteger(n) && n >= 0) answers[k] = n;
        }
      }
      let graded = { answered: 0, correct: 0, score: null as number | null, topicScores: {} as Record<string, number>, ungradable: [] as string[] };
      let gradedOk = true;
      if (source.trainingItems && Object.keys(answers).length > 0) {
        try {
          graded = gradeSubmission(await source.trainingItems(itemIds), answers);
        } catch {
          // Ungradable is NOT zero-correct. The completion still pays (§4.6),
          // and the score is reported as unknown rather than as a failure.
          gradedOk = false;
        }
      }

      let completion;
      try {
        completion = buildGateCompletion({
          crewMemberId,
          context: String(body.context ?? 'micro_lesson') as GateContext,
          itemIds,
          startedAtIso: String(body.startedAtIso ?? ''),
          completedAtIso: String(body.completedAtIso ?? ''),
          correct: graded.correct,
          answered: graded.answered,
        });
      } catch (err) {
        if (err instanceof GateRejected) return { status: 400, body: { error: err.reason } };
        throw err;
      }

      let saved;
      try {
        saved = await source.recordGate({
          crewMemberId: completion.crewMemberId, context: completion.context,
          itemIds: completion.itemIds, startedAtIso: completion.startedAtIso,
          completedAtIso: completion.completedAtIso,
          payableMinutes: completion.payableMinutes, score: completion.score,
        });
      } catch (err) {
        // time_entry_ack_once (migration 0011) makes a retry on flaky field
        // signal a no-op instead of a duplicate PAID row. Report that as the
        // success it is, not as a 500 that invites another retry.
        if ((err as { code?: string }).code === '23505') {
          return { status: 200, body: { duplicate: true, payableMinutes: completion.payableMinutes } };
        }
        throw err;
      }

      // Profile update is a nice-to-have; the PAY is not. A failure here must
      // never roll back a recorded, compensated completion. The scores come
      // from server-side grading, so they cannot be inflated from a phone.
      let profileUpdated = false;
      if (Object.keys(graded.topicScores).length && source.trainingProfile && source.saveTrainingProfile) {
        try {
          const prior = await source.trainingProfile(crewMemberId);
          await source.saveTrainingProfile(crewMemberId, updateProfile(prior, graded.topicScores));
          profileUpdated = true;
        } catch { /* named in the response below, never silently assumed */ }
      }

      return {
        status: 200,
        body: {
          ...saved,
          payableMinutes: completion.payableMinutes,
          score: completion.score,
          answered: graded.answered,
          correct: graded.correct,
          profileUpdated,
          // Named, never swallowed: items Arbo could not grade, and a grading
          // pass that failed outright.
          ungradable: graded.ungradable,
          gradedOk,
        },
      };
    },

    /**
     * GET /api/training/board — §6M.5. Who is weak on what, who has never been
     * asked, and who owes this week's questionnaire. An untested topic is a
     * gap in OUR record, never a pass.
     */
    async trainingBoard(): Promise<ApiResult> {
      if (!source.ready() || !source.crewProfiles) return { status: 503, body: { error: 'db_not_configured' } };
      const crew = await source.crewProfiles();

      // The pool defines what "untested" can even mean. Without it, untested
      // would silently narrow to "among topics he has already seen".
      let poolTopics: string[] = [];
      const extraBlindSpots: string[] = [];
      try {
        poolTopics = source.trainingPool ? [...new Set((await source.trainingPool()).map((i) => i.topic))] : [];
      } catch {
        extraBlindSpots.push('Training pool could not be read — the untested list is incomplete, not empty.');
      }

      // Computed ONCE: two calls could straddle a week boundary and report a
      // window that does not match the completions actually queried.
      const weekStart = etWeekStart();

      // null means the read FAILED, which the board renders as UNKNOWN.
      let completions: GateCompletionRow[] | null = null;
      if (!source.gateCompletionsSince) {
        extraBlindSpots.push('Weekly completions: no source wired.');
      } else {
        try {
          completions = await source.gateCompletionsSince(weekStart.toISOString());
        } catch {
          completions = null;
        }
      }

      const board = buildTrainingBoard({ crew, poolTopics, completions });
      return {
        status: 200,
        body: {
          ...board,
          blindSpots: [...board.blindSpots, ...extraBlindSpots],
          weekStartIso: weekStart.toISOString(),
        },
      };
    },

    /** GET /api/training/drafts — §4.7 vetting queue. */
    async trainingDrafts(): Promise<ApiResult> {
      if (!source.ready() || !source.pendingDrafts) return { status: 503, body: { error: 'db_not_configured' } };
      const drafts = await source.pendingDrafts();
      return { status: 200, body: { drafts, count: drafts.length } };
    },

    /**
     * POST /api/training/drafts/:id/publish — §4.7. A named human vetter is
     * REQUIRED. The DB CHECK enforces it; this rejects earlier so the cockpit
     * gets a reason rather than a 500, and no automated caller exists.
     */
    async publishLesson(itemId: string, body: Record<string, unknown>): Promise<ApiResult> {
      if (!source.ready() || !source.publishLesson) return { status: 503, body: { error: 'db_not_configured' } };
      if (!UUID_RE.test(itemId)) return { status: 400, body: { error: 'bad_id' } };
      const vettedBy = String(body.vettedBy ?? '').trim();
      if (!vettedBy) {
        return {
          status: 400,
          body: {
            error: 'vetter_required',
            line: 'Life-safety content cannot publish without a named human vetter (§4.7).',
          },
        };
      }
      const ok = await source.publishLesson(itemId, vettedBy);
      // Already published or gone: say so rather than reporting a fresh publish.
      if (!ok) return { status: 409, body: { error: 'not_publishable' } };
      if (source.emit) await source.emit('training.item.published', { itemId, vettedBy });
      return { status: 200, body: { ok: true, vettedBy } };
    },

    /** GET /api/agents/runs — §8A.6g audit visibility: what the agents did. */
    async agentRuns(limit = 20): Promise<ApiResult> {
      if (!source.ready() || !source.agentRuns) return { status: 503, body: { error: 'db_not_configured' } };
      return { status: 200, body: { runs: await source.agentRuns(limit) } };
    },
  };
}
