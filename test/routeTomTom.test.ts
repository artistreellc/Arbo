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
import { describe, it, expect } from 'vitest';
import {
  planRouteTomTom,
  planRouteBest,
  planRouteLive,
  type PlanStop,
  type TomTomPlanDeps,
} from '../src/ops/routePlanner.js';
import { etWeekday, etInstant, etRfc3339, etHourMinute } from '../src/lib/etDay.js';
import { integrationStatus } from '../src/env.js';

// R35 (Mike, 2026-10-20): "and for a route planner intergrate tomtom" /
// "so its automated ...". TomTom orders the day — INSIDE Mike's R16 law,
// which it can never move: 20 minutes on site, weekdays from 4, Saturdays
// Norfolk/Chesapeake/Portsmouth from 8 and Virginia Beach after 12, the first
// visit at its window's start. Engine order: TomTom when its key is set, else
// Google Routes (R16), else the ZIP planner — and the plan always names which
// one produced it (§1B).

type Pt = { lat: number; lon: number };
const S = (id: string, zip: string, city: string, address = `${id} SIM Row, ${city}, VA ${zip}`): PlanStop => ({ id, label: `SIM-${id}`, zip, city, address });

/** A fake TomTom: every query gets a point; route() answers with the order and legs the test hands it. */
function fakeTomTom(opts: {
  unplaced?: string[];
  routes?: Array<{ order: number[]; legMinutes: number[] }>;
  fail?: Error;
} = {}) {
  const geocoded: string[] = [];
  const routed: Array<{ points: Pt[]; bestOrder: boolean; departAtIso?: string }> = [];
  const where = new Map<string, Pt>();
  let n = 0;
  const deps: TomTomPlanDeps = {
    geocode: async (q) => {
      geocoded.push(q);
      if (opts.fail) throw opts.fail;
      if (opts.unplaced?.some((u) => q.includes(u))) return null;
      if (!where.has(q)) where.set(q, { lat: 36 + ++n / 100, lon: -76 });
      return where.get(q)!;
    },
    route: async (points, o) => {
      routed.push({ points, bestOrder: o.bestOrder, ...(o.departAtIso ? { departAtIso: o.departAtIso } : {}) });
      if (opts.fail) throw opts.fail;
      const next = opts.routes?.shift();
      const w = points.length - 2;
      return next ?? { order: Array.from({ length: w }, (_, i) => i), legMinutes: Array.from({ length: w + 1 }, () => 10) };
    },
    departAt: (min) => `2026-10-21T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00-04:00`,
  };
  return { deps, geocoded, routed, where };
}

describe('planRouteTomTom — R16 law survives the optimiser', () => {
  it('weekday: TomTom picks the order, the first visit starts at 4, gaps are TomTom’s drive minutes, 20 on site', async () => {
    const stops = [S('a', '23451', 'Virginia Beach'), S('b', '23503', 'Norfolk'), S('c', '23320', 'Chesapeake')];
    // points: [start ZIP, a, b, c, home ZIP]; TomTom says c, a, b.
    const tt = fakeTomTom({ routes: [{ order: [2, 0, 1], legMinutes: [12, 18, 9, 30] }] });
    const plan = await planRouteTomTom({ stops, day: 'weekday', startZip: '23452', homeZip: '23454' }, tt.deps);
    expect(plan.mode).toBe('tomtom_traffic');
    expect(plan.visits.map((v) => v.id)).toEqual(['c', 'a', 'b']);
    expect(plan.visits.map((v) => [v.startTime, v.endTime])).toEqual([['16:00', '16:20'], ['16:38', '16:58'], ['17:07', '17:27']]);
    expect(plan.visits.every((v) => v.window === 'after_work')).toBe(true);
    // Origin = the start ZIP, destination = home; every stop is a waypoint TomTom may reorder.
    expect(tt.geocoded.slice(0, 2)).toEqual(['23452, VA', '23454, VA']);
    expect(tt.routed).toHaveLength(1);
    expect(tt.routed[0]!.points).toHaveLength(5);
    expect(tt.routed[0]!.bestOrder).toBe(true);
    expect(tt.routed[0]!.departAtIso).toBe('2026-10-21T16:00:00-04:00');
    expect(plan.note).toContain('TomTom');
    expect(plan.note).toContain('20 min on site');
  });

  it('Saturday: Virginia Beach can never be pulled into the morning — two runs, each optimised inside its own window', async () => {
    const stops = [S('vb1', '23451', 'Virginia Beach'), S('nor', '23503', 'Norfolk'), S('vb2', '23455', 'Virginia Beach'), S('ches', '23320', 'Chesapeake')];
    const tt = fakeTomTom({
      routes: [
        { order: [1, 0], legMinutes: [10, 14, 20] }, // morning: ches, nor
        { order: [1, 0], legMinutes: [22, 8, 25] }, //  afternoon: vb2, vb1
      ],
    });
    const plan = await planRouteTomTom({ stops, day: 'saturday', startZip: '23320', homeZip: null }, tt.deps);
    expect(plan.visits.map((v) => [v.id, v.window, v.startTime])).toEqual([
      ['ches', 'morning', '08:00'],
      ['nor', 'morning', '08:34'],
      ['vb2', 'afternoon', '12:00'],
      ['vb1', 'afternoon', '12:28'],
    ]);
    expect(tt.routed).toHaveLength(2);
    // The morning run's waypoints are the two non-VB stops only; the afternoon starts where the morning ended.
    expect(tt.routed[0]!.points).toHaveLength(4);
    expect(tt.routed[1]!.points[0]).toEqual(tt.where.get(stops[1]!.address!)); // last morning stop (Norfolk)
    expect(tt.routed[0]!.departAtIso).toBe('2026-10-21T08:00:00-04:00');
    expect(tt.routed[1]!.departAtIso).toBe('2026-10-21T12:00:00-04:00');
  });

  it('Saturday warnings are the same as the ZIP planner’s — a morning past noon is said, not hidden', async () => {
    const stops = Array.from({ length: 7 }, (_, i) => S(`n${i}`, '23503', 'Norfolk'));
    const tt = fakeTomTom({ routes: [{ order: [0, 1, 2, 3, 4, 5, 6], legMinutes: [20, 20, 20, 20, 20, 20, 20, 20] }] });
    const plan = await planRouteTomTom({ stops, day: 'saturday', startZip: '23503' }, tt.deps);
    expect(plan.warnings.some((w) => w.includes('past noon'))).toBe(true);
  });

  it('no start ZIP and no home ZIP: the run starts at the first stop listed, and the note says so', async () => {
    const stops = [S('a', '23503', 'Norfolk'), S('b', '23505', 'Norfolk'), S('c', '23507', 'Norfolk')];
    const tt = fakeTomTom({ routes: [{ order: [1, 0], legMinutes: [7, 11, 15] }] });
    const plan = await planRouteTomTom({ stops, day: 'weekday', startZip: null, homeZip: null }, tt.deps);
    expect(plan.visits.map((v) => [v.id, v.startTime])).toEqual([['a', '16:00'], ['c', '16:27'], ['b', '16:58']]);
    // [a, b, c, a]: a loop from the first stop, b and c reordered.
    expect(tt.routed[0]!.points).toHaveLength(4);
    expect(tt.routed[0]!.points[0]).toEqual(tt.routed[0]!.points[3]);
    expect(plan.note).toContain('first stop');
  });

  it('an address TomTom cannot place is left out and NAMED; a plan with none placed is a failure', async () => {
    const stops = [S('a', '23503', 'Norfolk'), S('lost', '23505', 'Norfolk', 'SIM nowhere')];
    const tt = fakeTomTom({ unplaced: ['SIM nowhere'] });
    const plan = await planRouteTomTom({ stops, day: 'weekday', startZip: '23503' }, tt.deps);
    expect(plan.visits.map((v) => v.id)).toEqual(['a']);
    expect(plan.unplaced.map((u) => u.id)).toEqual(['lost']);
    expect(plan.warnings.some((w) => w.includes('SIM-lost') && w.includes('not in the plan'))).toBe(true);
    const none = fakeTomTom({ unplaced: ['SIM'] });
    await expect(planRouteTomTom({ stops, day: 'weekday' }, none.deps)).rejects.toThrow("TomTom couldn't place any address");
  });

  it('TomTom geocodes the ADDRESS — a customer’s name (the label) never leaves Arbo', async () => {
    const tt = fakeTomTom();
    await planRouteTomTom({ stops: [{ id: 'x', label: 'SIM-Alder, Test', zip: '23503', city: 'Norfolk', address: '202 Placeholder Way, Norfolk, VA 23503' }], day: 'weekday' }, tt.deps);
    expect(tt.geocoded).toEqual(['202 Placeholder Way, Norfolk, VA 23503']);
  });
});

describe('planRouteBest — the engine order, and the plan names its engine', () => {
  const stops = [S('a', '23451', 'Virginia Beach'), S('b', '23503', 'Norfolk')];
  const googleOk = { apiKey: 'g-key', fetchMatrix: async () => [[0, 5, 9], [5, 0, 7], [9, 7, 0]] };
  const googleNone = { apiKey: null, fetchMatrix: async () => { throw new Error('never'); } };

  it('TomTom set and answering: TomTom plans it', async () => {
    const tt = fakeTomTom();
    const plan = await planRouteBest({ stops, day: 'weekday', startZip: '23452' }, { tomtom: tt.deps, google: googleOk });
    expect(plan.engine).toBe('tomtom');
    expect(plan.mode).toBe('tomtom_traffic');
    expect(plan.tomtom).toEqual({ state: 'used', line: null });
    expect(plan.driveMinutes).toBe(10);
  });

  it('no TomTom key: Google (R16) as before, and TomTom is NAMED as not set up — never a silent fallback', async () => {
    const plan = await planRouteBest({ stops, day: 'weekday', startZip: '23452' }, { tomtom: null, google: googleOk });
    expect(plan.engine).toBe('google');
    expect(plan.mode).toBe('live_traffic');
    expect(plan.tomtom).toEqual({ state: 'not_set', line: 'TomTom not set up — add TOMTOM_API_KEY in Railway.' });
    expect(plan.note).toContain('Google Maps');
    const zip = await planRouteBest({ stops, day: 'weekday' }, { tomtom: null, google: googleNone });
    expect(zip.engine).toBe('zip');
    expect(zip.mode).toBe('zip_estimate');
    expect(zip.note).toContain('Not a mapped route');
    expect(zip.driveMinutes).toBe(25); // 23451 → 23503: across prefixes
  });

  it('TomTom set but failing: Google, then ZIP — the failure named by a fixed code, never its raw text or the key', async () => {
    const leaky = fakeTomTom({ fail: new Error('GET https://api.tomtom.com/search/2/geocode/x.json?key=tt-secret-key failed') });
    const plan = await planRouteBest({ stops, day: 'weekday', startZip: '23452' }, { tomtom: leaky.deps, google: googleOk });
    expect(plan.engine).toBe('google');
    expect(plan.tomtom.state).toBe('failed');
    expect(plan.tomtom.line).toBe("TomTom couldn't plan it (TomTom error) — planned by Google Maps instead.");
    expect(JSON.stringify(plan)).not.toContain('tt-secret-key');
    expect(JSON.stringify(plan)).not.toContain('api.tomtom.com');
    const named = fakeTomTom({ fail: new Error('TomTom HTTP 403') });
    const zip = await planRouteBest({ stops, day: 'weekday' }, { tomtom: named.deps, google: googleNone });
    expect(zip.engine).toBe('zip');
    // R35 review: a refused key also says where to fix it.
    expect(zip.tomtom.line).toBe("TomTom couldn't plan it (TomTom HTTP 403) — these are ZIP estimates. Check TOMTOM_API_KEY in Railway, and that the key is switched on for Search and Routing.");
  });

  it('no stops: the ZIP planner’s honest empty plan, and nothing is asked of TomTom', async () => {
    const tt = fakeTomTom();
    const plan = await planRouteBest({ stops: [], day: 'weekday' }, { tomtom: tt.deps, google: googleOk });
    expect(plan.warnings).toContain('No stops to plan.');
    expect(tt.geocoded).toEqual([]);
  });
});

describe('the Google path (R16) keeps its pins and loses its leaks', () => {
  it('a failure note carries a known code only — a raw error text (with a URL or key) never reaches the phone', async () => {
    const stops = [S('a', '23451', 'Virginia Beach'), S('b', '23455', 'Virginia Beach')];
    const plan = await planRouteLive({ stops, day: 'weekday' }, { apiKey: 'k', fetchMatrix: async () => { throw new Error('fetch failed https://x.example/?key=g-secret'); } });
    expect(plan.note).toContain('Maps call failed');
    expect(plan.note).not.toContain('g-secret');
    expect(plan.note).not.toContain('https://');
    const known = await planRouteLive({ stops, day: 'weekday' }, { apiKey: 'k', fetchMatrix: async () => { throw new Error('routes matrix: incomplete'); } });
    expect(known.note).toContain('Maps call failed (routes matrix: incomplete)');
  });

  it('Google gets the stop’s address when it has one — not its label', async () => {
    const seen: string[][] = [];
    await planRouteLive(
      { stops: [{ id: 'x', label: 'SIM-Alder, Test', zip: '23503', city: 'Norfolk', address: '202 Placeholder Way, Norfolk, VA 23503' }, S('y', '23505', 'Norfolk')], day: 'weekday' },
      { apiKey: 'k', fetchMatrix: async (addrs) => { seen.push(addrs); return [[0, 5], [5, 0]]; } },
    );
    expect(seen[0]).toEqual(['202 Placeholder Way, Norfolk, VA 23503', 'y SIM Row, Norfolk, VA 23505']);
    expect(seen[0]!.join(' ')).not.toContain('SIM-Alder');
  });

  it('visits carry the stop id through every engine, so the day’s list can match them back', async () => {
    const plan = await planRouteLive({ stops: [S('a', '23503', 'Norfolk')], day: 'weekday' }, { apiKey: null, fetchMatrix: async () => [] });
    expect(plan.visits[0]!.id).toBe('a');
  });
});

describe('ET day helpers (the server runs on UTC)', () => {
  it('the weekday is Hampton Roads’, not the server’s', () => {
    // 02:00 UTC Sunday = 22:00 ET Saturday.
    expect(etWeekday(new Date('2026-10-25T02:00:00Z'))).toBe('Sat');
    expect(etWeekday(new Date('2026-10-25T16:00:00Z'))).toBe('Sun');
    expect(etWeekday(new Date('2026-10-21T03:30:00Z'))).toBe('Tue');
  });

  it('a clock time on an ET day is the right instant, and prints as RFC 3339 with the ET offset', () => {
    const at = etInstant('2026-10-21', 16 * 60);
    expect(at.toISOString()).toBe('2026-10-21T20:00:00.000Z'); // EDT, UTC-4
    expect(etRfc3339(at)).toBe('2026-10-21T16:00:00-04:00');
    const winter = etInstant('2026-12-05', 8 * 60);
    expect(winter.toISOString()).toBe('2026-12-05T13:00:00.000Z'); // EST, UTC-5
    expect(etRfc3339(winter)).toBe('2026-12-05T08:00:00-05:00');
    expect(etHourMinute(new Date('2026-10-21T20:05:00Z'))).toBe('16:05');
    expect(etHourMinute(new Date('2026-10-21T04:00:00Z'))).toBe('00:00');
  });
});

describe('integration status', () => {
  it('names TomTom as a yes/no, never its key', () => {
    const s = integrationStatus();
    expect(s).toHaveProperty('tomtom');
    expect(typeof s.tomtom).toBe('boolean');
  });
});
