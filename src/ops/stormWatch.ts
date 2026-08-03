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
// Storm watch (brief §5A #26): Hampton Roads weather rolling in → flag the
// booked stops that may need moving EARLY, before the day falls apart. Pure
// engine over an injected alerts feed; recommend-only like everything else —
// ARBOR flags, Mike moves the jobs.
//
// Feed: the National Weather Service alerts API (api.weather.gov) — free,
// keyless, official. Same trust discipline as the GIS layers (D33): the
// endpoint ships as config with a verification note; the engine never
// fabricates a "no storm" — a failed feed is reported as UNAVAILABLE, not
// as clear skies (§12 honesty rule).

import type { ServiceCity } from '../lib/address.js';

/** Coarse city centroids — good enough for county-scale weather alerts. */
export const CITY_POINTS: Record<ServiceCity, { lat: number; lng: number }> = {
  'Virginia Beach': { lat: 36.8529, lng: -75.978 },
  Norfolk: { lat: 36.8508, lng: -76.2859 },
  Chesapeake: { lat: 36.7682, lng: -76.2875 },
  Portsmouth: { lat: 36.8354, lng: -76.2983 },
};

export interface StormAlert {
  id: string;
  event: string; // e.g. "Severe Thunderstorm Warning"
  severity: string; // Extreme | Severe | Moderate | Minor | Unknown
  headline: string | null;
  onset: string | null; // ISO
  ends: string | null; // ISO (ends ?? expires)
  cities: ServiceCity[]; // service cities whose point the alert covers
}

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface AlertsProvider {
  /** Active alerts covering the 4 service cities. Throws on feed failure. */
  activeAlerts(): Promise<StormAlert[]>;
}

interface NwsFeature {
  properties?: {
    id?: string;
    event?: string;
    severity?: string;
    headline?: string;
    onset?: string;
    ends?: string;
    expires?: string;
  };
}

/**
 * Live provider over api.weather.gov. One point query per city, deduped by
 * alert id. NWS asks for an identifying User-Agent.
 */
export function createNwsAlertsProvider(fetchFn: FetchFn): AlertsProvider {
  return {
    async activeAlerts(): Promise<StormAlert[]> {
      const byId = new Map<string, StormAlert>();
      for (const [city, p] of Object.entries(CITY_POINTS) as Array<[ServiceCity, { lat: number; lng: number }]>) {
        const url = `https://api.weather.gov/alerts/active?point=${p.lat},${p.lng}`;
        const res = await fetchFn(url, { headers: { 'user-agent': 'ARBOR (Art-is-Tree LLC ops)', accept: 'application/geo+json' } });
        if (!res.ok) throw new Error(`NWS alerts failed for ${city}: HTTP ${res.status}`);
        const body = (await res.json()) as { features?: NwsFeature[] };
        if (!Array.isArray(body.features)) throw new Error(`NWS alerts: malformed response for ${city}`);
        for (const f of body.features) {
          const pr = f.properties ?? {};
          const id = pr.id ?? `${pr.event}-${pr.onset}`;
          const existing = byId.get(id);
          if (existing) {
            if (!existing.cities.includes(city)) existing.cities.push(city);
            continue;
          }
          byId.set(id, {
            id,
            event: pr.event ?? 'Weather alert',
            severity: pr.severity ?? 'Unknown',
            headline: pr.headline ?? null,
            onset: pr.onset ?? null,
            ends: pr.ends ?? pr.expires ?? null,
            cities: [city],
          });
        }
      }
      return [...byId.values()];
    },
  };
}

/** Events that plausibly stop tree work — biased inclusive (§3.4 spirit). */
const WORK_STOPPING = /(thunderstorm|tornado|hurricane|tropical|wind|gale|storm|winter|ice|snow|flood|lightning)/i;

export function isWorkStopping(alert: StormAlert): boolean {
  if (alert.severity === 'Extreme' || alert.severity === 'Severe') return true;
  return WORK_STOPPING.test(alert.event);
}

export interface StopAtRisk {
  stopId: string;
  city: string;
  timeIso: string | null;
  alertEvent: string;
  alertHeadline: string | null;
  /** Always a recommendation — Mike decides what moves. */
  recommendOnly: true;
}

export interface StormInput {
  id: string;
  city: string;
  timeIso?: string | null;
}

/**
 * Flag stops that fall inside a work-stopping alert's window for their city.
 * A stop with no time still flags if its city has an active work-stopping
 * alert — better a false nudge than a crew sent into a warning.
 */
export function flagStopsAtRisk(alerts: StormAlert[], stops: StormInput[], now: Date): StopAtRisk[] {
  const flagged: StopAtRisk[] = [];
  const active = alerts.filter(isWorkStopping);
  for (const stop of stops) {
    for (const a of active) {
      if (!a.cities.includes(stop.city as ServiceCity)) continue;
      const start = a.onset ? Date.parse(a.onset) : now.getTime();
      const end = a.ends ? Date.parse(a.ends) : Number.MAX_SAFE_INTEGER;
      const t = stop.timeIso ? Date.parse(stop.timeIso) : now.getTime();
      if (t >= start && t <= end) {
        flagged.push({
          stopId: stop.id,
          city: stop.city,
          timeIso: stop.timeIso ?? null,
          alertEvent: a.event,
          alertHeadline: a.headline,
          recommendOnly: true,
        });
        break; // one flag per stop is enough
      }
    }
  }
  return flagged;
}
