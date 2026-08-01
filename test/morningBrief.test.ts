import { describe, it, expect } from 'vitest';
import { buildMorningBrief, type StopInput } from '../src/ops/morningBrief.js';

const D = '2026-08-03'; // Monday
const at = (h: number, m = 0) => `${D}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`;

const day: StopInput[] = [
  { id: 'e1', kind: 'estimate', timeIso: at(13, 0), name: 'Kathy Arnett', address: '12 Holly Rd', city: 'Virginia Beach', zip: '23464', source: 'WEB', isFirstTimer: true },
  { id: 'e2', kind: 'estimate', timeIso: at(15, 0), name: 'Ray Diaz', address: '9 Bay Ct', city: 'Norfolk', zip: '23505', source: 'GG', isFirstTimer: false },
  { id: 'e3', kind: 'estimate', timeIso: at(13, 30), name: 'Sam Lee', address: '44 Pine St', city: 'Virginia Beach', zip: '23464', source: 'REFERAL', isFirstTimer: false, nearPowerLines: true },
  { id: 'j1', kind: 'job', timeIso: at(8, 0), name: 'Henderson', address: '3 Oakcrest Dr', city: 'Chesapeake', zip: '23320', isFirstTimer: false, scope: 'Oak removal + stump' },
];

describe('morning brief (§5A #25) — one glance, know the day', () => {
  it('puts the crew job first, then estimates ZIP-by-ZIP', () => {
    const brief = buildMorningBrief(day);
    const ids = brief.stops.map((s) => s.id);
    expect(ids[0]).toBe('j1'); // morning job leads
    // both 23464 estimates run back-to-back before Norfolk (work the ZIP dry)
    expect(ids.indexOf('e3')).toBe(ids.indexOf('e1') + 1);
    expect(ids.indexOf('e2')).toBeGreaterThan(ids.indexOf('e3'));
    expect(brief.summary.zipRun).toEqual(['23464', '23505']);
  });

  it('tags first-timers vs repeats and carries source tags', () => {
    const brief = buildMorningBrief(day);
    const kathy = brief.stops.find((s) => s.id === 'e1')!;
    expect(kathy.tags).toContain('FIRST-TIMER');
    expect(kathy.tags).toContain('WEB');
    const ray = brief.stops.find((s) => s.id === 'e2')!;
    expect(ray.tags).toContain('REPEAT');
  });

  it('surfaces power-line red flags', () => {
    const brief = buildMorningBrief(day);
    const sam = brief.stops.find((s) => s.id === 'e3')!;
    expect(sam.redFlags).toContain('POWER LINES');
    expect(brief.summary.redFlagCount).toBe(1);
  });

  it('an emergency jumps to the top of the day', () => {
    const withEmergency: StopInput[] = [
      ...day,
      { id: 'x1', kind: 'job', name: 'Tran', address: '7 Elm Ave', city: 'Portsmouth', zip: '23704', isEmergency: true, scope: 'Tree on garage' },
    ];
    const brief = buildMorningBrief(withEmergency);
    expect(brief.stops[0]!.id).toBe('x1');
    expect(brief.stops[0]!.redFlags).toContain('EMERGENCY');
    expect(brief.summary.emergencies).toBe(1);
  });

  it('is deterministic — same day in, same route out', () => {
    expect(buildMorningBrief(day)).toEqual(buildMorningBrief(day));
  });
});
