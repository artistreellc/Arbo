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
      if (source.growthTargets) {
        try {
          due = buildDueProperties(await source.growthTargets(), now);
        } catch {
          // Forecast read failure never hides the Book itself.
        }
      }
      const dueById = new Map(due.map((d) => [d.propertyId, d]));
      const properties = (list as Array<{ id: string }>).map((p) => ({
        ...p,
        due: dueById.get(p.id) ? { state: dueById.get(p.id)!.state, note: dueById.get(p.id)!.note } : null,
      }));
      return { status: 200, body: { properties, comingDue: due } };
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
  };
}
