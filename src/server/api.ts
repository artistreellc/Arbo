// Backend API handlers (brief §8: one service hosting the policy engine and
// the app's data). Pure functions over an injected DataSource, so every route
// is testable offline and the same handlers run live on the server.
//
// Admin-only surface: in production these sit behind auth (the app's admin
// session). No customer PII in errors or logs (§4.3).

import { loadAllConfig } from '../config/loadConfig.js';
import { buildMorningBrief, type MorningBrief, type StopInput } from '../ops/morningBrief.js';
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
}

/** What the API needs from storage — live impl wraps the repositories. */
export interface DataSource {
  ready(): boolean;
  stopsBetween(fromIso: string, toIso: string): Promise<StopInput[]>;
  newLeads(limit: number): Promise<ApiLeadInput[]>;
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
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const IN_AREA = new Set(['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth']);

export function createApi(source: DataSource) {
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
        };
      });
      return { status: 200, body: { leads } };
    },
  };
}
