/*
  SLOW::ARBO — see src/portal/propertyFlags.ts for the full marker.

  These tests exist because of the recurring defect in this codebase:
  tests that exercise a path the app never takes. So every case here is
  built from the shape the app ACTUALLY passes — a permit row's
  overlay_source (an OverlayHit[]) plus its created_at — and not from a
  convenient fixture invented to make an assertion pass.
*/
import { describe, it, expect } from 'vitest';

import {
  propertyOverlayFlags,
  treeOwnershipFlag,
  assertFlagsNeverClear,
  type RecordedScreen,
  type PropertyFlag,
} from '../src/portal/propertyFlags.js';
import type { OverlayHit } from '../src/permitting/screening.js';

const CBPA: OverlayHit = { kind: 'CBPA_RPA', layer: 'DEQ RPA layer 33', meaning: 'In the Bay buffer.' };
const PROX: OverlayHit = { kind: 'CBPA_RPA_PROXIMITY', layer: 'DEQ RPA 300 m probe', meaning: 'Parcel may reach the buffer.' };
const FLOOD: OverlayHit = { kind: 'FEMA_FLOOD', layer: 'SFHA zone AE', meaning: 'High-risk flood zone.' };
const CRO: OverlayHit = { kind: 'NORFOLK_CRO', layer: 'Norfolk CRO', meaning: 'Coastal resilience overlay.' };
const RESERVOIR: OverlayHit = { kind: 'RESERVOIR_WATERSHED', layer: 'Norfolk reservoir watershed', meaning: 'Water-supply watershed.' };

const screen = (overlays: OverlayHit[]): RecordedScreen => ({ ranAt: '2026-07-01', overlays });
const byKey = (flags: PropertyFlag[], key: PropertyFlag['key']): PropertyFlag =>
  flags.find((f) => f.key === key)!;

describe('portal property flags — the three states (§1B)', () => {
  it('names an unscreened property as unknown, never as a no', () => {
    const flags = propertyOverlayFlags(null);
    expect(byKey(flags, 'cbpa').state).toBe('unknown');
    expect(byKey(flags, 'flood').state).toBe('unknown');
    // The failure this whole module prevents: an unscreened property reading
    // to a homeowner as "you are not in the CBPA".
    expect(byKey(flags, 'cbpa').line).toMatch(/not screened/i);
    // It does not merely avoid saying "no" — it tells the reader outright not
    // to read it as one.
    expect(byKey(flags, 'cbpa').line).toMatch(/unknown rather than as a no/i);
  });

  it('a screen that ran and found nothing is not_found_verify, and says so', () => {
    const flags = propertyOverlayFlags(screen([]));
    const cbpa = byKey(flags, 'cbpa');
    expect(cbpa.state).toBe('not_found_verify');
    expect(cbpa.line).toMatch(/not a clearance/i);
    expect(cbpa.line).toMatch(/verif/i);
    // The date the screen ran is on the line — a two-year-old screen is a
    // different fact from a fresh one.
    expect(cbpa.line).toContain('2026-07-01');
  });

  it('unknown and not_found_verify never render the same line', () => {
    const unscreened = byKey(propertyOverlayFlags(null), 'flood');
    const screenedClean = byKey(propertyOverlayFlags(screen([])), 'flood');
    expect(unscreened.state).not.toBe(screenedClean.state);
    expect(unscreened.line).not.toBe(screenedClean.line);
  });

  it('reports a direct CBPA hit and a proximity hit as present', () => {
    expect(byKey(propertyOverlayFlags(screen([CBPA])), 'cbpa').state).toBe('present');
    // D37: the proximity probe is what caught the real 8562 Circle Drive
    // case. If it did not count as present here, the portal would tell that
    // homeowner nothing was found.
    expect(byKey(propertyOverlayFlags(screen([PROX])), 'cbpa').state).toBe('present');
  });

  it('counts FEMA, local floodplain and the Norfolk CRO as flood findings', () => {
    expect(byKey(propertyOverlayFlags(screen([FLOOD])), 'flood').state).toBe('present');
    expect(byKey(propertyOverlayFlags(screen([CRO])), 'flood').state).toBe('present');
  });

  it('a flood hit does not turn into a CBPA hit, or the reverse', () => {
    const floodOnly = propertyOverlayFlags(screen([FLOOD]));
    expect(byKey(floodOnly, 'flood').state).toBe('present');
    expect(byKey(floodOnly, 'cbpa').state).toBe('not_found_verify');
  });
});

describe('reservoir edge — the flag with no map behind it', () => {
  it('stays unknown even after a clean screen, because nothing screened for it', () => {
    // This is the asymmetry that matters. A clean screen makes CBPA
    // not_found_verify, but it must NOT do the same to the reservoir: no city
    // in layers.ts has a RESERVOIR_WATERSHED layer, so the screen never
    // looked, and saying "we looked and found nothing" would be a lie.
    const flags = propertyOverlayFlags(screen([]));
    expect(byKey(flags, 'cbpa').state).toBe('not_found_verify');
    expect(byKey(flags, 'reservoir').state).toBe('unknown');
    expect(byKey(flags, 'reservoir').line).toMatch(/do not have a reservoir map/i);
  });

  it('a human who looked can answer it either way', () => {
    const yes = propertyOverlayFlags(null, { nearReservoir: true, checkedAt: '2026-07-20' });
    expect(byKey(yes, 'reservoir').state).toBe('present');

    const no = propertyOverlayFlags(null, { nearReservoir: false, checkedAt: '2026-07-20' });
    expect(byKey(no, 'reservoir').state).toBe('not_found_verify');
    expect(byKey(no, 'reservoir').line).toMatch(/one person's read/i);
  });

  it('a bare false with no date is a default, not a finding', () => {
    const flags = propertyOverlayFlags(null, { nearReservoir: false, checkedAt: null });
    expect(byKey(flags, 'reservoir').state).toBe('unknown');
  });

  it('picks up a real overlay hit the day a layer is wired', () => {
    // Nothing can produce this today. The test pins the behaviour so the
    // flag starts telling the truth on its own rather than needing a second
    // change nobody remembers to make.
    const flags = propertyOverlayFlags(screen([RESERVOIR]));
    expect(byKey(flags, 'reservoir').state).toBe('present');
    expect(byKey(flags, 'reservoir').line).toContain('Norfolk reservoir watershed');
  });
});

describe('whose land the tree is on', () => {
  it('a city tree says the city decides', () => {
    const f = treeOwnershipFlag({ onCityProperty: true, checkedAt: '2026-07-02' });
    expect(f.state).toBe('present');
    expect(f.line).toMatch(/city, not the homeowner/i);
  });

  it('undetermined is undetermined — not "it is yours"', () => {
    const f = treeOwnershipFlag({ onCityProperty: null, checkedAt: null });
    expect(f.state).toBe('unknown');
    expect(f.line).toMatch(/nobody has worked out/i);
  });

  it('false with no date is a default nobody stood behind', () => {
    // The exact §1B trap: the column defaults to something, and a reader
    // takes the default for an answer.
    expect(treeOwnershipFlag({ onCityProperty: false, checkedAt: null }).state).toBe('unknown');
    expect(treeOwnershipFlag({ onCityProperty: false, checkedAt: '2026-07-02' }).state).toBe('not_found_verify');
  });
});

describe('no flag can ever read as a clearance (§6B.3)', () => {
  const everyCombination: PropertyFlag[] = [
    ...propertyOverlayFlags(null),
    ...propertyOverlayFlags(screen([])),
    ...propertyOverlayFlags(screen([CBPA, FLOOD, RESERVOIR])),
    ...propertyOverlayFlags(screen([PROX, CRO])),
    ...propertyOverlayFlags(null, { nearReservoir: true, checkedAt: '2026-07-20' }),
    ...propertyOverlayFlags(null, { nearReservoir: false, checkedAt: '2026-07-20' }),
    treeOwnershipFlag({ onCityProperty: true, checkedAt: '2026-07-02' }),
    treeOwnershipFlag({ onCityProperty: false, checkedAt: '2026-07-02' }),
    treeOwnershipFlag({ onCityProperty: false, checkedAt: null }),
    treeOwnershipFlag({ onCityProperty: null, checkedAt: null }),
  ];

  it('passes the structural assertion on every reachable flag', () => {
    expect(() => assertFlagsNeverClear(everyCombination)).not.toThrow();
  });

  it('the assertion actually bites — it is not a no-op', () => {
    expect(() =>
      assertFlagsNeverClear([{ key: 'cbpa', label: 'x', state: 'not_found_verify', line: "You're clear." }]),
    ).toThrow(/forbidden/i);
    // A not-found line that forgets to point at verification is the soft
    // drift this catches.
    expect(() =>
      assertFlagsNeverClear([{ key: 'flood', label: 'x', state: 'not_found_verify', line: 'Nothing found.' }]),
    ).toThrow(/verification/i);
    // An unknown that reads as a no.
    expect(() =>
      assertFlagsNeverClear([{ key: 'flood', label: 'x', state: 'unknown', line: 'No flood zone here.' }]),
    ).toThrow(/name the absence/i);
  });

  it('never says the word "clear" about an overlay in any state', () => {
    for (const f of everyCombination) {
      expect(f.line).not.toMatch(/\ball clear\b|\byou'?re clear\b|\bno permit (needed|required)\b/i);
    }
  });
});
