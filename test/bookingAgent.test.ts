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
import { findBookingIssues, etTomorrowWindow } from '../src/agents/bookingAgent.js';

const DAY = '2026-08-05';
const at = (h: number, m = 0) => `2026-08-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

describe('Booking agent (#2) — recommends, never moves anything', () => {
  it('flags two stops booked into the same slot', () => {
    const issues = findBookingIssues([
      { id: 'a', timeIso: at(14), zip: '23451' },
      { id: 'b', timeIso: at(14), zip: '23451' },
    ], DAY);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('double_booked');
    expect(issues[0]!.stopIds.sort()).toEqual(['a', 'b']);
  });

  it('a clean single-ZIP day raises nothing', () => {
    const issues = findBookingIssues([
      { id: 'a', timeIso: at(9), zip: '23451' },
      { id: 'b', timeIso: at(11), zip: '23451' },
      { id: 'c', timeIso: at(14), zip: '23451' },
    ], DAY);
    expect(issues).toHaveLength(0);
  });

  it('two ZIPs worked in sequence is fine — the run stays dry', () => {
    const issues = findBookingIssues([
      { id: 'a', timeIso: at(9), zip: '23451' },
      { id: 'b', timeIso: at(10), zip: '23451' },
      { id: 'c', timeIso: at(13), zip: '23503' },
      { id: 'd', timeIso: at(15), zip: '23503' },
    ], DAY);
    expect(issues).toHaveLength(0);
  });

  it('flags a route that leaves a ZIP and comes back (§3.11)', () => {
    const issues = findBookingIssues([
      { id: 'a', timeIso: at(9), zip: '23451' },
      { id: 'b', timeIso: at(11), zip: '23503' },
      { id: 'c', timeIso: at(14), zip: '23451' },
    ], DAY);
    expect(issues.some((i) => i.kind === 'zip_run_break')).toBe(true);
  });

  it('never invents an issue from missing times or ZIPs', () => {
    const issues = findBookingIssues([
      { id: 'a', timeIso: null, zip: '23451' },
      { id: 'b', timeIso: at(10), zip: null },
      { id: 'c', timeIso: null, zip: null },
    ], DAY);
    expect(issues).toHaveLength(0);
  });

  it('issue keys are stable across runs (dedupe contract)', () => {
    const stops = [
      { id: 'a', timeIso: at(14), zip: '23451' },
      { id: 'b', timeIso: at(14), zip: '23451' },
    ];
    const first = findBookingIssues(stops, DAY);
    const second = findBookingIssues([...stops].reverse(), DAY);
    expect(first[0]!.key).toBe(second[0]!.key);
  });

  it('never emits a dollar figure in an issue line', () => {
    const issues = findBookingIssues([
      { id: 'a', timeIso: at(14), zip: '23451' },
      { id: 'b', timeIso: at(14), zip: '23451' },
      { id: 'c', timeIso: at(16), zip: '23503' },
      { id: 'd', timeIso: at(17), zip: '23451' },
    ], DAY);
    for (const i of issues) expect(i.line).not.toMatch(/\$\s?\d/);
  });
});

describe('ET tomorrow window — the server runs UTC, the business runs Hampton Roads', () => {
  it('an 8pm-ET tick still audits TOMORROW in ET, not the day after', () => {
    // 2026-08-03T01:30Z is Aug 2, 9:30pm ET (EDT, UTC-4).
    const { dayLabel, startUtc, endUtc } = etTomorrowWindow(new Date('2026-08-03T01:30:00Z'));
    expect(dayLabel).toBe('2026-08-03');
    expect(startUtc.toISOString()).toBe('2026-08-03T04:00:00.000Z'); // ET midnight
    expect(endUtc.toISOString()).toBe('2026-08-04T04:00:00.000Z');
  });

  it('a mid-morning tick lands on the same tomorrow', () => {
    const { dayLabel } = etTomorrowWindow(new Date('2026-08-02T14:00:00Z')); // 10am ET
    expect(dayLabel).toBe('2026-08-03');
  });

  it('the window is exactly one ET day and covers a 9pm-ET stop', () => {
    const { startUtc, endUtc } = etTomorrowWindow(new Date('2026-08-02T14:00:00Z'));
    expect(endUtc.getTime() - startUtc.getTime()).toBe(86400_000);
    const ninePmEt = Date.parse('2026-08-04T01:00:00Z'); // Aug 3, 9pm ET
    expect(ninePmEt).toBeGreaterThanOrEqual(startUtc.getTime());
    expect(ninePmEt).toBeLessThan(endUtc.getTime());
  });

  it('holds across the standard-time boundary (EST, UTC-5)', () => {
    const { dayLabel, startUtc } = etTomorrowWindow(new Date('2026-01-15T02:00:00Z')); // Jan 14, 9pm ET
    expect(dayLabel).toBe('2026-01-15');
    expect(startUtc.toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });
});

describe('ZIP-break reporting — one unfixed break can never mask another', () => {
  it('raises every ZIP the route leaves and returns to', () => {
    const issues = findBookingIssues([
      { id: 'a', timeIso: at(8), zip: '23451' },
      { id: 'b', timeIso: at(9), zip: '23503' },
      { id: 'c', timeIso: at(10), zip: '23451' },
      { id: 'd', timeIso: at(11), zip: '23508' },
      { id: 'e', timeIso: at(12), zip: '23503' },
    ], DAY);
    const zips = issues.filter((i) => i.kind === 'zip_run_break').map((i) => i.key);
    expect(zips.some((k) => k.includes('23451'))).toBe(true);
    expect(zips.some((k) => k.includes('23503'))).toBe(true);
  });

  it('the break key carries its stop set, so a re-introduced break is new', () => {
    const first = findBookingIssues([
      { id: 'a', timeIso: at(8), zip: '23451' },
      { id: 'b', timeIso: at(9), zip: '23503' },
      { id: 'c', timeIso: at(10), zip: '23451' },
    ], DAY).find((i) => i.kind === 'zip_run_break')!;
    const reintroduced = findBookingIssues([
      { id: 'a', timeIso: at(8), zip: '23451' },
      { id: 'b', timeIso: at(9), zip: '23503' },
      { id: 'z', timeIso: at(10), zip: '23451' }, // different stop caused it this time
    ], DAY).find((i) => i.kind === 'zip_run_break')!;
    expect(first.key).not.toBe(reintroduced.key);
  });

  it('slot times in issue lines read in ET, matching the Morning Brief', () => {
    const issues = findBookingIssues([
      { id: 'a', timeIso: '2026-08-05T18:00:00Z', zip: '23451' }, // 2:00 PM ET
      { id: 'b', timeIso: '2026-08-05T18:00:00Z', zip: '23451' },
    ], DAY);
    expect(issues[0]!.line).toContain('2:00 PM');
    expect(issues[0]!.line).not.toContain('6:00 PM');
  });
});
