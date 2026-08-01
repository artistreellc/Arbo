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
        return {
          id: r.id,
          source: r.source,
          details: r.details,
          isEmergency: r.isEmergency,
          status: r.status,
          createdAt: r.createdAt,
          name: r.name,
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
      return { status: 200, body: { ...queue, seasonalUnavailable } };
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
  };
}
