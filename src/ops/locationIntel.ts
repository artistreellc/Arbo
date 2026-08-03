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
// Location intelligence (§5A #21–24). Pure functions over pings + stops —
// the live wiring feeds them Mike's phone pings and the day's geocoded stops.
//
// The §24 law lives HERE, in code, not in a setting nobody reads:
//   - pings are only accepted while the master switch is ON, and
//   - only during working hours (Mon–Fri, with a travel margin around the
//     8–5 day). Off-hours pings are rejected with a named reason — the
//     server never quietly stores after-hours location.
//
// #23 is recommend-only like everything else: ARBOR drafts the running-late
// message and Mike sends it. Without live traffic data the draft uses the
// softer "running a little behind" wording (brief §3) — a straight-line ETA
// is an estimate, and estimates are never spoken as facts.

export interface LocationPing {
  lat: number;
  lng: number;
  accuracyM?: number;
  atIso: string;
}

export interface GeoStop {
  id: string;
  kind: 'estimate' | 'job';
  lat: number;
  lng: number;
  timeIso: string | null;
  name?: string;
}

/** Great-circle distance in meters (haversine — plenty for city-scale fences). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  hour12: false,
});

/**
 * §24 gate: Mon–Fri, 07:00–18:59 ET — the 8–5 workday plus commute margin.
 * Everything else is "after hours" and pings are refused.
 */
export function withinWorkingHours(now: Date): boolean {
  const parts = ET_PARTS.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '-1') % 24;
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return hour >= 7 && hour < 19;
}

/** Inside this radius of a stop, a ping counts as "at the property". */
export const GEOFENCE_RADIUS_M = 150;
/** One blip can be GPS noise or a drive-by; two pings inside = a real visit. */
export const VISIT_MIN_PINGS = 2;
/** A ping older than this says nothing about where Mike is NOW. */
export const PING_FRESH_MS = 15 * 60 * 1000;

export interface VisitCheck {
  stopId: string;
  /** Tri-state honest (§12): true / false only when pings covered the window; 'no_data' otherwise. */
  visited: boolean | 'no_data';
  firstSeenIso?: string;
}

/**
 * #21/#22 — which stops did the pings actually reach? A day with no pings at
 * all answers 'no_data' for every stop: absence of tracking is never
 * evidence of a skip.
 */
export function detectVisits(pings: LocationPing[], stops: GeoStop[]): VisitCheck[] {
  return stops.map((stop) => {
    if (pings.length === 0) return { stopId: stop.id, visited: 'no_data' as const };
    const inside = pings
      .filter((p) => distanceMeters(p, stop) <= GEOFENCE_RADIUS_M)
      .sort((a, b) => a.atIso.localeCompare(b.atIso));
    if (inside.length >= VISIT_MIN_PINGS) {
      return { stopId: stop.id, visited: true, firstSeenIso: inside[0]!.atIso };
    }
    return { stopId: stop.id, visited: false };
  });
}

/** Conservative city driving estimate when there is no live-traffic provider. */
const FALLBACK_SPEED_M_PER_MIN = 550; // ≈ 20.5 mph door-to-door
const LATE_GRACE_MIN = 10;

export interface LateAssessment {
  state: 'no_data' | 'on_track' | 'tight' | 'late';
  nextStopId?: string;
  /** Minutes past the appointment the straight-line estimate says he'd arrive. */
  minutesBehind?: number;
  /** Drafted customer message — Mike sends it, ARBOR never does. */
  draftMessage?: string;
  recommendOnly: true;
}

/**
 * #23 running-late check. Honest degradation ladder:
 *   no fresh ping → no_data (we don't know, and we say so);
 *   fresh ping + no timed stop ahead → on_track;
 *   estimate says he can't make it → late, with the SOFT draft (no live
 *   traffic feed yet, so the message never states a hard ETA).
 */
export function assessRunningLate(
  latestPing: LocationPing | null,
  nextStop: GeoStop | null,
  now: Date,
): LateAssessment {
  if (!latestPing || now.getTime() - Date.parse(latestPing.atIso) > PING_FRESH_MS) {
    return { state: 'no_data', recommendOnly: true };
  }
  if (!nextStop?.timeIso) return { state: 'on_track', recommendOnly: true };

  const travelMin = distanceMeters(latestPing, nextStop) / FALLBACK_SPEED_M_PER_MIN;
  const arrivalMs = now.getTime() + travelMin * 60 * 1000;
  const minutesBehind = Math.round((arrivalMs - Date.parse(nextStop.timeIso)) / 60000);

  if (minutesBehind > LATE_GRACE_MIN) {
    const first = nextStop.name?.trim().split(/\s+/)[0];
    return {
      state: 'late',
      nextStopId: nextStop.id,
      minutesBehind,
      draftMessage: `Hi${first ? ` ${first}` : ''}, this is ARBOR with Art-is-Tree. Mike is finishing up a job and is running a little behind for your appointment — he doesn't want to leave you waiting, so he'll confirm an updated time shortly. Thanks for your patience!`,
      recommendOnly: true,
    };
  }
  if (minutesBehind > 0) {
    return { state: 'tight', nextStopId: nextStop.id, minutesBehind, recommendOnly: true };
  }
  return { state: 'on_track', nextStopId: nextStop.id, minutesBehind, recommendOnly: true };
}
