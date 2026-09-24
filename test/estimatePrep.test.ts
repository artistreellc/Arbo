// The estimate prep pack (Mike, 2026-09-24): permit screen + drive heuristic
// + Miss Utility + access notes. Every unfillable section NAMED (§1B), the
// permit vocabulary is the law's, and nothing here prices or books anything.
import { describe, it, expect, afterEach } from 'vitest';
import { buildEstimatePrep, MISS_UTILITY_LINE } from '../src/ops/estimatePrep.js';
import type { GisProvider } from '../src/permitting/screening.js';
import { setTodayWorkZip, getTodayWorkZip } from '../src/reception/routingHint.js';
import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import { buildReceptionistSystemPrompt } from '../src/reception/systemPrompt.js';
import { readFileSync } from 'node:fs';

const NOW = new Date('2026-09-24T15:00:00Z');
const gisEmpty: GisProvider = { overlaysFor: async () => [] };
const gisRpa: GisProvider = {
  overlaysFor: async () => [
    { kind: 'CBPA_RPA', layer: 'test-layer', meaning: 'Inside the protected Bay buffer — removals need city paperwork.' },
  ],
};

const base = { address: '123 Synthetic Ave', city: 'Virginia Beach' };

afterEach(() => setTodayWorkZip(null));

describe('buildEstimatePrep — permit section', () => {
  it('no GIS: the screen is NAMED as not run, never quietly skipped', async () => {
    const s = await buildEstimatePrep({ ...base, jobType: 'removal' }, null, NOW);
    expect(s.permit.ran).toBe(false);
    if (!s.permit.ran) expect(s.permit.reason).toContain('NOT run');
  });

  it('clean screen still says VERIFY — never clear', async () => {
    const s = await buildEstimatePrep({ ...base, jobType: 'removal' }, gisEmpty, NOW);
    expect(s.permit.ran).toBe(true);
    if (s.permit.ran) {
      expect(s.permit.status).toBe('NO_OVERLAY_VERIFY');
      expect(s.permit.headline.toLowerCase()).toContain('verify');
      expect(s.permit.headline.toLowerCase()).not.toMatch(/you'?re clear|no permit needed/);
    }
  });

  it('an RPA removal screens PERMIT_LIKELY and carries the mitigation note', async () => {
    const s = await buildEstimatePrep({ ...base, jobType: 'removal', treeCount: 2 }, gisRpa, NOW);
    expect(s.permit.ran).toBe(true);
    if (s.permit.ran) {
      expect(s.permit.status).toBe('PERMIT_LIKELY');
      expect(s.permit.overlays[0]!.meaning).toContain('buffer');
      expect(s.permit.mitigation).toBeTruthy();
    }
  });

  it('a GIS failure degrades honestly — failed, not "no overlay"', async () => {
    const boom: GisProvider = { overlaysFor: async () => { throw new Error('layer 500'); } };
    const s = await buildEstimatePrep({ ...base, jobType: 'removal' }, boom, NOW);
    expect(s.permit.ran).toBe(false);
    if (!s.permit.ran) expect(s.permit.reason).toContain('failed');
  });

  it('an unknown city is flagged, not silently binned', async () => {
    const s = await buildEstimatePrep({ address: '1 Elm', city: 'Suffolk', jobType: 'removal' }, gisEmpty, NOW);
    expect(s.city).toBeNull();
    expect(s.permit.ran).toBe(false);
    expect(s.cityNote).toContain('Suffolk');
  });
});

describe('buildEstimatePrep — drive, Miss Utility, access', () => {
  it('drive: no work ZIP set → the reason, not a number', async () => {
    const s = await buildEstimatePrep({ ...base, zip: '23452' }, gisEmpty, NOW);
    expect(s.drive.fromZip).toBeNull();
    if (s.drive.fromZip === null) expect(s.drive.reason).toContain('work ZIP');
  });

  it('drive: same ZIP 10, same prefix 15, cross-prefix 25 — labeled zip_estimate', async () => {
    setTodayWorkZip('23452');
    expect(getTodayWorkZip()).toBe('23452');
    const same = await buildEstimatePrep({ ...base, zip: '23452' }, gisEmpty, NOW);
    const near = await buildEstimatePrep({ ...base, zip: '23455' }, gisEmpty, NOW);
    const far = await buildEstimatePrep({ ...base, city: 'Norfolk', zip: '23510' }, gisEmpty, NOW);
    for (const [s, min] of [[same, 10], [near, 15], [far, 25]] as const) {
      expect(s.drive.fromZip).toBe('23452');
      if (s.drive.fromZip) {
        expect(s.drive.minutes).toBe(min);
        expect(s.drive.mode).toBe('zip_estimate');
      }
    }
  });

  it('drive: property ZIP missing → unknown, not zero', async () => {
    setTodayWorkZip('23452');
    const s = await buildEstimatePrep(base, gisEmpty, NOW);
    if (s.drive.fromZip === null) expect(s.drive.reason).toContain('unknown, not zero');
  });

  it('Miss Utility flags removal, stump, and land clearing — not pruning', async () => {
    for (const jobType of ['removal', 'stump', 'land_clearing'] as const) {
      const s = await buildEstimatePrep({ ...base, jobType }, gisEmpty, NOW);
      expect(s.missUtility.flagged, jobType).toBe(true);
      expect(s.missUtility.note).toBe(MISS_UTILITY_LINE);
    }
    const prune = await buildEstimatePrep({ ...base, jobType: 'pruning' }, gisEmpty, NOW);
    expect(prune.missUtility.flagged).toBe(false);
  });

  it("access notes are echoed as the caller's words; absence says to ask", async () => {
    const s = await buildEstimatePrep({ ...base, accessNotes: '  gate is 4 ft, dog in yard ' }, gisEmpty, NOW);
    expect(s.access.notes).toBe('gate is 4 ft, dog in yard');
    const none = await buildEstimatePrep(base, gisEmpty, NOW);
    expect(none.access.notes).toBeNull();
    expect(none.access.note).toContain('Worth asking');
  });
});

describe('the two new call questions (Mike, 2026-09-24)', () => {
  const prompt = buildReceptionistSystemPrompt(loadGuardrails(), loadLegal());

  it('removals now ask about Miss Utility marking', () => {
    expect(prompt).toContain('Ask if the property has been marked');
    expect(prompt).toContain('Miss Utility');
  });

  it('removals and pruning ask the one access question', () => {
    const hits = prompt.match(/fenced backyard or a tight gate/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('guardrails version bumped for the change', () => {
    expect(loadGuardrails().version).toBe('2026-09-24');
  });
});

describe('Book-tab prep panel (source pins)', () => {
  const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');

  it('renders ABOVE the properties fetch — the links-cut early return must not hide it', () => {
    const panel = html.indexOf('v.appendChild(estimatePrepPanel())');
    const fetch = html.indexOf("data = await api('/api/properties')");
    expect(panel).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(fetch);
  });

  it('carries the no-price no-booking line and the honest failure line', () => {
    expect(html).toContain('Never a price, never a booking.');
    expect(html).toContain('nothing was screened');
  });
});
