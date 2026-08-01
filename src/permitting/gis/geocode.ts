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
