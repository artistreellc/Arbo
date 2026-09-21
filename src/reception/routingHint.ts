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
// R15 (Mike, 2026-09-21): "i want her to know where my current location is,
// like if im working in that zip code or near by and use that to add the
// estimate to the weekday if im close by or on my way home from the job."
//
// ═══ THE MODEL NEVER SEES A LOCATION ═══
// Mike's home and work ZIPs are anchors for SERVER-side math only. What the
// model receives is the CONCLUSION ("this caller's area is convenient this
// week") — never a ZIP, never an address, never a route. A receptionist that
// can be talked into saying where the owner lives or works is not a feature;
// it is a safety hole. The context line below says so explicitly.
//
// ═══ V1 IS DELIBERATELY CRUDE ═══
// Same ZIP = there; same first-3-digits = nearby (Hampton Roads ZIPs cluster
// by prefix). No routing engine, no geocoding — "why do you make everything
// insanely complicated" is a standing quote. The work ZIP is set by Mike on
// the Settings screen and lives in memory (reset on redeploy, said on the
// screen); it upgrades to live phone pings when tracking + data links come
// on. No anchors set → no hint → she offers nothing special (§1B: not
// knowing where Mike is must never render as "he's nearby").

export type ProximityHint = 'near_work' | 'near_home' | null;

/** First Virginia-shaped ZIP (23xxx) in a caller utterance, if any. */
export function extractVaZip(text: string): string | null {
  const m = text.match(/\b(23\d{3})\b/);
  return m ? m[1]! : null;
}

function near(zipA: string, zipB: string | null): boolean {
  if (!zipB) return false;
  return zipA === zipB || zipA.slice(0, 3) === zipB.slice(0, 3);
}

export interface RouteAnchors {
  /** Where Mike is working today — Settings screen, in-memory. */
  workZip: string | null;
  /** Mike's home ZIP — env only, never config, never prompt. */
  homeZip: string | null;
}

export function proximityHint(callerZip: string, a: RouteAnchors): ProximityHint {
  if (near(callerZip, a.workZip)) return 'near_work';
  if (near(callerZip, a.homeZip)) return 'near_home';
  return null;
}

/**
 * The ONLY thing the model ever sees. Conclusion, not coordinates — and an
 * explicit instruction that Mike's whereabouts are never spoken.
 */
export function hintContextLine(h: ProximityHint): string | null {
  if (h === null) return null;
  const why = h === 'near_work' ? "near where Mike is already working today" : "along Mike's route at the end of his day";
  return `CALL CONTEXT: this caller's property is ${why}, so a weekday estimate after 4 THIS WEEK is easy to make happen — offer it with confidence. NEVER tell the caller where Mike is, works, lives, or drives; the reason stays internal. You still never promise an exact time.`;
}

// ── Live office-phone location (Mike, 2026-09-21): the phone posts its ZIP
// during the 8am–8pm Mon–Sat window; a Settings toggle can shut the whole
// thing off. In-memory like everything else here — a stale ping says nothing
// about where Mike is NOW, so freshness is enforced, not assumed. ──
export const LIVE_ZIP_FRESH_MS = 60 * 60 * 1000;

let locationEnabled = true; // Mike's ruling: on by default, toggle in Settings
let livePing: { zip: string; atMs: number } | null = null;

export function setLocationEnabled(on: boolean): void {
  locationEnabled = on;
  if (!on) livePing = null; // off means OFF — nothing retained
}
export function isLocationEnabled(): boolean {
  return locationEnabled;
}
export function setLivePingZip(zip: string, atMs: number): void {
  if (!locationEnabled) return;
  livePing = { zip, atMs };
}
/** The live anchor, or null when the toggle is off / no fresh ping exists. */
export function getLiveWorkZip(nowMs: number): string | null {
  if (!locationEnabled || livePing === null) return null;
  return nowMs - livePing.atMs <= LIVE_ZIP_FRESH_MS ? livePing.zip : null;
}
/** Admin-screen state: the owner sees his own toggle and freshness plainly. */
export function liveLocationState(nowMs: number): { enabled: boolean; zip: string | null; ageMinutes: number | null } {
  const zip = getLiveWorkZip(nowMs);
  return {
    enabled: locationEnabled,
    zip,
    ageMinutes: zip && livePing ? Math.round((nowMs - livePing.atMs) / 60000) : null,
  };
}

// ── Today's work ZIP: in-memory, Settings-set, honest about resetting. ──
let todayWorkZip: string | null = null;
export function setTodayWorkZip(zip: string | null): void {
  todayWorkZip = zip;
}
export function getTodayWorkZip(): string | null {
  return todayWorkZip;
}
