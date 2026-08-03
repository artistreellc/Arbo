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
// SIMULATION SEED — obviously-fake data to exercise every screen.
//
// Why this file exists: Mike's real leads ended up in the database because
// the app needed something to render. That must never be the reason again.
// The app is not finished; until it is, the only rows in it are these.
//
// Every record here is UNMISTAKABLY fake, on purpose:
//   - names are SIM- prefixed
//   - phone numbers are 555-01xx (the reserved fictional block)
//   - addresses are on streets that do not exist in Hampton Roads
//   - every row carries `SIMULATED` in a text field a human would read
// If any of this is ever mistaken for live business, the seed has failed.
//
// It writes ONLY to an empty database. If real rows are present it refuses
// and says so — mixing simulation into live data is the exact failure this
// file is meant to prevent (§1B: a made-up number that reads as real is
// worse than no number).

import { getDb, hasDb } from '../db/client.js';

/** The reserved fictional phone block. Never a real subscriber. */
const simPhone = (n: number) => `757-555-01${String(n).padStart(2, '0')}`;

/** Streets that do not exist, in cities that do. */
const SIM_PROPERTIES = [
  { address: '101 Simulation Row', city: 'Virginia Beach', zip: '23451' },
  { address: '202 Placeholder Way', city: 'Norfolk', zip: '23503' },
  { address: '303 Testbed Loop', city: 'Chesapeake', zip: '23320' },
  { address: '404 Notfound Lane', city: 'Portsmouth', zip: '23701' },
  { address: '505 Fixture Court', city: 'Virginia Beach', zip: '23454' },
];

const SIM_CONTACTS = [
  { name: 'SIM-Alder, Test', phone: simPhone(1) },
  { name: 'SIM-Birch, Test', phone: simPhone(2) },
  { name: 'SIM-Cedar, Test', phone: simPhone(3) },
  { name: 'SIM-Dogwood, Test', phone: simPhone(4) },
  { name: 'SIM-Elm, Test', phone: simPhone(5) },
];

/** Every channel the classifier knows, so each branch has something to read. */
const SIM_LEAD_SOURCES = ['lsa', 'callrail', 'homeadvisor', 'yelp', 'phone'] as const;

export interface SeedResult {
  wrote: boolean;
  reason?: string;
  counts: Record<string, number>;
}

/**
 * Refuse on a non-empty database. This is the whole safety of the file: a
 * seed that merges into live rows makes simulated and real indistinguishable,
 * which is the §1B failure in its most dangerous form.
 */
async function isEmpty(): Promise<{ empty: boolean; found: Record<string, number> }> {
  const db = getDb();
  const found: Record<string, number> = {};
  for (const table of ['lead', 'contact', 'property', 'job', 'estimate']) {
    const res = await db.from(table).select('id', { count: 'exact', head: true });
    if (res.error) throw res.error;
    if ((res.count ?? 0) > 0) found[table] = res.count ?? 0;
  }
  return { empty: Object.keys(found).length === 0, found };
}

export async function seedSimulation(): Promise<SeedResult> {
  if (!hasDb()) return { wrote: false, reason: 'db_not_configured', counts: {} };

  const { empty, found } = await isEmpty();
  if (!empty) {
    return {
      wrote: false,
      reason: 'database_not_empty',
      counts: found,
    };
  }

  const db = getDb();
  const counts: Record<string, number> = {};

  const props = await db.from('property').insert(
    SIM_PROPERTIES.map((p) => ({ ...p, notes: 'SIMULATED — not a real property' })),
  ).select('id, city');
  if (props.error) throw props.error;
  counts.property = props.data.length;

  const contacts = await db.from('contact').insert(
    SIM_CONTACTS.map((c) => ({
      name: c.name,
      phones: [c.phone],
      is_first_timer: true,
      notes: 'SIMULATED — not a real customer',
    })),
  ).select('id');
  if (contacts.error) throw contacts.error;
  counts.contact = contacts.data.length;

  const leads = await db.from('lead').insert(
    SIM_LEAD_SOURCES.map((source, i) => ({
      source,
      details: `SIMULATED ${source} lead — seeded for testing, not a real enquiry`,
      status: 'new',
      is_emergency: false,
      property_id: props.data[i % props.data.length]!.id,
      contact_id: contacts.data[i % contacts.data.length]!.id,
    })),
  ).select('id');
  if (leads.error) throw leads.error;
  counts.lead = leads.data.length;

  return { wrote: true, counts };
}

/** `npm run seed` — prints what it did and never guesses. */
if (process.argv[1]?.endsWith('seed.ts')) {
  seedSimulation()
    .then((r) => {
      if (!r.wrote && r.reason === 'database_not_empty') {
        console.error('REFUSED — the database is not empty:', JSON.stringify(r.counts));
        console.error('Clear it first. A seed that merges into live rows makes simulated and real indistinguishable.');
        process.exit(1);
      }
      if (!r.wrote) {
        console.error('REFUSED —', r.reason);
        process.exit(1);
      }
      console.log('seeded (all rows SIMULATED):', JSON.stringify(r.counts));
    })
    .catch((e) => {
      console.error('seed failed:', e instanceof Error ? e.message : 'error');
      process.exit(1);
    });
}
