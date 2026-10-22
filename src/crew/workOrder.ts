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

import { twinFor } from '../i18n/twin.js';
import { twinOf } from '../i18n/serverTwins.js';
import type { LedgerEntry } from '../i18n/ledger.js';

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
  /** The lookup ANSWERED and no screen is on file — UNKNOWN, never "fine". */
  permitScreenPending?: boolean;
  /** The permit lookup FAILED — UNKNOWN, and never "no screen on file" (§1B). */
  permitUnreadable?: boolean;
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
  /**
   * R27 (D111): the Spanish twins of the lines above that this module wrote —
   * hazards by position (null where none may be served), permitNote — present
   * only when at least one may be served. Never scope, address or city: data
   * is never translated. Absent, the payload is byte-identical to before.
   */
  es?: { hazards?: Array<string | null>; permitNote?: string };
}

/**
 * The fixed lines this module writes, by id — the English exactly as the crew
 * has always read it. Their Spanish lives in src/i18n/twins/crew-workorder.es.json
 * under the same ids; every one is safety-class, so none is served in Spanish
 * until the review ledger records its review (R27 #4, #5).
 */
export const CREW_LINES = {
  hazardPowerLines: 'POWER LINES — utility coordination required before work near conductors',
  hazardStructures: 'STRUCTURES nearby — plan drop zone accordingly',
  permitLikely: 'PERMIT LIKELY — do not start protected work until the permit is confirmed.',
  reviewNeeded: 'PERMIT: REVIEW NEEDED — check with the office before cutting.',
  noOverlayVerify: 'NO OVERLAY — VERIFY W/ CITY before protected work.',
  permitUnreadable: 'PERMIT STATUS UNKNOWN — Arbo could not read the permit screen. Check with the office before protected work.',
  permitScreenPending: 'PERMIT SCREEN PENDING — status UNKNOWN, no screen on file. Check with the office before protected work.',
} as const;
type CrewLineId = keyof typeof CREW_LINES;
const LINE_ID = new Map<string, CrewLineId>(Object.entries(CREW_LINES).map(([id, en]) => [en, id as CrewLineId]));

/**
 * Build the crew-safe payload. Note what CANNOT appear because the type has
 * no slot for it: price, margin, lead quality, customer phone/email, tracking,
 * other crews, or any admin note.
 */
export function buildCrewPayload(src: WorkOrderSource): CrewPayload {
  const hazards: string[] = [];
  if (src.hazardPowerLines) hazards.push(CREW_LINES.hazardPowerLines);
  if (src.hazardStructures) hazards.push(CREW_LINES.hazardStructures);

  // §6B.3: a crew note may warn, may route to verification, and may never clear.
  const permitNote =
    src.permitStatus === 'PERMIT_LIKELY'
      ? CREW_LINES.permitLikely
      : src.permitStatus === 'REVIEW_NEEDED'
        ? CREW_LINES.reviewNeeded
        : src.permitStatus === 'NO_OVERLAY_VERIFY'
          ? CREW_LINES.noOverlayVerify
          // A FAILED lookup and "no screen on file" are both UNKNOWN — on a
          // safety surface, silence reads as "no concern", which it never is
          // (§6B.3). They are different facts and never read the same (§1B):
          // a failed read cannot claim no screen exists, so it is named first.
          : src.permitUnreadable
            ? CREW_LINES.permitUnreadable
            : src.permitScreenPending
              ? CREW_LINES.permitScreenPending
              : null;

  return crewPayloadTwins({
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
  });
}

/**
 * R27 (D111): the Spanish twins of this payload's own lines, under `es`, for
 * the ones that may be served (twinFor: the same English, no banned word, no
 * lost number, and — every line here being safety-class — a recorded review).
 * None servable: the very same object comes back, so English is byte-identical.
 * `ledger` is the committed review ledger unless a test hands one in.
 */
export function crewPayloadTwins(p: CrewPayload, ledger?: LedgerEntry[]): CrewPayload {
  const twin = (en: string): string | null => {
    const id = LINE_ID.get(en);
    return id ? twinFor(en, twinOf('crew-workorder', id), ledger) : null;
  };
  const hazards = p.hazards.map(twin);
  const permitNote = p.permitNote === null ? null : twin(p.permitNote);
  if (!hazards.some((h) => h !== null) && permitNote === null) return p;
  const es: NonNullable<CrewPayload['es']> = {};
  if (hazards.some((h) => h !== null)) es.hazards = hazards;
  if (permitNote !== null) es.permitNote = permitNote;
  return { ...p, es };
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
