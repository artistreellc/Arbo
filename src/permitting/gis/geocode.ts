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
// Geocoding for the permit screen (brief §8: Google Maps Platform). Injected
// behind an interface so the provider is offline-testable and swappable.
//
// STRICT (D32): a geocode that isn't a confident Virginia hit THROWS — the
// screen goes PENDING rather than testing GIS layers at a wrong point. A
// point-in-polygon answer for the wrong coordinates is worse than no answer.

import type { FetchFn } from './arcgis.js';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Geocoder {
  /** Resolve a service-area address to WGS84 coordinates, or throw. */
  geocode(address: string, city: string): Promise<GeoPoint>;
}

interface GoogleGeocodeResponse {
  status?: string;
  results?: Array<{
    geometry?: { location?: { lat?: number; lng?: number } };
    formatted_address?: string;
  }>;
}

interface CensusGeocodeResponse {
  result?: {
    addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }>;
  };
}

/**
 * US Census Bureau geocoder — free, keyless, federal. The default when no
 * Google Maps key is configured, so the §6B screen can run live with zero
 * paid credentials. Verified against the real service 2026-08-01 (it resolved
 * the 8562 Circle Drive case). Same strictness: no confident match → throw.
 */
export function createCensusGeocoder(fetchFn: FetchFn): Geocoder {
  return {
    async geocode(address, city) {
      const params = new URLSearchParams({
        address: `${address}, ${city}, VA`,
        benchmark: 'Public_AR_Current',
        format: 'json',
      });
      const res = await fetchFn(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params.toString()}`);
      if (!res.ok) throw new Error(`Census geocode HTTP ${res.status}`);
      const body = (await res.json()) as CensusGeocodeResponse;
      const match = body.result?.addressMatches?.[0];
      if (typeof match?.coordinates?.x !== 'number' || typeof match?.coordinates?.y !== 'number') {
        throw new Error('Census geocode: no confident match');
      }
      return { lat: match.coordinates.y, lng: match.coordinates.x };
    },
  };
}

/** Google Maps Geocoding API implementation. Key comes from env at wiring. */
export function createGoogleGeocoder(apiKey: string, fetchFn: FetchFn): Geocoder {
  return {
    async geocode(address, city) {
      const params = new URLSearchParams({
        address: `${address}, ${city}, VA`,
        components: 'administrative_area:VA|country:US',
        key: apiKey,
      });
      const res = await fetchFn(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
      if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
      const body = (await res.json()) as GoogleGeocodeResponse;
      if (body.status !== 'OK' || !body.results?.length) {
        throw new Error(`Geocode failed: ${body.status ?? 'no status'}`);
      }
      const loc = body.results[0]?.geometry?.location;
      if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') {
        throw new Error('Geocode returned no coordinates');
      }
      return { lat: loc.lat, lng: loc.lng };
    },
  };
}
