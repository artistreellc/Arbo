// Site conditions and change orders (brief §6, §4.8, §3, §4.5).
//
// This is the bridge from the field to the ledger, and it is the single most
// likely place for money to leak or for a dispute to become unwinnable:
//
//   - Arrival documentation is the defence against "that damage was your
//     crew". A job with no arrival photos cannot prove pre-existing condition
//     later, so the absence is REPORTED, not left silent (§1B).
//   - A change order is money the customer agreed to. §3 still holds: Arbo
//     never sets the amount. A human records what was agreed, exactly as
//     estimate.agreed_amount works for the base job.
//   - §4.5: a change order is an AGREEMENT, not an e-signature. Arbo records
//     that one was reached and who reached it; it does not manufacture assent.
//   - Nothing bills without approval, and nothing bills twice.

export interface SiteConditionRecord {
  jobId: string;
  arrivalIso: string;
  photoFiles: string[];
  preexistingNotes?: string;
  groundCondition?: string;
  craneDecision?: string;
  documentedBy?: string;
}

export type ArrivalGap =
  | 'no_photos'          // nothing to prove condition on arrival
  | 'no_documenter'      // nobody's name on the record
  | 'no_notes';          // photos but no written observation

export interface ArrivalAssessment {
  /** Named gaps. Empty means documented, NOT that the site was fine. */
  gaps: ArrivalGap[];
  /** True only when there is photographic evidence of arrival condition. */
  defensible: boolean;
  lines: string[];
}

const GAP_LINE: Record<ArrivalGap, string> = {
  no_photos: 'No arrival photos on this job — if the customer later claims pre-existing damage was ours, there is nothing to show.',
  no_documenter: 'Nobody is named on the arrival record — a document with no author is weak evidence.',
  no_notes: 'Photos but no written observation — note what you saw while you still remember it.',
};

/**
 * What is missing from the arrival record. Deliberately phrased as evidence
 * strength, never as "the site was clear" — Arbo cannot know that.
 */
export function assessArrival(record: SiteConditionRecord | null): ArrivalAssessment {
  if (!record) {
    return {
      gaps: ['no_photos', 'no_documenter'],
      defensible: false,
      lines: ['No arrival record at all for this job — condition on arrival is UNDOCUMENTED.'],
    };
  }
  const gaps: ArrivalGap[] = [];
  if (record.photoFiles.length === 0) gaps.push('no_photos');
  if (!record.documentedBy?.trim()) gaps.push('no_documenter');
  if (record.photoFiles.length > 0 && !record.preexistingNotes?.trim()) gaps.push('no_notes');
  return {
    gaps,
    defensible: record.photoFiles.length > 0,
    lines: gaps.map((g) => GAP_LINE[g]),
  };
}

export interface ChangeOrderInput {
  jobId: string;
  description: string;
  /** What the CUSTOMER agreed to. Arbo never derives this (§3). */
  amount: number | null;
  agreedBy?: string;
  agreedAtIso: string;
}

export class ChangeOrderRejected extends Error {
  constructor(public readonly reason:
    | 'no_job'
    | 'no_description'
    | 'no_amount'
    | 'negative_amount'
    | 'no_agreed_by'
    | 'bad_time'
    | 'future_agreement') {
    super(reason);
    this.name = 'ChangeOrderRejected';
  }
}

export interface DraftedChangeOrder {
  jobId: string;
  description: string;
  amount: number;
  agreedBy: string;
  agreedAtIso: string;
  /** ALWAYS false on creation — approval is a separate, human act. */
  approved: false;
  /** ALWAYS false on creation — billing is downstream of approval. */
  invoiced: false;
}

/**
 * Record a change order the customer agreed to on site. Strict about the four
 * facts that make it collectable, permissive about nothing:
 *   - an amount, because an unpriced change order is a dispute waiting to
 *     happen, and Arbo will not fill one in
 *   - who agreed, because "the customer said yes" with no name is not a record
 *   - a real, non-future timestamp
 */
export function draftChangeOrder(input: ChangeOrderInput, nowIso: string): DraftedChangeOrder {
  const description = input.description.trim();
  const agreedBy = (input.agreedBy ?? '').trim();
  if (!input.jobId) throw new ChangeOrderRejected('no_job');
  if (!description) throw new ChangeOrderRejected('no_description');
  // §3: Arbo does not price. A missing amount is a question for the human,
  // never a number this function invents.
  if (input.amount === null || !Number.isFinite(input.amount)) throw new ChangeOrderRejected('no_amount');
  if (input.amount <= 0) throw new ChangeOrderRejected('negative_amount');
  if (!agreedBy) throw new ChangeOrderRejected('no_agreed_by');

  const agreed = Date.parse(input.agreedAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(agreed)) throw new ChangeOrderRejected('bad_time');
  // A minute of clock skew is normal; an agreement dated tomorrow is not.
  if (agreed > now + 60_000) throw new ChangeOrderRejected('future_agreement');

  return {
    jobId: input.jobId,
    description,
    amount: input.amount,
    agreedBy,
    agreedAtIso: input.agreedAtIso,
    approved: false,
    invoiced: false,
  };
}

export interface ChangeOrderRow {
  id: string;
  jobId: string;
  description: string;
  amount: number | null;
  approved: boolean;
  invoiced: boolean;
  agreedAtIso: string;
}

export interface BillableChanges {
  /** Approved, not yet invoiced, with a real amount. Safe to add to a bill. */
  billable: ChangeOrderRow[];
  /** Approved but carrying no amount — cannot be billed, and says why. */
  unpriced: ChangeOrderRow[];
  /** Waiting on Mike. Never billed, never silently dropped. */
  awaitingApproval: ChangeOrderRow[];
  /** Sum of the billable ones only. Null when there is nothing billable. */
  billableTotal: number | null;
}

/**
 * Split change orders into what can be billed and what cannot. Every bucket
 * is returned: a change order that falls out of "billable" must still be
 * visible, or the work quietly goes unpaid — which is the exact leak §1E
 * exists to catch.
 */
export function splitChangeOrders(rows: ChangeOrderRow[]): BillableChanges {
  const billable: ChangeOrderRow[] = [];
  const unpriced: ChangeOrderRow[] = [];
  const awaitingApproval: ChangeOrderRow[] = [];

  for (const r of rows) {
    if (r.invoiced) continue; // already on a bill; not a loop
    if (!r.approved) { awaitingApproval.push(r); continue; }
    if (r.amount === null || !(r.amount > 0)) { unpriced.push(r); continue; }
    billable.push(r);
  }

  const total = billable.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  return {
    billable,
    unpriced,
    awaitingApproval,
    billableTotal: billable.length ? Math.round(total * 100) / 100 : null,
  };
}
