/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
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

  Remember the marker: SLOW::ARBO
*/
// R35 (Mike, 2026-10-20: "and for a route planner intergrate tomtom", then
// "why dont you build and then i add later"): TomTom plans the day's route.
// Built DORMANT: no TOMTOM_API_KEY = no TomTom client, and the plan names it
// ("TomTom not set up — add TOMTOM_API_KEY in Railway.") instead of quietly
// using something else under TomTom's name.
//
// Two documented TomTom APIs, GET only (docs.tomtom.com, checked 2026-10-21):
//   • Search API v2 geocode — /search/2/geocode/{query}.json, countrySet=US,
//     biased (lat/lon, no radius) to a public Hampton Roads point.
//   • Routing API v1 calculateRoute —
//     /routing/1/calculateRoute/{lat,lon:lat,lon:…}/json with
//     computeBestOrder=true (TomTom reorders the waypoints BETWEEN the fixed
//     origin and destination and returns optimizedWaypoints), traffic=true,
//     departAt (RFC 3339), travelMode=car.
//
// THE KEY IS IN THE URL (TomTom's `key` query parameter), so no URL and no
// raw fetch error ever leaves this file: every failure is a TomTomError with
// one of four fixed messages. Nothing is written to TomTom and nothing is
// stored — the day's geocodes live in memory until the ET day changes.

import { etToday } from '../lib/etDay.js';

export interface LatLon {
  lat: number;
  lon: number;
}

export type TomTomFetch = (url: string, init: { method: 'GET'; signal: globalThis.AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type TomTomFailure = 'http' | 'timeout' | 'unreachable' | 'unreadable';

/** A TomTom failure by a FIXED name — its message can reach the phone, so it never carries TomTom's text, a URL or the key. */
export class TomTomError extends Error {
  readonly code: TomTomFailure;
  readonly status: number | null;
  constructor(code: TomTomFailure, status: number | null = null) {
    super(
      code === 'http' ? `TomTom HTTP ${status ?? 0}`
        : code === 'timeout' ? 'TomTom timed out'
        : code === 'unreachable' ? 'TomTom unreachable'
        : 'TomTom unreadable answer',
    );
    this.name = 'TomTomError';
    this.code = code;
    this.status = status;
  }
}

/** The named state while the key is not on Railway (R35: built dormant). */
export const TOMTOM_NOT_SET_LINE = 'TomTom not set up — add TOMTOM_API_KEY in Railway.';

/**
 * Truck routing (travelMode=truck plus TomTom's vehicle* parameters) waits on
 * real numbers. Mike: give the bucket truck and chipper dimensions. Until this
 * holds his figures it stays EMPTY and TomTom routes a car — no dimension is
 * ever guessed (a made-up height is a bridge strike, not a route).
 */
export const TRUCK_PROFILE: Readonly<Record<string, string>> = Object.freeze({});

const BASE = 'https://api.tomtom.com';
/** Downtown Norfolk — a public point that biases the geocode to Hampton Roads. Never Mike's home. */
const BIAS = { lat: 36.8508, lon: -76.2859 };
const TIMEOUT_MS = 8000;

const defaultFetch: TomTomFetch = (url, init) => fetch(url, init);

async function getJson(url: string, fetchFn: TomTomFetch, timeoutMs: number): Promise<unknown> {
  const ac = new globalThis.AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res: Awaited<ReturnType<TomTomFetch>>;
    try {
      res = await fetchFn(url, { method: 'GET', signal: ac.signal });
    } catch {
      // The thrown error may quote the URL — and with it the key. Never kept.
      throw new TomTomError(ac.signal.aborted ? 'timeout' : 'unreachable');
    }
    if (!res.ok) throw new TomTomError('http', res.status);
    try {
      return await res.json();
    } catch {
      throw new TomTomError(ac.signal.aborted ? 'timeout' : 'unreadable');
    }
  } finally {
    globalThis.clearTimeout(timer);
  }
}

interface GeocodeAnswer {
  results?: Array<{ position?: { lat?: unknown; lon?: unknown }; address?: { countrySubdivision?: unknown } }>;
}

/**
 * One address → a point. Null when TomTom places it nowhere (200 with zero
 * results) or outside Virginia — "couldn't place it", never a made-up point.
 */
export async function tomtomGeocode(
  query: string,
  apiKey: string,
  fetchFn: TomTomFetch = defaultFetch,
  timeoutMs = TIMEOUT_MS,
): Promise<LatLon | null> {
  // A trailing dot would run into the ".json" extension.
  const q = query.trim().replace(/[.\s]+$/, '');
  const params = new URLSearchParams({ key: apiKey, countrySet: 'US', lat: String(BIAS.lat), lon: String(BIAS.lon), limit: '1' });
  const body = (await getJson(`${BASE}/search/2/geocode/${encodeURIComponent(q)}.json?${params}`, fetchFn, timeoutMs)) as GeocodeAnswer | null;
  if (!body || !Array.isArray(body.results)) throw new TomTomError('unreadable');
  const first = body.results[0];
  if (!first) return null;
  const { lat, lon } = first.position ?? {};
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new TomTomError('unreadable');
  const state = first.address?.countrySubdivision;
  if (typeof state === 'string' && state !== '' && !/^(VA|Virginia)$/i.test(state)) return null;
  return { lat, lon };
}

interface RouteAnswer {
  routes?: Array<{ legs?: Array<{ summary?: { travelTimeInSeconds?: unknown; originalWaypointIndexAtEndOfLeg?: unknown } }> }>;
  optimizedWaypoints?: Array<{ providedIndex?: unknown; optimizedIndex?: unknown }>;
}

export interface TomTomRoute {
  /** The provided waypoint indices (0 = the first point after the origin) in the order to drive them. */
  order: number[];
  /** Drive minutes per leg, in driving order: origin → first stop, …, last stop → destination. */
  legMinutes: number[];
}

/**
 * Route origin → waypoints → destination (points[0] and the last point are
 * fixed). With bestOrder, TomTom reorders the waypoints. Any answer that does
 * not account for every waypoint and every leg is unreadable — never a plan
 * built on a guess (§1B).
 */
export async function tomtomRoute(
  points: LatLon[],
  apiKey: string,
  opts: { bestOrder: boolean; departAtIso?: string },
  fetchFn: TomTomFetch = defaultFetch,
  timeoutMs = TIMEOUT_MS,
): Promise<TomTomRoute> {
  const w = points.length - 2;
  if (w < 1) throw new TomTomError('unreadable'); // nothing between the ends to route — a caller bug, named
  const truck = Object.keys(TRUCK_PROFILE).length > 0;
  const params = new URLSearchParams({
    key: apiKey,
    traffic: 'true',
    travelMode: truck ? 'truck' : 'car',
    routeRepresentation: 'summaryOnly',
    ...(opts.bestOrder ? { computeBestOrder: 'true' } : {}),
    ...(opts.departAtIso ? { departAt: opts.departAtIso } : {}),
    ...TRUCK_PROFILE,
  });
  const locations = points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(':');
  const body = (await getJson(`${BASE}/routing/1/calculateRoute/${locations}/json?${params}`, fetchFn, timeoutMs)) as RouteAnswer | null;

  const legs = body?.routes?.[0]?.legs;
  if (!Array.isArray(legs) || legs.length !== w + 1) throw new TomTomError('unreadable');
  const legMinutes = legs.map((l) => {
    const s = l?.summary?.travelTimeInSeconds;
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) throw new TomTomError('unreadable');
    return Math.max(1, Math.round(s / 60));
  });

  let order = Array.from({ length: w }, (_, i) => i);
  if (opts.bestOrder) {
    // providedIndex = where a waypoint was in OUR list; optimizedIndex = where
    // it goes in the driving order. Both must be a full 0…w-1 permutation.
    const ow = body?.optimizedWaypoints;
    if (!Array.isArray(ow) || ow.length !== w) throw new TomTomError('unreadable');
    const byPosition: number[] = Array.from({ length: w }, () => -1);
    for (const e of ow) {
      const p = e?.providedIndex;
      const o = e?.optimizedIndex;
      if (typeof p !== 'number' || typeof o !== 'number' || !Number.isInteger(p) || !Number.isInteger(o)) throw new TomTomError('unreadable');
      if (p < 0 || p >= w || o < 0 || o >= w || byPosition[o] !== -1) throw new TomTomError('unreadable');
      byPosition[o] = p;
    }
    if (new Set(byPosition).size !== w) throw new TomTomError('unreadable');
    order = byPosition;
  }
  // Each leg that ends at a waypoint may name it (originalWaypointIndexAtEndOfLeg,
  // an index into OUR list). When it does, it must agree with the order above —
  // a disagreement means Arbo misread the answer, so it is not used.
  for (let i = 0; i < w; i++) {
    const named = legs[i]?.summary?.originalWaypointIndexAtEndOfLeg;
    if (named !== undefined && named !== order[i]) throw new TomTomError('unreadable');
  }
  return { order, legMinutes };
}

export interface TomTomClient {
  geocode(query: string): Promise<LatLon | null>;
  route(points: LatLon[], opts: { bestOrder: boolean; departAtIso?: string }): Promise<TomTomRoute>;
  /**
   * Maps wave A (M1): READ ONLY — what today's memory holds for exactly this
   * query, without asking TomTom anything. A point = the planner placed it;
   * null = TomTom placed it nowhere; undefined = not asked today. The map draws
   * an exact pin only from this, so it sends no address anywhere new.
   */
  peek(query: string): LatLon | null | undefined;
}

/**
 * The ceiling on the day's geocode memory (R35 security review): a day is a
 * dozen stops, so 200 is room to spare — and past it the oldest answer makes
 * room, so no run of odd addresses can grow the server's memory without end.
 */
export const TOMTOM_MAX_PLACES = 200;

/**
 * The one TomTom client the server builds when the key is set. Geocodes are
 * kept in memory for the ET day (an answer, or "couldn't place it"), at most
 * TOMTOM_MAX_PLACES of them; a failure is never remembered, so the next plan
 * asks again.
 */
export function createTomTomClient(
  apiKey: string,
  opts: { fetchFn?: TomTomFetch; today?: () => string; timeoutMs?: number } = {},
): TomTomClient {
  const fetchFn = opts.fetchFn ?? defaultFetch;
  const today = opts.today ?? (() => etToday());
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  let day = '';
  let places = new Map<string, LatLon | null>();
  return {
    async geocode(query) {
      const d = today();
      if (d !== day) {
        day = d;
        places = new Map();
      }
      if (places.has(query)) return places.get(query) ?? null;
      const p = await tomtomGeocode(query, apiKey, fetchFn, timeoutMs);
      if (places.size >= TOMTOM_MAX_PLACES) {
        const oldest = places.keys().next();
        if (!oldest.done) places.delete(oldest.value);
      }
      places.set(query, p);
      return p;
    },
    route: (points, o) => tomtomRoute(points, apiKey, o, fetchFn, timeoutMs),
    // Never fetches and never resets the memory: yesterday's answers are simply not today's.
    peek(query) {
      if (today() !== day || !places.has(query)) return undefined;
      return places.get(query) ?? null;
    },
  };
}
