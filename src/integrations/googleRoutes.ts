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
// R16 live-traffic upgrade (Mike, 2026-09-21: "uses a live traffic app like
// google maps to have the best route"). Google Routes API computeRouteMatrix,
// TRAFFIC_AWARE. Fetch-injected and offline-testable; the caller falls back
// to ZIP estimates — and says so on the plan — when there is no key or the
// request fails. A guessed drive time labelled "live traffic" would be the
// exact §1B lie this codebase exists to prevent.

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

interface MatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string; // "123s"
  condition?: string;
}

/**
 * Minutes matrix between all points (origins = destinations = points).
 * Throws on any failure — the planner catches and degrades HONESTLY.
 */
export async function fetchDriveMinutesMatrix(
  addresses: string[],
  apiKey: string,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
  departureIso?: string,
): Promise<number[][]> {
  const waypoints = addresses.map((a) => ({ waypoint: { address: a } }));
  const res = await fetchFn(MATRIX_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition',
    },
    body: JSON.stringify({
      origins: waypoints,
      destinations: waypoints,
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      ...(departureIso ? { departureTime: departureIso } : {}),
    }),
  });
  if (!res.ok) throw new Error(`routes matrix HTTP ${res.status}`);
  const rows = (await res.json()) as MatrixElement[];
  if (!Array.isArray(rows)) throw new Error('routes matrix: unexpected response shape');
  const n = addresses.length;
  const out: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => Number.NaN));
  for (const el of rows) {
    if (el.originIndex === undefined || el.destinationIndex === undefined) continue;
    const secs = el.duration ? Number(el.duration.replace(/s$/, '')) : Number.NaN;
    out[el.originIndex]![el.destinationIndex] = Number.isFinite(secs) ? Math.max(1, Math.round(secs / 60)) : Number.NaN;
  }
  // Every pair must be answered — a matrix with holes is a failed matrix.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && !Number.isFinite(out[i]![j])) throw new Error('routes matrix: incomplete');
    }
  }
  return out;
}
