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
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  tomtomGeocode,
  tomtomRoute,
  createTomTomClient,
  TomTomError,
  TRUCK_PROFILE,
  TOMTOM_NOT_SET_LINE,
  type TomTomFetch,
} from '../src/integrations/tomtom.js';

// R35 (Mike, 2026-10-20: "and for a route planner intergrate tomtom").
// The TomTom client, offline: every call goes to a fake fetch. Three laws:
// the endpoints and parameters are the documented ones (Search v2 geocode,
// Routing v1 calculateRoute with computeBestOrder/traffic/departAt, car unless
// Mike gives truck dimensions); the key rides only in the request URL and
// NEVER in an error a person could see; and an answer Arbo cannot read whole
// is a failure, never a plan built on guesses (§1B).

const KEY = 'tt-test-key-1';

function fake(answer: (url: string) => { status?: number; body?: unknown; throws?: Error; hang?: boolean }) {
  const urls: string[] = [];
  const fn: TomTomFetch = async (url, init) => {
    urls.push(url);
    const a = answer(url);
    if (a.hang) {
      return new Promise((_ok, no) => init.signal.addEventListener('abort', () => no(new Error(`aborted ${url}`))));
    }
    if (a.throws) throw a.throws;
    const status = a.status ?? 200;
    return { ok: status < 400, status, json: async () => a.body };
  };
  return { fn, urls };
}

const placed = (lat: number, lon: number, sub = 'VA') => ({
  summary: { numResults: 1 },
  results: [{ type: 'Point Address', position: { lat, lon }, address: { countrySubdivision: sub, postalCode: '23451' } }],
});

describe('geocode (Search API v2)', () => {
  it('asks the documented endpoint: US only, biased to Hampton Roads, one answer, the query URL-encoded', async () => {
    const { fn, urls } = fake(() => ({ body: placed(36.85, -75.98) }));
    const p = await tomtomGeocode('101 Simulation Row, Virginia Beach, VA 23451', KEY, fn);
    expect(p).toEqual({ lat: 36.85, lon: -75.98 });
    const u = new URL(urls[0]!);
    expect(u.origin).toBe('https://api.tomtom.com');
    expect(u.pathname).toBe('/search/2/geocode/' + encodeURIComponent('101 Simulation Row, Virginia Beach, VA 23451') + '.json');
    expect(u.searchParams.get('key')).toBe(KEY);
    expect(u.searchParams.get('countrySet')).toBe('US');
    expect(u.searchParams.get('limit')).toBe('1');
    // A public point in Hampton Roads biases the search — never Mike's home.
    expect(Number(u.searchParams.get('lat'))).toBeCloseTo(36.85, 1);
    expect(Number(u.searchParams.get('lon'))).toBeCloseTo(-76.29, 1);
    // Deprecated parameters that TomTom answers with a 400.
    expect(u.searchParams.has('typeahead')).toBe(false);
    expect(u.searchParams.has('storeResult')).toBe(false);
  });

  it('zero results, or a place outside Virginia, is "could not place it" (null) — never a made-up point', async () => {
    const none = fake(() => ({ body: { summary: { numResults: 0 }, results: [] } }));
    expect(await tomtomGeocode('SIM nowhere', KEY, none.fn)).toBeNull();
    const elsewhere = fake(() => ({ body: placed(40.7, -74.0, 'NY') }));
    expect(await tomtomGeocode('SIM elsewhere', KEY, elsewhere.fn)).toBeNull();
  });

  it('a refusal, a dead network, a hang and a garbled answer each fail by a fixed name — the key never in it', async () => {
    const refused = fake(() => ({ status: 403, body: '<xml>Forbidden</xml>' }));
    await expect(tomtomGeocode('a', KEY, refused.fn)).rejects.toThrow('TomTom HTTP 403');
    // A network error whose own text quotes the URL (and so the key) is never repeated.
    const dead = fake((url) => ({ throws: new Error(`connect ECONNREFUSED ${url}`) }));
    const err = await tomtomGeocode('a', KEY, dead.fn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TomTomError);
    expect((err as Error).message).toBe('TomTom unreachable');
    expect(String((err as Error).stack ?? '') + JSON.stringify(err)).not.toContain(KEY);
    const hung = fake(() => ({ hang: true }));
    await expect(tomtomGeocode('a', KEY, hung.fn, 20)).rejects.toThrow('TomTom timed out');
    const garbled = fake(() => ({ body: { nope: true } }));
    await expect(tomtomGeocode('a', KEY, garbled.fn)).rejects.toThrow('TomTom unreadable answer');
  });
});

describe('calculateRoute (Routing API v1)', () => {
  const pts = [
    { lat: 36.8, lon: -76.0 }, // origin (the start ZIP)
    { lat: 36.81, lon: -76.01 },
    { lat: 36.82, lon: -76.02 },
    { lat: 36.83, lon: -76.03 },
    { lat: 36.79, lon: -76.05 }, // destination (home ZIP)
  ];
  const leg = (secs: number, endAt?: number) => ({ summary: { travelTimeInSeconds: secs, ...(endAt === undefined ? {} : { originalWaypointIndexAtEndOfLeg: endAt }) } });

  it('asks for the best order with traffic, a departure time, by car, summary only — no truck sizes', async () => {
    const { fn, urls } = fake(() => ({
      body: {
        routes: [{ legs: [leg(600, 2), leg(300, 0), leg(420, 1), leg(900)] }],
        // The documented example: provided 0 goes second, 1 third, 2 first.
        optimizedWaypoints: [{ providedIndex: 0, optimizedIndex: 1 }, { providedIndex: 1, optimizedIndex: 2 }, { providedIndex: 2, optimizedIndex: 0 }],
      },
    }));
    const r = await tomtomRoute(pts, KEY, { bestOrder: true, departAtIso: '2026-10-21T16:00:00-04:00' }, fn);
    // Visit order is the provided waypoints sorted by their optimized position.
    expect(r.order).toEqual([2, 0, 1]);
    expect(r.legMinutes).toEqual([10, 5, 7, 15]);
    const u = new URL(urls[0]!);
    expect(u.origin).toBe('https://api.tomtom.com');
    expect(decodeURIComponent(u.pathname)).toBe('/routing/1/calculateRoute/36.800000,-76.000000:36.810000,-76.010000:36.820000,-76.020000:36.830000,-76.030000:36.790000,-76.050000/json');
    expect(u.searchParams.get('key')).toBe(KEY);
    expect(u.searchParams.get('computeBestOrder')).toBe('true');
    expect(u.searchParams.get('traffic')).toBe('true');
    expect(u.searchParams.get('departAt')).toBe('2026-10-21T16:00:00-04:00');
    expect(u.searchParams.get('travelMode')).toBe('car');
    expect(u.searchParams.get('routeRepresentation')).toBe('summaryOnly');
    for (const k of ['vehicleWeight', 'vehicleLength', 'vehicleWidth', 'vehicleHeight', 'vehicleCommercial', 'vehicleAxleWeight']) expect(u.searchParams.has(k)).toBe(false);
  });

  it('one waypoint keeps its order and sends no departAt when none is given (TomTom then means "now")', async () => {
    const { fn, urls } = fake(() => ({ body: { routes: [{ legs: [leg(60), leg(120)] }] } }));
    const r = await tomtomRoute([pts[0]!, pts[1]!, pts[4]!], KEY, { bestOrder: false }, fn);
    expect(r).toEqual({ order: [0], legMinutes: [1, 2] });
    const u = new URL(urls[0]!);
    expect(u.searchParams.has('computeBestOrder')).toBe(false);
    expect(u.searchParams.has('departAt')).toBe(false);
  });

  it('an answer with missing legs, a broken order, or legs that disagree with the order is unreadable — no plan from it', async () => {
    const short = fake(() => ({ body: { routes: [{ legs: [leg(60), leg(60)] }], optimizedWaypoints: [] } }));
    await expect(tomtomRoute(pts, KEY, { bestOrder: true }, short.fn)).rejects.toThrow('TomTom unreadable answer');
    const legs4 = [leg(60), leg(60), leg(60), leg(60)];
    const dup = fake(() => ({ body: { routes: [{ legs: legs4 }], optimizedWaypoints: [{ providedIndex: 0, optimizedIndex: 0 }, { providedIndex: 1, optimizedIndex: 0 }, { providedIndex: 2, optimizedIndex: 2 }] } }));
    await expect(tomtomRoute(pts, KEY, { bestOrder: true }, dup.fn)).rejects.toThrow('TomTom unreadable answer');
    const disagree = fake(() => ({
      body: {
        routes: [{ legs: [leg(60, 0), leg(60, 1), leg(60, 2), leg(60)] }],
        optimizedWaypoints: [{ providedIndex: 0, optimizedIndex: 1 }, { providedIndex: 1, optimizedIndex: 2 }, { providedIndex: 2, optimizedIndex: 0 }],
      },
    }));
    await expect(tomtomRoute(pts, KEY, { bestOrder: true }, disagree.fn)).rejects.toThrow('TomTom unreadable answer');
    const noTime = fake(() => ({ body: { routes: [{ legs: [{ summary: {} }, leg(60)] }] } }));
    await expect(tomtomRoute([pts[0]!, pts[1]!, pts[4]!], KEY, { bestOrder: false }, noTime.fn)).rejects.toThrow('TomTom unreadable answer');
  });

  it('a TomTom error body is named by its status only — never its text, never the URL', async () => {
    const bad = fake(() => ({ status: 400, body: { formatVersion: '0.0.12', detailedError: { code: 'BAD_INPUT', message: `bad ${KEY}` } } }));
    const err = (await tomtomRoute(pts, KEY, { bestOrder: true }, bad.fn).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('TomTom HTTP 400');
    expect(err.message).not.toContain(KEY);
  });
});

describe('truck sizes are Mike’s to give', () => {
  it('the truck profile is EMPTY, so TomTom routes a car and no dimension is invented', () => {
    expect(Object.keys(TRUCK_PROFILE)).toEqual([]);
    const src = readFileSync(new URL('../src/integrations/tomtom.ts', import.meta.url), 'utf8');
    expect(src).toContain('Mike: give the bucket truck and chipper dimensions');
  });

  it('the not-set line names the one thing to do', () => {
    expect(TOMTOM_NOT_SET_LINE).toBe('TomTom not set up — add TOMTOM_API_KEY in Railway.');
  });
});

describe('the client keeps the day’s geocodes in memory', () => {
  it('one lookup per address per day; a failure is not remembered; a new day asks again', async () => {
    let day = '2026-10-21';
    let fail = true;
    const { fn, urls } = fake(() => (fail ? { status: 500 } : { body: placed(36.8, -76.1) }));
    const client = createTomTomClient(KEY, { fetchFn: fn, today: () => day });
    await expect(client.geocode('SIM-1 Simulation Row')).rejects.toThrow('TomTom HTTP 500');
    fail = false;
    expect(await client.geocode('SIM-1 Simulation Row')).toEqual({ lat: 36.8, lon: -76.1 });
    expect(await client.geocode('SIM-1 Simulation Row')).toEqual({ lat: 36.8, lon: -76.1 });
    expect(urls).toHaveLength(2); // the failure, then one real answer — the third came from memory
    day = '2026-10-22';
    await client.geocode('SIM-1 Simulation Row');
    expect(urls).toHaveLength(3);
  });

  // Maps wave A (M1): the map draws an exact pin only where the planner already placed the address.
  it('peek reads the day’s memory and never asks TomTom: placed, couldn’t place, not asked, another day', async () => {
    let day = '2026-10-21';
    const { fn, urls } = fake((u) => (u.includes('Nowhere') ? { body: { results: [] } } : { body: placed(36.8, -76.1) }));
    const client = createTomTomClient(KEY, { fetchFn: fn, today: () => day });
    expect(client.peek('SIM-1 Simulation Row')).toBeUndefined(); // not asked today
    await client.geocode('SIM-1 Simulation Row');
    await client.geocode('SIM-9 Nowhere Lane');
    const asked = urls.length;
    expect(client.peek('SIM-1 Simulation Row')).toEqual({ lat: 36.8, lon: -76.1 });
    expect(client.peek('SIM-9 Nowhere Lane')).toBeNull(); // asked, and TomTom placed it nowhere
    expect(client.peek('SIM-2 Never Asked')).toBeUndefined();
    expect(urls).toHaveLength(asked); // peeking asked TomTom nothing
    day = '2026-10-22';
    expect(client.peek('SIM-1 Simulation Row')).toBeUndefined(); // yesterday's memory is not today's
    expect(urls).toHaveLength(asked);
  });
});
