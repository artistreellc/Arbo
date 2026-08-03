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
// THE SIMULATION DATA SOURCE — an in-memory app with nothing real in it.
//
// Mike, 2026-08-03: "you can make simulations to test connections", with the
// data links CUT (CLAUDE.md §3). This is how both hold at once: the server
// runs on this instead of Supabase, so every screen renders end to end and
// NOTHING touches a real table. It never opens a database connection at all.
//
// Two rules govern everything below.
//
// 1. IT MUST BE IMPOSSIBLE TO MISTAKE FOR LIVE BUSINESS. Every name is
//    SIM-prefixed, every number is in the reserved 555-01xx fictional block,
//    every street does not exist, and every free-text field says SIMULATED.
//    If a screenshot of this could pass for Mike's real day, it has failed.
//
// 2. IT MUST EXERCISE THE HONEST STATES, NOT JUST THE HAPPY ONES. §1B lives
//    or dies on what the screens do when a feed is dead, a figure is missing,
//    or a credential has no date. So the fixtures deliberately include a
//    truck with no measurements, an invoice with no send date, a cert with no
//    expiry, a campaign with no tracking number, and an area with too few
//    jobs to rate. A simulation that only shows the good path proves nothing.

import type { DataSource } from '../server/api.js';

/** The reserved fictional block. Never a real subscriber. */
const p = (n: number) => `757-555-01${String(n).padStart(2, '0')}`;
const iso = (dayOffset: number, hour: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const SIM_CREW = [
  { id: 'sim-crew-1', name: 'SIM-Alder, Test', role: 'climber', competencyLevel: 7, active: true },
  { id: 'sim-crew-2', name: 'SIM-Birch, Test', role: 'groundie', competencyLevel: 3, active: true },
  // An unrecognised role, so the STRICTEST-requirements path is visible.
  { id: 'sim-crew-3', name: 'SIM-Cedar, Test', role: 'bucket op', competencyLevel: 4, active: true },
];

/**
 * Deliberately mixed: one current, one lapsed, one with NO expiry date. The
 * third is the important one — it must render as UNKNOWN, never as current.
 */
const SIM_CERTS = [
  { id: 'sim-cert-1', crewMemberId: 'sim-crew-1', type: 'first_aid' as const, expiresOn: iso(300, 12).slice(0, 10) },
  { id: 'sim-cert-2', crewMemberId: 'sim-crew-1', type: 'aerial_rescue' as const, expiresOn: iso(-20, 12).slice(0, 10) },
  { id: 'sim-cert-3', crewMemberId: 'sim-crew-2', type: 'cpr' as const, expiresOn: null },
];

const SIM_UNITS = [
  {
    id: 'sim-unit-1', name: 'SIM Chip truck', kind: 'chip truck', status: 'up',
    vinOrSerial: 'SIM-VIN-0001', heightInches: 138, weightLbsLoaded: 26000, openTasks: 0,
  },
  {
    // No measurements: the SIZE UNKNOWN / routed-conservatively path.
    id: 'sim-unit-2', name: 'SIM Chipper', kind: 'chipper', status: 'down',
    vinOrSerial: 'SIM-VIN-0002', heightInches: null, weightLbsLoaded: null, openTasks: 2,
  },
];

const SIM_JOBS = [
  {
    jobId: 'sim-job-1', scheduledFor: iso(0, 13), address: '101 Simulation Row',
    city: 'Virginia Beach', scope: 'SIMULATED — remove leaning pine',
    hazardPowerLines: true, hazardStructures: false, permitStatus: 'PERMIT_LIKELY',
    propertyId: 'sim-prop-1',
  },
  {
    jobId: 'sim-job-2', scheduledFor: iso(0, 16), address: '202 Placeholder Way',
    city: 'Norfolk', scope: 'SIMULATED — crown reduction',
    hazardPowerLines: false, hazardStructures: true, permitStatus: null,
    propertyId: 'sim-prop-2',
  },
];

/**
 * Every channel, so each classifier branch has something to render — and one
 * with no property attached, because that is the common real shape.
 */
const SIM_LEADS = ['lsa', 'callrail', 'homeadvisor', 'yelp', 'phone'].map((source, i) => ({
  id: `sim-lead-${i + 1}`,
  source,
  details: `SIMULATED ${source} enquiry — seeded, not a real customer`,
  qualification: null,
  isEmergency: source === 'phone',
  status: 'new',
  createdAt: iso(-i, 14),
  name: `SIM-${['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm'][i]}, Test`,
  phone: p(i + 1),
  propertyId: i === 4 ? null : `sim-prop-${(i % 3) + 1}`,
  city: ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth', 'Virginia Beach'][i]!,
  zip: null,
  isFirstTimer: true,
  permit: null,
  history: null,
}));

/**
 * The simulated app. Only the methods the main screens read are implemented;
 * everything else stays undefined, which makes its handler answer 503 — the
 * same honest "Arbo cannot see that" a real gap produces. Faking every method
 * would hide which parts of the app are genuinely wired.
 */
export function createSimSource(): DataSource {
  return {
    ready: () => true,

    stopsBetween: async () => SIM_JOBS.map((j) => ({
      id: j.jobId, kind: 'job' as const, timeIso: j.scheduledFor, name: 'SIM-Test',
      phone: p(1), address: j.address, city: j.city, isFirstTimer: true, scope: j.scope,
    })),

    newLeads: async (limit: number) => SIM_LEADS.slice(0, limit),

    crewJobs: async () => SIM_JOBS,

    units: async () => SIM_UNITS,
    unitParts: async (unitId: string) => (unitId === 'sim-unit-1'
      ? [{ partNumber: 'SIM-BELT-01', description: 'SIMULATED drive belt', supplier: 'SIM Supply Co', lastPrice: null }]
      : []),
    unitOpenTaskCount: async (unitId: string) => SIM_UNITS.find((u) => u.id === unitId)?.openTasks ?? 0,
    unitStatus: async (unitId: string) => (SIM_UNITS.find((u) => u.id === unitId)?.status ?? null) as never,

    activeCrew: async () => SIM_CREW.map((c) => ({ id: c.id, name: c.name, role: c.role, active: c.active })),
    certifications: async () => SIM_CERTS,
    fullRoster: async () => SIM_CREW,
    crewSkillLevel: async (id: string) => SIM_CREW.find((c) => c.id === id)?.competencyLevel ?? null,

    // One billable job with an agreed figure, one WITHOUT — the §3 path where
    // Arbo refuses to invent a number and says why.
    billableJobs: async () => [
      { jobId: 'sim-job-1', name: 'SIM-Alder, Test', completedAtIso: iso(-3, 15), agreedAmount: 1850, hasInvoice: false },
      { jobId: 'sim-job-2', name: 'SIM-Birch, Test', completedAtIso: iso(-5, 15), agreedAmount: null, hasInvoice: false },
    ],
    // One overdue, and one marked sent with NO send date — the UNKNOWN state.
    openInvoices: async () => [
      {
        id: 'sim-inv-1', jobId: 'sim-job-3', name: 'SIM-Cedar, Test', phone: p(3),
        amount: 1200, lateFeePct: 5, status: 'sent' as const,
        sentAtIso: iso(-30, 12), paidAtIso: null, netDays: 14, consentOnFile: true,
      },
      {
        id: 'sim-inv-2', jobId: 'sim-job-4', name: 'SIM-Dogwood, Test', phone: p(4),
        amount: 640, lateFeePct: 5, status: 'sent' as const,
        sentAtIso: null, paidAtIso: null, netDays: 14, consentOnFile: true,
      },
    ],

    referenceEntries: async () => [
      {
        id: 'sim-ref-1', techniqueName: 'SIM natural crotch rigging', skillLevel: 3,
        howTo: 'SIMULATED entry. Run the line over a strong union above the piece.',
        pros: ['No hardware to carry up'], cons: ['Rope wear at the crotch'],
        wontWorkWhen: 'The union has included bark.',
        sourceLink: null, standardRefs: ['Z133 §8.1'], published: true,
      },
      {
        // No limits recorded — must render the loud warning, not a blank.
        id: 'sim-ref-2', techniqueName: 'SIM speed line', skillLevel: 6,
        howTo: 'SIMULATED entry. Tension a line to a remote anchor.',
        pros: ['Keeps brush off the lawn'], cons: ['Slow to set up'],
        wontWorkWhen: null, sourceLink: null, standardRefs: ['Z133 §8.4'], published: true,
      },
      // Unpublished: held back and COUNTED, never shown to the crew (§4.7).
      {
        id: 'sim-ref-3', techniqueName: 'SIM unvetted draft', skillLevel: 5,
        howTo: 'SIMULATED draft awaiting a human vetter.',
        pros: [], cons: [], wontWorkWhen: null, sourceLink: null,
        standardRefs: [], published: false,
      },
    ],
    draftReferenceEntries: async () => [{
      id: 'sim-ref-3', techniqueName: 'SIM unvetted draft', skillLevel: 5,
      howTo: 'SIMULATED draft awaiting a human vetter.',
      pros: [], cons: [], wontWorkWhen: null, sourceLink: null,
      standardRefs: [], createdAt: iso(-2, 9),
    }],

    // Two areas rated, one with too few jobs to judge — the UNJUDGED path
    // that must never render as the bottom of a ranking (§6N.3).
    areaJobFacts: async () => [
      ...Array.from({ length: 6 }, (_, i) => ({
        jobId: `sim-a-${i}`, areaKey: 'SIM Beach North', revenue: 1800,
        hours: 4, crewSize: 3, jobType: 'removal' as const,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        jobId: `sim-b-${i}`, areaKey: 'SIM Norfolk West', revenue: 900,
        hours: 5, crewSize: 2, jobType: 'pruning' as const,
      })),
      // Only 2 jobs — under MIN_JOBS_FOR_VERDICT, so this one must render
      // UNJUDGED even though its rate is the highest on the board.
      ...Array.from({ length: 2 }, (_, i) => ({
        jobId: `sim-c-${i}`, areaKey: 'SIM Thin Sample', revenue: 2400,
        hours: 3, crewSize: 2, jobType: 'removal' as const,
      })),
    ],
    // One tracked, one with NO tracking number — reports UNKNOWN, not zero.
    campaignFacts: async () => [
      { id: 'sim-camp-1', type: 'flyer' as const, cost: 400, bookedJobs: 2, attributionWired: true },
      { id: 'sim-camp-2', type: 'ads' as const, cost: 750, bookedJobs: 0, attributionWired: false },
    ],

    todaysBriefing: async () => ({
      id: 'sim-brief-1',
      body: 'SIMULATED tailgate briefing.\nDrop zone stays clear while the saw is running.\nNobody stands under a piece that is still attached.',
      standardRefs: ['Z133 §5.1'],
    }),
  };
}
