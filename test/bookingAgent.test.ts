import { describe, it, expect } from 'vitest';
import { findBookingIssues } from '../src/agents/bookingAgent.js';

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
