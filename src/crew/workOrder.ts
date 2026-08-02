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
