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
import { describe, it, expect } from 'vitest';
import { fileNearMiss, categoriseHazard, NearMissRejected } from '../src/safety/nearMiss.js';
import {
  findCertProblems, certState, aerialBlockers, URGENT_DAYS, UPCOMING_DAYS,
  type CertRow, type CrewMemberRef,
} from '../src/safety/certifications.js';
import { createApi, type DataSource } from '../src/server/api.js';

const TODAY = '2026-08-02';
const CREW_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('near-miss filing (§6V) — blameless by construction', () => {
  it('files a report and types blameless as literally true', () => {
    const f = fileNearMiss({
      reportedBy: 'c1', description: 'Limb came down early, nobody in the drop zone',
      occurredOn: TODAY,
    }, TODAY);
    expect(f.blameless).toBe(true);
    expect(f.hazardCategory).toBe('struck_by');
  });

  it('has no slot anywhere for fault, discipline, or who-messed-up', () => {
    const f = fileNearMiss({ reportedBy: 'c1', description: 'Saw kicked back', occurredOn: TODAY }, TODAY);
    // 'blameless' is the one key allowed to contain the word.
    const keys = Object.keys(f).map((k) => k.toLowerCase()).filter((k) => k !== 'blameless');
    for (const forbidden of ['fault', 'blame', 'discipline', 'responsible', 'writeup', 'warning', 'severity']) {
      expect(keys.some((k) => k.includes(forbidden)), `payload exposed "${forbidden}"`).toBe(false);
    }
  });

  it('categorises from the reporter\'s own words, worst hazard first', () => {
    expect(categoriseHazard('Bucket drifted toward the service drop')).toBe('electrical');
    expect(categoriseHazard('Lanyard slipped while climbing')).toBe('fall');
    expect(categoriseHazard('Rigging block shifted under load')).toBe('rigging');
    expect(categoriseHazard('Chainsaw kickback near my knee')).toBe('cutting');
    expect(categoriseHazard('Backing the trailer, spotter stepped out')).toBe('vehicle');
    expect(categoriseHazard('Hit a wasp nest in the canopy')).toBe('environmental');
  });

  it('§1B — an unrecognisable report is uncategorised, never guessed into a bucket', () => {
    const f = fileNearMiss({ reportedBy: 'c1', description: 'Something felt off today', occurredOn: TODAY }, TODAY);
    expect(f.hazardCategory).toBe('uncategorised');
  });

  it('electrical outranks every other keyword in the same sentence', () => {
    // A report mentioning both a saw and a power line is an electrical near
    // miss. Getting this order wrong buries the one that kills.
    expect(categoriseHazard('Was cutting with the saw and got close to the power line')).toBe('electrical');
  });

  it('rejects only the facts the record is useless without', () => {
    const base = { reportedBy: 'c1', description: 'Limb fell', occurredOn: TODAY };
    expect(() => fileNearMiss({ ...base, reportedBy: '' }, TODAY)).toThrow(NearMissRejected);
    expect(() => fileNearMiss({ ...base, description: '   ' }, TODAY)).toThrow(NearMissRejected);
    expect(() => fileNearMiss({ ...base, occurredOn: '08/02/2026' }, TODAY)).toThrow(NearMissRejected);
  });

  it('a near miss cannot have happened tomorrow', () => {
    expect(() => fileNearMiss(
      { reportedBy: 'c1', description: 'Limb fell', occurredOn: '2026-08-03' }, TODAY,
    )).toThrow(/future_date/);
  });

  it('accepts a ten-word report — friction is the enemy of reporting', () => {
    const f = fileNearMiss({ reportedBy: 'c1', description: 'rope slipped', occurredOn: TODAY }, TODAY);
    expect(f.description).toBe('rope slipped');
  });
});

const crew: CrewMemberRef[] = [
  { id: 'm1', name: 'Climber One', role: 'climber', active: true },
  { id: 'm2', name: 'Ground One', role: 'groundie', active: true },
  { id: 'm3', name: 'Gone Fishing', role: 'climber', active: false },
];

const cert = (over: Partial<CertRow> & Pick<CertRow, 'crewMemberId' | 'type'>): CertRow => ({
  id: `${over.crewMemberId}-${over.type}`, expiresOn: '2027-01-01', ...over,
});

function fullyCertified(memberId: string): CertRow[] {
  return [
    cert({ crewMemberId: memberId, type: 'first_aid' }),
    cert({ crewMemberId: memberId, type: 'cpr' }),
    cert({ crewMemberId: memberId, type: 'aerial_rescue' }),
  ];
}

describe('certification expiry (§4/§6V) — never says anyone is qualified', () => {
  it('classifies each window off the ET day', () => {
    expect(certState('2026-07-01', TODAY).state).toBe('lapsed');
    expect(certState('2026-08-10', TODAY).state).toBe('urgent');
    expect(certState('2026-09-15', TODAY).state).toBe('upcoming');
    expect(certState('2027-06-01', TODAY).state).toBe('current');
    expect(certState(null, TODAY).state).toBe('unknown');
  });

  it('the window boundaries are inclusive on the urgent side', () => {
    const urgentEdge = new Date(Date.parse(`${TODAY}T00:00:00Z`) + URGENT_DAYS * 86400_000)
      .toISOString().slice(0, 10);
    expect(certState(urgentEdge, TODAY).state).toBe('urgent');
    const upcomingEdge = new Date(Date.parse(`${TODAY}T00:00:00Z`) + UPCOMING_DAYS * 86400_000)
      .toISOString().slice(0, 10);
    expect(certState(upcomingEdge, TODAY).state).toBe('upcoming');
  });

  it('a fully-certified crew produces NO findings — and no clearance either', () => {
    const out = findCertProblems(
      [crew[0]!],
      fullyCertified('m1'),
      TODAY,
    );
    expect(out).toEqual([]);
    // The point: the function has no vocabulary for "qualified". Its empty
    // result means "no expiry problem found", which the caller must not
    // upgrade into a claim.
  });

  it('a required cert with NO row is MISSING, not "not applicable" (§1B)', () => {
    const out = findCertProblems([crew[0]!], [cert({ crewMemberId: 'm1', type: 'first_aid' })], TODAY);
    const kinds = out.map((f) => `${f.type}:${f.state}`);
    expect(kinds).toContain('cpr:missing');
    expect(kinds).toContain('aerial_rescue:missing');
    expect(out.find((f) => f.type === 'aerial_rescue')!.line).toMatch(/NO RECORD/);
  });

  it('a row with no expiry date is UNKNOWN, never treated as valid', () => {
    const out = findCertProblems(
      [crew[0]!],
      [...fullyCertified('m1').slice(0, 2), cert({ crewMemberId: 'm1', type: 'aerial_rescue', expiresOn: null })],
      TODAY,
    );
    const aerial = out.find((f) => f.type === 'aerial_rescue')!;
    expect(aerial.state).toBe('unknown');
    expect(aerial.blocksAerialWork).toBe(true);
  });

  it('the NEWEST row governs — last year\'s expired card cannot outvote a renewal', () => {
    const out = findCertProblems([crew[0]!], [
      ...fullyCertified('m1').slice(0, 2),
      cert({ id: 'old', crewMemberId: 'm1', type: 'aerial_rescue', expiresOn: '2025-01-01' }),
      cert({ id: 'new', crewMemberId: 'm1', type: 'aerial_rescue', expiresOn: '2027-05-01' }),
    ], TODAY);
    expect(out.filter((f) => f.type === 'aerial_rescue')).toEqual([]);
  });

  it('a lapsed aerial-critical cert grounds the climber', () => {
    const out = findCertProblems([crew[0]!], [
      ...fullyCertified('m1').slice(0, 2),
      cert({ crewMemberId: 'm1', type: 'aerial_rescue', expiresOn: '2026-06-01' }),
    ], TODAY);
    expect(aerialBlockers(out, 'm1')).toHaveLength(1);
    expect(out[0]!.line).toMatch(/it is a stop/);
  });

  it('role decides what is required — a groundie needs no aerial rescue', () => {
    const out = findCertProblems([crew[1]!], [
      cert({ crewMemberId: 'm2', type: 'first_aid' }),
      cert({ crewMemberId: 'm2', type: 'cpr' }),
    ], TODAY);
    expect(out).toEqual([]);
  });

  it('an inactive crew member is not on the schedule and is not chased', () => {
    const out = findCertProblems([crew[2]!], [], TODAY);
    expect(out).toEqual([]);
  });

  it('orders worst first: lapsed, then missing, then unknown', () => {
    const out = findCertProblems([
      { id: 'a', name: 'A', role: 'climber', active: true },
      { id: 'b', name: 'B', role: 'groundie', active: true },
    ], [
      cert({ crewMemberId: 'a', type: 'first_aid', expiresOn: '2026-06-01' }), // lapsed
      cert({ crewMemberId: 'a', type: 'cpr' }),
      cert({ crewMemberId: 'a', type: 'aerial_rescue', expiresOn: null }),     // unknown
      cert({ crewMemberId: 'b', type: 'first_aid' }),                          // b: cpr missing
    ], TODAY);
    expect(out.map((f) => f.state)).toEqual(['lapsed', 'missing', 'unknown']);
  });
});

function safetySource(over: Partial<DataSource> = {}): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    fileNearMiss: async () => ({ id: 'nm1' }),
    activeCrew: async () => [crew[0]!],
    certifications: async () => fullyCertified('m1'),
    recentNearMisses: async () => [],
    ...over,
  };
}

describe('safety API', () => {
  it('files a near miss and returns the category, never a blame field', async () => {
    const res = await createApi(safetySource()).reportNearMiss({
      reportedBy: CREW_UUID, description: 'Limb came down early', occurredOn: TODAY,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'nm1', blameless: true });
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/fault|blame(?!less)|discipline/);
  });

  it('the event bus carries the category and id only — never the narrative', async () => {
    let emitted: Record<string, unknown> | null = null;
    const api = createApi(safetySource({
      emit: async (_t, payload) => { emitted = payload; return true; },
    }));
    await api.reportNearMiss({
      reportedBy: CREW_UUID, description: 'Dave nearly dropped a limb on Steve', occurredOn: TODAY,
    });
    expect(JSON.stringify(emitted)).not.toMatch(/Dave|Steve/);
    expect(emitted).toMatchObject({ hazardCategory: 'struck_by' });
  });

  it('rejects a blank report with the reason, not a 500', async () => {
    const res = await createApi(safetySource()).reportNearMiss({ reportedBy: CREW_UUID, description: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'no_description' });
  });

  it('a non-UUID reporter is rejected BEFORE the write, not as a 500', async () => {
    let wrote = false;
    const api = createApi(safetySource({
      fileNearMiss: async () => { wrote = true; return { id: 'x' }; },
    }));
    const res = await api.reportNearMiss({ reportedBy: 'dave', description: 'Limb fell' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'bad_reporter_id' });
    expect(wrote).toBe(false);
  });

  it('a reporter id that matches no crew member is NAMED, not a generic failure', async () => {
    const api = createApi(safetySource({
      fileNearMiss: async () => { throw Object.assign(new Error('fk'), { code: '23503' }); },
    }));
    const res = await api.reportNearMiss({ reportedBy: CREW_UUID, description: 'Limb fell' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'unknown_reporter' });
  });

  it('the safety board names every feed it could not read (§1B)', async () => {
    const api = createApi(safetySource({
      certifications: async () => { throw new Error('db down'); },
      recentNearMisses: async () => { throw new Error('db down'); },
    }));
    const res = await api.safety();
    expect(res.status).toBe(200);
    const b = res.body as { blindSpots: string[]; certProblems: unknown[] };
    expect(b.blindSpots).toHaveLength(2);
    expect(b.blindSpots.join(' ')).toMatch(/certifications/);
    expect(b.blindSpots.join(' ')).toMatch(/near_miss/);
    // The critical part: an empty problem list next to a blind spot must NOT
    // read as all-clear, which is why blindSpots is non-empty here.
    expect(b.certProblems).toEqual([]);
  });

  it('a clean board reports an EMPTY blind-spot list — the only all-clear', async () => {
    const res = await createApi(safetySource()).safety();
    expect((res.body as { blindSpots: string[] }).blindSpots).toEqual([]);
  });

  it('503s honestly with no database', async () => {
    const dead = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await dead.safety()).status).toBe(503);
    expect((await dead.reportNearMiss({ reportedBy: CREW_UUID, description: 'x' })).status).toBe(503);
  });
});
