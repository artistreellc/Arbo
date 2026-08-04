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
// R9 — THE LEAD/JOB BOUNDARY. Where a potential customer stops being a lead
// and becomes money.
//
// MIKE, 2026-08-04, IN HIS WORDS:
//   "when a customer contacts us, initially, it is a lead. Then after they
//    text me or email me, a signed proposal or I take a picture myself
//    on-site, it is still simply just a lead. Booked jobs are those contracts
//    that you're putting in the signed contract file. Those are proposals
//    that turn to contracts. That is the money. Those are what we want.
//    Everything else is a potential lead."
//
// So the line is not "we have talked to them a lot" or "they are on the
// calendar" or even "they signed the proposal". It is ONE fact: a proposal
// became a contract and that contract is in the Signed Contracts file.
//
// ═══ WHY THIS FILE EXISTS AT ALL ═══
// Because the app already got this wrong, in production, with his money. I
// ingested his leads and eleven of them landed in the `job` table at status
// 'booked' — which the crew door renders as work orders. As of this writing
// those eleven rows are still there and there are ZERO contracts in the
// database, so every one of them is a job by the schema and a LEAD by Mike's
// rule. He said cut, not delete, so they stay. What changes is that nothing
// downstream is allowed to believe them.
//
// ═══ WHAT ACTUALLY ENFORCES THE RULE ═══
// Precisely one input can produce `ok: true`: a non-null `contract` carrying
// a `driveFileId`. There is no `force`, no `skipContract`, no "trust the
// calendar", and no second parameter that shortcuts it. That — not the
// discriminant below — is the enforcement, and it is worth being exact about
// which is which: `SignedContractOnFile.kind` has one member so that a future
// second kind of evidence (a verbal yes, a deposit) cannot be passed off as a
// filed contract, but today it guards a door nobody is standing at. Claiming
// otherwise would be the same overclaiming this codebase keeps catching.
//
// ═══ AND A JOB WITHOUT A CONTRACT IS NAMED, NOT HIDDEN ═══
// §1B. When the read path meets a `job` row with no contract behind it, the
// answer is neither "work order" nor silence. It is "this is scheduled and it
// is NOT a work order, because no signed contract is on file". Dropping it
// quietly would be the same lie in the other direction — Mike would look at a
// short list and think the day was short.

/**
 * The one thing that makes a job. A proposal that became a contract, filed.
 *
 * `driveFileId` is required and non-null: the ruling is not "a contract
 * exists somewhere", it is "you're putting it in the signed contract file".
 * A contract nobody filed cannot be produced when it matters, so it does not
 * count here.
 */
export interface SignedContractOnFile {
  kind: 'signed_contract_on_file';
  contractId: string;
  /** Drive file id inside the Signed Contracts folder. */
  driveFileId: string;
  propertyId: string;
  /** The estimate/proposal this contract came from, when it is known. */
  estimateId?: string;
}

/**
 * Every stage that is still a LEAD, listed because Mike listed them. This is
 * documentation with teeth: `authorizeBooking` refuses each one by name, so
 * the refusal a person reads says which stage they are actually at.
 */
export type LeadStage =
  | 'contacted' // they called, texted, filled the form
  | 'in_conversation' // they have texted or emailed Mike back and forth
  | 'proposal_sent' // a proposal is out
  | 'proposal_signed' // THEY SIGNED THE PROPOSAL. Still a lead.
  | 'site_photographed'; // Mike took the photos himself on site. Still a lead.

export const LEAD_STAGES: LeadStage[] = [
  'contacted',
  'in_conversation',
  'proposal_sent',
  'proposal_signed',
  'site_photographed',
];

export interface BookingRequest {
  propertyId: string;
  /** Where the customer actually is. Every value here is still a lead. */
  stage: LeadStage;
  /** The ONLY thing that can promote them. Null while they are a lead. */
  contract: SignedContractOnFile | null;
  scheduledForIso?: string;
  estimateId?: string;
}

export type BookingOutcome =
  | { ok: true; job: { propertyId: string; contractId: string; estimateId?: string; scheduledForIso?: string } }
  | { ok: false; stillALead: LeadStage; refusals: string[] };

/**
 * The gate. Pure — returns the job to write and writes nothing itself.
 *
 * Refusals are sentences, not codes, for the same reason the permit clearance
 * refusals are: the person reading this is Mike, on a phone, and "invalid
 * state" tells him nothing.
 */
export function authorizeBooking(req: BookingRequest): BookingOutcome {
  const refusals: string[] = [];

  if (!req.propertyId || req.propertyId.trim() === '') {
    refusals.push('No property was named.');
  }

  const c = req.contract;
  if (!c) {
    refusals.push(
      req.stage === 'proposal_signed'
        ? 'A signed proposal is still a lead. It becomes a job when it turns into a contract in the Signed Contracts file.'
        : 'No signed contract on file, so this is still a lead.',
    );
  } else {
    if (!c.contractId || c.contractId.trim() === '') {
      refusals.push('The contract has no id.');
    }
    if (!c.driveFileId || c.driveFileId.trim() === '') {
      refusals.push('The contract is not in the Signed Contracts file. Filed is the whole point — an unfiled contract cannot be produced when it matters.');
    }
    if (c.propertyId !== req.propertyId) {
      refusals.push('That contract belongs to a different property.');
    }
  }

  // `!c` first so TypeScript NARROWS rather than so the code reads nicely: a
  // cast here would be the compiler agreeing to something it cannot check,
  // in the one function that decides whether a crew gets dispatched.
  if (!c || refusals.length > 0) {
    return { ok: false, stillALead: req.stage, refusals };
  }

  const estimateId = req.estimateId ?? c.estimateId;
  return {
    ok: true,
    job: {
      propertyId: req.propertyId,
      contractId: c.contractId,
      ...(estimateId ? { estimateId } : {}),
      ...(req.scheduledForIso ? { scheduledForIso: req.scheduledForIso } : {}),
    },
  };
}

/**
 * TWO MEMBERS. There is no third, and there is deliberately no "assumed" or
 * "probably" — a scheduled row either has a filed contract behind it or it
 * does not, and the crew's day is built on which one it is.
 */
export type JobStanding = 'contract_on_file' | 'no_contract_on_file';

export function jobStanding(hasFiledContract: boolean): JobStanding {
  return hasFiledContract ? 'contract_on_file' : 'no_contract_on_file';
}

/** What the crew door is allowed to treat as work, and what it must not. */
export interface WorkOrderSplit<T> {
  /** Real work orders — a filed contract stands behind every one. */
  workOrders: T[];
  /**
   * Scheduled, but NOT work orders. Counted and surfaced, never silently
   * dropped: a short list Mike cannot explain is its own §1B failure.
   */
  notWorkOrders: T[];
  /** The line an operator reads. Empty when there is nothing to say. */
  note: string;
}

/**
 * Split a scheduled day into work the crew may do and rows that only look
 * like it. `hasFiledContract` is INJECTED rather than read here, so this
 * module stays pure and the database question lives in one place.
 */
export function splitByContract<T>(
  scheduled: T[],
  hasFiledContract: (row: T) => boolean,
): WorkOrderSplit<T> {
  const workOrders: T[] = [];
  const notWorkOrders: T[] = [];
  for (const row of scheduled) {
    if (hasFiledContract(row)) workOrders.push(row);
    else notWorkOrders.push(row);
  }
  const note = notWorkOrders.length === 0
    ? ''
    : `${notWorkOrders.length} scheduled item(s) are NOT work orders — no signed contract on file. ` +
      'Under R9 those are still leads. Nobody is dispatched on them.';
  return { workOrders, notWorkOrders, note };
}

/**
 * STRUCTURAL CHECK ON THE REAL PATH, not only in a test.
 *
 * The failure this exists to make impossible is precise and it has already
 * happened once: a row reaching a crew phone as a work order when no contract
 * stands behind it. If the split above is ever bypassed, refactored around,
 * or handed a wrong predicate, this throws instead of dispatching a crew.
 */
export function assertEveryWorkOrderHasContract<T>(
  workOrders: T[],
  hasFiledContract: (row: T) => boolean,
): void {
  const bad = workOrders.filter((w) => !hasFiledContract(w)).length;
  if (bad > 0) {
    throw new Error(
      `jobBoundary: ${bad} work order(s) have no signed contract on file (R9). ` +
      'A job is a proposal that became a filed contract; nothing else dispatches a crew.',
    );
  }
}
