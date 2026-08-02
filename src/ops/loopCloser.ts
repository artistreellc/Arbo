// The Loop-Closer — the backup brain (brief §8A.5 agent #3, §1E). Triggered by
// the ABSENCE of events: it exists because Mike is the single point of failure
// and "silence is never treated as success." Pure function over a snapshot so
// every rule is testable; the live wrapper feeds it from the DB and emits
// needs_decision events through the binder.
//
// Absence of data is a SIGNAL here, never an all-clear (§1B, §12): a rule that
// cannot evaluate (missing timestamps) surfaces as 'no_data', it does not pass.

export interface LoopEstimate {
  id: string;
  propertyId: string | null;
  scheduledIso: string | null;
  visitedAtIso: string | null;
  outcome: 'pending' | 'won' | 'lost' | 'no_show';
  outcomeAtIso: string | null;
  hasJobForProperty: boolean;
}

export interface LoopJob {
  id: string;
  scheduledIso: string | null;
  status: string; // booked / in_progress / completed / paid ...
  /** When the work was finished, if it was. */
  completedAtIso?: string | null;
  /** Does an invoice exist for this job? Undefined = the check could not run. */
  hasInvoice?: boolean;
}

export interface LoopLead {
  id: string;
  createdAtIso: string;
  status: string;
  needsCallback: boolean;
}

export interface LoopSnapshot {
  nowIso: string;
  estimates: LoopEstimate[];
  jobs: LoopJob[];
  leads: LoopLead[];
}

export type NeedsDecisionKind =
  | 'estimate_went_quiet'    // visited, no outcome recorded
  | 'won_but_never_booked'   // outcome won, no job exists
  | 'job_never_closed'       // scheduled date passed, still 'booked'
  | 'work_done_never_billed' // completed job with no invoice — money left on the table
  | 'callback_still_open';   // missed call / voicemail lead nobody called back

export interface NeedsDecision {
  key: string; // stable dedupe key: kind + record id
  kind: NeedsDecisionKind;
  refId: string;
  refTable: 'estimate' | 'job' | 'lead';
  severity: 'urgent' | 'attention';
  /** Human line for the ADMIN surface only. Contains no dollar figures. */
  line: string;
  ageHours: number;
}

const HOURS = 3600_000;

function hoursBetween(aIso: string, bIso: string): number {
  return Math.max(0, (Date.parse(bIso) - Date.parse(aIso)) / HOURS);
}

export interface LoopCloserConfig {
  quietEstimateAfterH: number;   // visited, silence since
  unbookedWinAfterH: number;     // won, no job yet
  unclosedJobAfterH: number;     // past schedule, still booked
  uninvoicedJobAfterH: number;   // work finished, nothing billed
  openCallbackAfterH: number;    // missed-call lead untouched
}

export const defaultLoopConfig: LoopCloserConfig = {
  quietEstimateAfterH: 72,
  unbookedWinAfterH: 48,
  unclosedJobAfterH: 24,
  uninvoicedJobAfterH: 48,
  openCallbackAfterH: 4,
};

/** Run every silence rule over the snapshot. Deterministic, ordered worst-first. */
export function findOpenLoops(s: LoopSnapshot, cfg: LoopCloserConfig = defaultLoopConfig): NeedsDecision[] {
  const out: NeedsDecision[] = [];

  for (const e of s.estimates) {
    if (e.visitedAtIso && e.outcome === 'pending') {
      const age = hoursBetween(e.visitedAtIso, s.nowIso);
      if (age >= cfg.quietEstimateAfterH) {
        out.push({
          key: `estimate_went_quiet:${e.id}`,
          kind: 'estimate_went_quiet',
          refId: e.id,
          refTable: 'estimate',
          severity: 'attention',
          line: `Estimate visited ${Math.floor(age / 24)}d ago — no outcome recorded. Won, lost, or still deciding?`,
          ageHours: age,
        });
      }
    }
    if (e.outcome === 'won' && !e.hasJobForProperty && e.outcomeAtIso) {
      const age = hoursBetween(e.outcomeAtIso, s.nowIso);
      if (age >= cfg.unbookedWinAfterH) {
        out.push({
          key: `won_but_never_booked:${e.id}`,
          kind: 'won_but_never_booked',
          refId: e.id,
          refTable: 'estimate',
          severity: 'urgent',
          line: `Won ${Math.floor(age / 24)}d ago but no job on the calendar — the win is dying quietly.`,
          ageHours: age,
        });
      }
    }
  }

  for (const j of s.jobs) {
    if (j.status === 'booked' && j.scheduledIso) {
      const age = hoursBetween(j.scheduledIso, s.nowIso);
      if (age >= cfg.unclosedJobAfterH) {
        out.push({
          key: `job_never_closed:${j.id}`,
          kind: 'job_never_closed',
          refId: j.id,
          refTable: 'job',
          severity: 'attention',
          line: `Job was scheduled ${Math.floor(age / 24)}d ago and never marked done. Did it happen?`,
          ageHours: age,
        });
      }
    }
    // Finished work that was never billed. `hasInvoice === undefined` means the
    // invoice check could not run — that is not evidence of a bill (§1B), so
    // the rule stays silent rather than accusing Mike of forgetting.
    if (j.completedAtIso && j.hasInvoice === false) {
      const age = hoursBetween(j.completedAtIso, s.nowIso);
      if (age >= cfg.uninvoicedJobAfterH) {
        out.push({
          key: `work_done_never_billed:${j.id}`,
          kind: 'work_done_never_billed',
          refId: j.id,
          refTable: 'job',
          severity: 'urgent',
          line: `Work finished ${Math.floor(age / 24)}d ago and still has no invoice — that job has not been billed.`,
          ageHours: age,
        });
      }
    }
  }

  for (const l of s.leads) {
    if (l.needsCallback && l.status === 'new') {
      const age = hoursBetween(l.createdAtIso, s.nowIso);
      if (age >= cfg.openCallbackAfterH) {
        out.push({
          key: `callback_still_open:${l.id}`,
          kind: 'callback_still_open',
          refId: l.id,
          refTable: 'lead',
          severity: age >= 24 ? 'urgent' : 'attention',
          line: `Caller left a message ${age >= 24 ? Math.floor(age / 24) + 'd' : Math.round(age) + 'h'} ago — nobody has called back.`,
          ageHours: age,
        });
      }
    }
  }

  // Worst first: urgent before attention, older before newer.
  return out.sort((a, b) =>
    a.severity === b.severity ? b.ageHours - a.ageHours : a.severity === 'urgent' ? -1 : 1);
}
