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
