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
// Crew work orders (brief §6F, §8C hard ceiling). The 6 AM push, in route
// order. The critical property: admin data is EXCLUDED BY CONSTRUCTION — the
// crew payload is built from an allow-list, so a new admin field added
// upstream can never leak into a crew surface by omission (§8C.1, §6E crew
// never see tracking, §6J2.5 pricing never leaves the office).

export interface WorkOrderSource {
  jobId: string;
  routeOrder: number;
  address: string;
  city: string;
  timeIso: string | null;
  scope: string | null;
  /** Site facts the crew must have to work safely. */
  hazardPowerLines: boolean;
  hazardStructures: boolean;
  /** Permit posture for this address — vocabulary is fixed (§6B.3). */
  permitStatus: 'PERMIT_LIKELY' | 'REVIEW_NEEDED' | 'NO_OVERLAY_VERIFY' | null;
  /** No screen on file (or the lookup failed) — UNKNOWN, never "fine". */
  permitScreenPending?: boolean;
  /** Photo refs for before/after (the job cannot complete without the pair). */
  photoRefs: string[];
  /** The gated safety briefing that rides under the order (§6V.4). */
  briefingId: string | null;
}

/** Exactly what a crew member may see. Nothing else is representable. */
export interface CrewPayload {
  jobId: string;
  routeOrder: number;
  address: string;
  city: string;
  timeIso: string | null;
  scope: string | null;
  hazards: string[];
  permitNote: string | null;
  photoRefs: string[];
  briefingId: string | null;
  requiresBeforeAfterPhotos: true;
}

/**
 * Build the crew-safe payload. Note what CANNOT appear because the type has
 * no slot for it: price, margin, lead quality, customer phone/email, tracking,
 * other crews, or any admin note.
 */
export function buildCrewPayload(src: WorkOrderSource): CrewPayload {
  const hazards: string[] = [];
  if (src.hazardPowerLines) hazards.push('POWER LINES — utility coordination required before work near conductors');
  if (src.hazardStructures) hazards.push('STRUCTURES nearby — plan drop zone accordingly');

  // §6B.3: a crew note may warn, may route to verification, and may never clear.
  const permitNote =
    src.permitStatus === 'PERMIT_LIKELY'
      ? 'PERMIT LIKELY — do not start protected work until the permit is confirmed.'
      : src.permitStatus === 'REVIEW_NEEDED'
        ? 'PERMIT REVIEW NEEDED — check with the office before cutting.'
        : src.permitStatus === 'NO_OVERLAY_VERIFY'
          ? 'No overlay found — still VERIFY with the city before protected work.'
          // No screen on file (or the lookup failed) is UNKNOWN — on a safety
          // surface, silence reads as "no concern", which it never is (§6B.3).
          : src.permitScreenPending
            ? 'PERMIT STATUS UNKNOWN — no screen on file. Check with the office before protected work.'
            : null;

  return {
    jobId: src.jobId,
    routeOrder: src.routeOrder,
    address: src.address,
    city: src.city,
    timeIso: src.timeIso,
    scope: src.scope,
    hazards,
    permitNote,
    photoRefs: src.photoRefs,
    briefingId: src.briefingId,
    requiresBeforeAfterPhotos: true,
  };
}

/** Order the day's work orders the way the truck will actually drive it. */
export function sequenceRoute(sources: WorkOrderSource[]): WorkOrderSource[] {
  return [...sources].sort((a, b) => {
    if (a.timeIso && b.timeIso) return a.timeIso.localeCompare(b.timeIso);
    if (a.timeIso) return -1;   // timed stops anchor the day
    if (b.timeIso) return 1;
    return a.routeOrder - b.routeOrder;
  }).map((s, i) => ({ ...s, routeOrder: i + 1 }));
}
