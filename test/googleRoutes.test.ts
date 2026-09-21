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
import { fetchDriveMinutesMatrix } from '../src/integrations/googleRoutes.js';
import { planRouteLive } from '../src/ops/routePlanner.js';

// R16 live traffic. Two laws: the matrix client asks for traffic-aware
// routes and refuses an incomplete answer, and the planner NEVER labels a
// fallback as live (§1B).

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
  return { fn, calls };
}

const el = (o: number, d: number, secs: number) => ({ originIndex: o, destinationIndex: d, duration: `${secs}s` });

describe('fetchDriveMinutesMatrix', () => {
  it('requests TRAFFIC_AWARE with the field mask and parses minutes', async () => {
    const { fn, calls } = fakeFetch([el(0, 1, 600), el(1, 0, 720), el(0, 0, 0), el(1, 1, 0)]);
    const m = await fetchDriveMinutesMatrix(['A, VA 23451', 'B, VA 23503'], 'key-1', fn);
    expect(m[0]![1]).toBe(10);
    expect(m[1]![0]).toBe(12);
    const init = calls[0]!.init;
    expect(init.headers['X-Goog-Api-Key']).toBe('key-1');
    expect(init.headers['X-Goog-FieldMask']).toContain('duration');
    expect(JSON.parse(init.body).routingPreference).toBe('TRAFFIC_AWARE');
  });

  it('throws on HTTP error and on an incomplete matrix — holes are failures, not zeros', async () => {
    const bad = fakeFetch({}, 403);
    await expect(fetchDriveMinutesMatrix(['A', 'B'], 'k', bad.fn)).rejects.toThrow(/HTTP 403/);
    const holes = fakeFetch([el(0, 1, 600)]); // missing 1→0
    await expect(fetchDriveMinutesMatrix(['A', 'B'], 'k', holes.fn)).rejects.toThrow(/incomplete/);
  });
});

describe('planRouteLive — mode honesty', () => {
  const stops = [
    { label: '1 Synthetic Ave', zip: '23451', city: 'Virginia Beach' },
    { label: '2 Sample St', zip: '23455', city: 'Virginia Beach' },
  ];

  it('no key → zip_estimate, and the note says live traffic is OFF', async () => {
    const plan = await planRouteLive({ stops, day: 'weekday' }, { apiKey: null, fetchMatrix: async () => { throw new Error('never'); } });
    expect(plan.mode).toBe('zip_estimate');
    expect(plan.note).toContain('no Google Maps key');
  });

  it('a failing Maps call degrades LOUDLY to zip_estimate with the failure named', async () => {
    const plan = await planRouteLive({ stops, day: 'weekday' }, { apiKey: 'k', fetchMatrix: async () => { throw new Error('routes matrix HTTP 500'); } });
    expect(plan.mode).toBe('zip_estimate');
    expect(plan.note).toContain('Maps call failed');
    expect(plan.note).toContain('HTTP 500');
  });

  it('with a live matrix, the traffic ordering WINS over zip closeness', async () => {
    // ZIP logic says 23455 is nearest the 23452 anchor; live traffic says the
    // 23503 stop is minutes away and 23455 is across a jammed bridge.
    const trafficStops = [
      { label: 'zip-near', zip: '23455', city: 'Virginia Beach' },
      { label: 'traffic-near', zip: '23503', city: 'Norfolk' },
    ];
    // points: [anchor, zip-near, traffic-near]
    const matrix = [
      [0, 45, 5],
      [45, 0, 40],
      [5, 40, 0],
    ];
    const plan = await planRouteLive(
      { stops: trafficStops, day: 'weekday', startZip: '23452' },
      { apiKey: 'k', fetchMatrix: async () => matrix },
    );
    expect(plan.mode).toBe('live_traffic');
    expect(plan.visits.map((v) => v.label)).toEqual(['traffic-near', 'zip-near']);
    // First visit starts AT the window (drive-in happens before 4, same as
    // the ZIP planner); the gap BETWEEN stops is the matrix value, no heuristic.
    expect(plan.visits[0]!.endTime).toBe('16:20');
    expect(plan.visits[1]!.startTime).toBe('17:00'); // 16:20 + 40 traffic minutes
  });
});
