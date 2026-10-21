// Maps wave A, M1 (docs/MAPS_PLAN.md "M1 Today's stops + route"; Mike,
// 2026-10-20: "the map …" — all four layers, today's stops plus route first).
// Today's calendar stops, placed for the map from what Arbo already holds:
//
//   • EXACT pin — only where TomTom's day memory already holds the address,
//     because the R35 planner placed it (peek). The map never asks TomTom, so
//     no address goes anywhere new; a stop the planner skips (before 4 PM, all
//     day, ongoing) never went to TomTom and is never peeked (Q3).
//   • ZIP-AREA pin — every other stop with a ZIP the four cities' table can
//     place (src/lib/zipCentroids.ts): hollow, "not the exact spot".
//   • NOT ON THE MAP — every other stop, each with its reason (§1B).
//
// Numbers follow R35's plan only when an engine planned it. Nothing is written
// or kept: this is built per read from todayStops.readRows(), which shares
// Calendar's calendar read and plan memory. The ZIP never leaves the server;
// the phone gets the point it draws, rounded to 5 decimals. Logs: none here.

import type { TodayStopsFull, TodayStopsView, TodayState } from './todayStops.js';
import { addressOf } from './routePlanner.js';
import type { LatLon } from '../integrations/tomtom.js';
import { serviceCityForZip } from '../lib/address.js';
import { FOUR_CITY_BOX, ZIP_WHY, zipPoint as tableZipPoint, type ZipPlace } from '../lib/zipCentroids.js';

/** R35's own words for a location with no ZIP (todayStops.toRow). */
const NO_ZIP_WHY = 'No ZIP in the address — not in the plan';
const NO_ADDRESS_WHY = 'No address on the event';

export interface MapStop {
  id: string;
  /** Its number in R35's plan; null when no engine planned the day or the stop is not in the route. */
  n: number | null;
  time: string | null;
  title: string;
  city: string | null;
  address: string;
  lat: number;
  lon: number;
  placedBy: 'tomtom' | 'zip' | 'practice';
  /** R35's why when it is not in the route; null when it is. */
  why: string | null;
  /** An exact pin outside the four cities: drawn, and its card says so. */
  outside: boolean;
}

export interface MapToday {
  state: TodayState;
  /** R35's line for a calendar not read, word for word; null after a good read. */
  line: string | null;
  practice: boolean;
  day: string;
  dayKind: TodayStopsView['dayKind'];
  planLine: string | null;
  engine: 'tomtom' | 'google' | 'zip' | null;
  tomtomLine: string | null;
  /** Calendar's "Route the whole day" has stops to open (R35's plan.order is not empty). */
  canRoute: boolean;
  stops: MapStop[];
  notOnMap: Array<{ id: string; title: string; why: string }>;
  /** events is null when the calendar was not read — never a 0 that reads "an empty day". */
  counts: { events: number | null; onMap: number; notOnMap: number };
}

export interface MapTodayDeps {
  /** TomTom's day memory, read only (TomTomClient.peek); () => undefined without a key. */
  peek: (query: string) => LatLon | null | undefined;
  /** The ZIP-area table; the shipped one unless a test hands its own. */
  zipPoint?: (zip: string | null) => ZipPlace;
  /** ARBO_DATA_LINKS=sim: SIM stops sit at their ZIP area as practice pins; TomTom is not even peeked. */
  practice?: boolean;
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;
const inFourCities = (p: LatLon) => p.lat >= FOUR_CITY_BOX.south && p.lat <= FOUR_CITY_BOX.north && p.lon >= FOUR_CITY_BOX.west && p.lon <= FOUR_CITY_BOX.east;

export function buildMapToday(v: TodayStopsFull, deps: MapTodayDeps): MapToday {
  const zipPoint = deps.zipPoint ?? tableZipPoint;
  const practice = v.practice || deps.practice === true;
  const read = v.state === 'ok' || v.state === 'practice';
  const order = v.plan && v.plan.engine !== null ? v.plan.order : [];
  const stops: MapStop[] = [];
  const notOnMap: MapToday['notOnMap'] = [];
  if (read) {
    for (const r of v.stops) {
      if (!r.address) { notOnMap.push({ id: r.id, title: r.title, why: r.why ?? NO_ADDRESS_WHY }); continue; }
      const at = order.indexOf(r.id);
      const card = { id: r.id, n: at >= 0 ? at + 1 : null, time: r.time, title: r.title, city: r.city, address: r.address };
      // Exact: a stop the planner routed (why null), from the planner's own day memory — the planner's own key.
      if (!practice && r.why === null) {
        const p = deps.peek(addressOf({ label: r.title || 'No title', zip: r.zip ?? '', address: r.address }));
        if (p) {
          stops.push({ ...card, lat: round5(p.lat), lon: round5(p.lon), placedBy: 'tomtom', why: null, outside: serviceCityForZip(r.zip) === null || !inFourCities(p) });
          continue;
        }
      }
      if (!r.zip) { notOnMap.push({ id: r.id, title: r.title, why: NO_ZIP_WHY }); continue; }
      const z = zipPoint(r.zip);
      if (!z.ok) { notOnMap.push({ id: r.id, title: r.title, why: ZIP_WHY[z.why] }); continue; }
      stops.push({ ...card, lat: round5(z.lat), lon: round5(z.lon), placedBy: practice ? 'practice' : 'zip', why: r.why, outside: false });
    }
  }
  return {
    state: v.state,
    line: v.line,
    practice,
    day: v.day,
    dayKind: v.dayKind,
    planLine: v.plan ? v.plan.line : null,
    engine: v.plan ? v.plan.engine : null,
    tomtomLine: v.tomtom.line,
    canRoute: read && v.plan !== null && v.plan.order.length > 0,
    stops,
    notOnMap,
    counts: { events: read ? v.stops.length : null, onMap: stops.length, notOnMap: notOnMap.length },
  };
}
