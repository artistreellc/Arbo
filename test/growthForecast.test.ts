import { describe, it, expect } from 'vitest';
import {
  buildDueProperties,
  buildGrowthOutreach,
  forecastTree,
  type GrowthTarget,
  type TreeRecord,
} from '../src/ops/growthForecast.js';
import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import { guardReply } from '../src/reception/outputGuard.js';
import { createApi, type DataSource } from '../src/server/api.js';

const legal = loadLegal();
const NOW = new Date('2026-08-01T19:00:00Z'); // Sat 3 PM EDT — inside quiet hours

const tree = (over: Partial<TreeRecord> = {}): TreeRecord => ({
  id: 't1',
  species: 'Leyland cypress',
  size: '20 ft row',
  lastServiceIso: '2025-02-01',
  ...over,
});

describe('forecastTree — general cycles, honest inputs (§6)', () => {
  it('the brief case: leylands trimmed ~18 months ago are due right about now', () => {
    const f = forecastTree(tree(), NOW)!; // Feb 2025 → Aug 2026 ≈ 18 mo, window 12–18
    expect(f.state).toBe('due');
    expect(f.cycleLabel).toBe('hedge/screen trim');
    expect(f.monthsSinceService).toBe(17);
  });

  it('species routing: leyland is a hedge, plain cypress is an evergreen; unknown gets the default', () => {
    expect(forecastTree(tree({ species: 'Bald cypress' }), NOW)!.cycleLabel).toBe('evergreen check');
    expect(forecastTree(tree({ species: 'Crape Myrtle' }), NOW)!.cycleLabel).toBe('late-winter prune');
    expect(forecastTree(tree({ species: null }), NOW)!.cycleLabel).toBe('general maintenance check');
  });

  it('no service history → no forecast, ever (the twin never invents dates)', () => {
    expect(forecastTree(tree({ lastServiceIso: null }), NOW)).toBeNull();
    expect(forecastTree(tree({ lastServiceIso: 'garbage' }), NOW)).toBeNull();
  });

  it('states walk not_yet → upcoming → due → overdue as time passes', () => {
    const t = tree({ lastServiceIso: '2026-01-01' }); // 12–18 mo window
    expect(forecastTree(t, new Date('2026-08-01T00:00:00Z'))!.state).toBe('not_yet');
    expect(forecastTree(t, new Date('2026-11-15T00:00:00Z'))!.state).toBe('upcoming'); // ~10.5 mo, inside 2-mo runway
    expect(forecastTree(t, new Date('2027-02-15T00:00:00Z'))!.state).toBe('due');
    expect(forecastTree(t, new Date('2027-08-15T00:00:00Z'))!.state).toBe('overdue');
  });
});

const target = (over: Partial<GrowthTarget> = {}): GrowthTarget => ({
  propertyId: 'p1',
  address: '742 Evergreen Terrace',
  city: 'Virginia Beach',
  contactId: 'c1',
  name: 'Henderson',
  consentOnFile: true,
  trees: [tree()],
  ...over,
});

describe('buildDueProperties + outreach gates (§6 + §4)', () => {
  it('aggregates per property, worst state first, with a warm no-diagnosis note', () => {
    const due = buildDueProperties(
      [
        target(),
        target({ propertyId: 'p2', trees: [tree({ id: 't2', lastServiceIso: '2024-01-01' })] }), // overdue
        target({ propertyId: 'p3', trees: [tree({ id: 't3', lastServiceIso: '2026-07-01' })] }), // not yet
      ],
      NOW,
    );
    expect(due.map((d) => d.propertyId)).toEqual(['p2', 'p1']);
    expect(due[1]!.note).toContain('Leyland cypress');
    expect(due[1]!.note).toContain('never a diagnosis');
    expect(guardReply(due[1]!.note, loadGuardrails()).safe).toBe(true);
  });

  it('outreach: consent gate + STOP gate hold; no contact on file → shown but never reached out to', () => {
    const q = buildGrowthOutreach(
      legal,
      [
        target(),
        target({ propertyId: 'p2', contactId: 'c2', consentOnFile: false }),
        target({ propertyId: 'p3', contactId: 'c3', suppressed: true }),
        target({ propertyId: 'p4', contactId: null }),
      ],
      NOW,
    );
    expect(q.due).toHaveLength(1);
    expect(q.due[0]).toMatchObject({ type: 'growth_outreach', targetId: 'c1', recommendOnly: true });
    expect(q.suppressed.map((s) => s.reason).sort()).toEqual(['no_consent', 'stop_suppressed']);
  });
});

describe('API: /api/forecast + the follow-ups merge', () => {
  const base: DataSource = { ready: () => true, stopsBetween: async () => [], newLeads: async () => [] };

  it('forecast returns due properties and writes next_due_forecast back to the twin', async () => {
    const saved: Array<[string, string]> = [];
    const api = createApi({
      ...base,
      growthTargets: async () => [target()],
      saveTreeForecast: async (id, due) => void saved.push([id, due]),
    });
    const out = await api.forecast(NOW);
    const body = out.body as { due: Array<{ propertyId: string }>; basis: string };
    expect(body.due).toHaveLength(1);
    expect(body.basis).toContain('never a diagnosis');
    expect(saved).toEqual([['t1', '2026-02-01']]); // 12 mo after Feb 2025 service
  });

  it('growth nudges join the follow-up queue; a dead twin read flags growthUnavailable', async () => {
    const api = createApi({
      ...base,
      followUpInputs: async () => ({ estimates: [], jobs: [] }),
      growthTargets: async () => [target()],
    });
    const body = (await api.followUps()).body as { due: Array<{ type: string }>; growthUnavailable: boolean };
    expect(body.due.some((d) => d.type === 'growth_outreach')).toBe(true);
    expect(body.growthUnavailable).toBe(false);

    const dead = createApi({
      ...base,
      followUpInputs: async () => ({ estimates: [], jobs: [] }),
      growthTargets: async () => { throw new Error('twin offline'); },
    });
    const deadBody = (await dead.followUps()).body as { due: unknown[]; growthUnavailable: boolean };
    expect(deadBody.growthUnavailable).toBe(true);
    expect(deadBody.due).toHaveLength(0);
  });
});
