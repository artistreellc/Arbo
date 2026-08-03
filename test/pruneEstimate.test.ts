/*
  SLOW::ARBO — see src/assessment/pruneEstimate.ts for the full marker.

  Mike's ruling, 2026-08-03: the pruning estimate is part of the RA and is an
  ESTIMATE TOOL — a rough guess at the limbs coming off a neighbour's
  overhanging tree. "the actual prune plan needs to be made be the foreman or
  onwer or isa certified arborist on site."

  Every test here is pointed at one of two failures: a rough guess being
  mistaken for a plan, or an absence being rendered as an answer.
*/
import { describe, it, expect } from 'vitest';

import {
  buildPruneEstimate, summarizeEstimate, assertEstimateIsNotAPlan,
  authorPrunePlan, pruneStanding,
  emptyObservation, logCompleteness,
  emptyCustomerContext, emptyGeoRecord, geoQuality,
  emptyArSession, arSessionStanding,
  newRiskAssessment, raCoverage, raLogLine,
  ESTIMATE_DISCLAIMER, UNREADABLE_LINE,
  type LimbGuess, type PlanAuthor,
} from '../src/assessment/pruneEstimate.js';

const limb = (over: Partial<LimbGuess> = {}): LimbGuess => ({
  id: 'l1', where: 'over the fence, north side, mid-canopy',
  sizeBand: 'medium', overNeighborProperty: true,
  diameterInchesGuess: null, lengthFeetGuess: null, bearing: null,
  attachmentHeightFeetGuess: null, targetsBeneath: null, notes: null, ...over,
});

const estimate = (limbs: LimbGuess[] | null, notReadable?: string) =>
  buildPruneEstimate({
    id: 'e1', treeId: 't1', source: 'camera_ar', capturedAt: '2026-08-03T15:00:00Z',
    limbs, notReadable,
  });

const foreman: PlanAuthor = { id: 'c1', name: 'A. Foreman', role: 'foreman', isaCertificationNumber: null };

describe('the estimate is an estimate, and says so every single time', () => {
  it('carries the disclaimer on a normal read', () => {
    const s = summarizeEstimate(estimate([limb(), limb({ id: 'l2', overNeighborProperty: false })]));
    expect(s.limbCount).toBe(2);
    expect(s.overhangCount).toBe(1);
    expect(s.disclaimer).toBe(ESTIMATE_DISCLAIMER);
    expect(s.disclaimer).toMatch(/NOT a prune plan/);
    expect(s.disclaimer).toMatch(/foreman, the owner, or an ISA certified arborist/);
  });

  it('an unreadable capture reports NULL, never a zero (§1B)', () => {
    // The whole feature's worst failure: the camera cannot make out the tree
    // and the screen shows "0 limbs", which a reader takes as "nothing comes
    // off". null and 0 are different facts.
    const s = summarizeEstimate(estimate(null, 'heavy backlight, canopy unresolved'));
    expect(s.limbCount).toBeNull();
    expect(s.overhangCount).toBeNull();
    expect(s.readable).toBe(false);
    expect(s.headline).toBe(UNREADABLE_LINE);
    expect(s.headline).toMatch(/not "nothing comes off"/i);
  });

  it('read-it-and-found-nothing is a different line from could-not-read-it', () => {
    const readNothing = summarizeEstimate(estimate([]));
    const couldNotRead = summarizeEstimate(estimate(null, 'too dark'));
    expect(readNothing.limbCount).toBe(0);
    expect(couldNotRead.limbCount).toBeNull();
    expect(readNothing.headline).not.toBe(couldNotRead.headline);
  });

  it('refuses to build an unreadable estimate with no reason given', () => {
    expect(() => estimate(null)).toThrow(/must say why/i);
  });

  it('refuses an estimate that both lists limbs and claims it was unreadable', () => {
    expect(() => estimate([limb()], 'too dark')).toThrow(/cannot both/i);
  });

  it('the structural assertion holds, and bites when it should', () => {
    expect(() => assertEstimateIsNotAPlan(summarizeEstimate(estimate([limb()])))).not.toThrow();
    expect(() => assertEstimateIsNotAPlan(summarizeEstimate(estimate(null, 'too dark')))).not.toThrow();
    expect(() =>
      assertEstimateIsNotAPlan({
        limbCount: 1, overhangCount: 1, readable: true,
        headline: 'Cut to this: two cuts at the collar.', disclaimer: ESTIMATE_DISCLAIMER,
      }),
    ).toThrow(/must not read as a plan/i);
    expect(() =>
      assertEstimateIsNotAPlan({
        limbCount: 1, overhangCount: 1, readable: true,
        headline: 'Rough read: 1 limb.', disclaimer: 'Looks good to me.',
      }),
    ).toThrow(/cannot be altered or omitted/i);
  });

  it('holds no price anywhere — the figure is still a human\'s (§3)', () => {
    const s = summarizeEstimate(estimate([limb()]));
    expect(JSON.stringify(s)).not.toMatch(/\$|\bprice\b|\bcost\b|\bamount\b/i);
  });
});

describe('only a named human on site makes the plan', () => {
  const ok = { id: 'p1', treeId: 't1', onSite: true, authoredAt: '2026-08-03', cuts: [{ limbRef: 'l1', instruction: 'reduce back to the collar' }] };

  it('accepts a foreman, an owner, and an ISA arborist with a number', () => {
    expect(authorPrunePlan({ ...ok, author: foreman }).ok).toBe(true);
    expect(authorPrunePlan({ ...ok, author: { id: 'c0', name: 'Mike', role: 'owner', isaCertificationNumber: null } }).ok).toBe(true);
    expect(authorPrunePlan({
      ...ok, author: { id: 'c2', name: 'R. Arborist', role: 'isa_certified_arborist', isaCertificationNumber: 'MA-1234A' },
    }).ok).toBe(true);
  });

  it('refuses a plan written off site', () => {
    const r = authorPrunePlan({ ...ok, author: foreman, onSite: false });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.problem).toMatch(/on site/i);
  });

  it('refuses an unnamed author', () => {
    const r = authorPrunePlan({ ...ok, author: { ...foreman, name: '   ' } });
    expect(r.ok).toBe(false);
  });

  it('refuses to stamp ISA on a plan with no certification number behind it', () => {
    // "Never claim a credential the company doesn't hold", on the one
    // document the crew actually cuts to.
    const r = authorPrunePlan({
      ...ok, author: { id: 'c2', name: 'R. Arborist', role: 'isa_certified_arborist', isaCertificationNumber: null },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.problem).toMatch(/certification number/i);
  });

  it('refuses an ISA number on a plan an arborist did not make', () => {
    const r = authorPrunePlan({ ...ok, author: { ...foreman, isaCertificationNumber: 'MA-1234A' } });
    expect(r.ok).toBe(false);
  });

  it('"nothing comes off" has to be said on purpose, not left blank', () => {
    const blank = authorPrunePlan({ ...ok, author: foreman, cuts: [] });
    expect(blank.ok).toBe(false);
    if (blank.ok) throw new Error('unreachable');
    expect(blank.problem).toMatch(/on purpose/i);

    const deliberate = authorPrunePlan({ ...ok, author: foreman, cuts: [], noCutsNeeded: true });
    expect(deliberate.ok).toBe(true);
  });

  it('refuses a plan that says nothing comes off but lists cuts', () => {
    expect(authorPrunePlan({ ...ok, author: foreman, noCutsNeeded: true }).ok).toBe(false);
  });

  it('there is no function that turns an estimate into a plan', async () => {
    // The guarantee is structural: nothing exported takes a PruneEstimate and
    // returns a PrunePlan. If someone adds one, this fails.
    const mod = await import('../src/assessment/pruneEstimate.js');
    const suspicious = Object.keys(mod).filter((k) => /promote|toPlan|approve|autoPlan|planFrom/i.test(k));
    expect(suspicious).toEqual([]);
  });
});

describe('what a screen is allowed to say', () => {
  it('an estimate with no plan is explicitly NOT authorisation to cut', () => {
    const s = pruneStanding(null, estimate([limb()]));
    expect(s.cuttable).toBe(false);
    expect(s.line).toMatch(/No prune plan yet/i);
    expect(s.line).toMatch(/Nobody cuts to it/i);
    expect(s.estimateLine).toContain(ESTIMATE_DISCLAIMER);
  });

  it('nothing on file is not "nothing needs doing"', () => {
    const s = pruneStanding(null, null);
    expect(s.cuttable).toBe(false);
    expect(s.line).toMatch(/not "nothing needs doing"/i);
  });

  it('a real plan is cuttable and names who made it', () => {
    const r = authorPrunePlan({
      id: 'p1', treeId: 't1', onSite: true, authoredAt: '2026-08-03',
      author: { id: 'c2', name: 'R. Arborist', role: 'isa_certified_arborist', isaCertificationNumber: 'MA-1234A' },
      cuts: [{ limbRef: 'l1', instruction: 'reduce back to the collar' }],
    });
    if (!r.ok) throw new Error('unreachable');
    const s = pruneStanding(r.plan, estimate([limb()]));
    expect(s.cuttable).toBe(true);
    expect(s.line).toContain('ISA certified arborist #MA-1234A');
  });
});

describe('the tree care log — Mike: "logging has much tree care data as possible"', () => {
  it('an empty record reports every field as missing, not as answered', () => {
    const c = logCompleteness(emptyObservation());
    expect(c.recorded).toBe(0);
    expect(c.missing.length).toBe(c.total);
    expect(c.attributed).toBe(false);
    expect(c.line).toMatch(/nobody's name is on this record/i);
  });

  it('names what is still blank, so the next visit knows what to ask', () => {
    const o = { ...emptyObservation(), observedBy: 'Mike', speciesGuess: 'Live oak', dbhInchesGuess: 30 };
    const c = logCompleteness(o);
    // Two, not three: observedBy is ATTRIBUTION, counted by `attributed`
    // rather than as a logged data field. Who wrote the record down is a
    // different question from how much is in it.
    expect(c.recorded).toBe(2);
    expect(c.missing).toContain('deadwoodNoted');
    expect(c.missing).not.toContain('speciesGuess');
    expect(c.attributed).toBe(true);
  });

  it('false is a recorded observation; null is not', () => {
    // "Looked, no deadwood" and "nobody looked" must not count the same.
    const looked = logCompleteness({ ...emptyObservation(), deadwoodNoted: false });
    const didnt = logCompleteness(emptyObservation());
    expect(looked.recorded).toBe(didnt.recorded + 1);
  });

  it('has no risk score, health index, or verdict function', () => {
    // The line between an observation and a diagnosis. If this fails, the
    // module started concluding things about trees.
    const keys = Object.keys(logCompleteness(emptyObservation()));
    expect(keys).not.toContain('risk');
    expect(keys).not.toContain('score');
  });
});

describe('geo — a pin with no accuracy is not a good pin', () => {
  it('no coordinates says so plainly', () => {
    expect(geoQuality(emptyGeoRecord()).quality).toBe('none');
  });

  it('coordinates with no accuracy figure are UNKNOWN, not good', () => {
    // D37: the geocoder put Circle Drive on the street centreline and the RPA
    // hugged the rear of the lot. A confident-looking point is the hazard.
    const g = { ...emptyGeoRecord(), treeLat: 36.93, treeLng: -76.26 };
    const q = geoQuality(g);
    expect(q.quality).toBe('unknown');
    expect(q.line).toMatch(/not as a survey point/i);
  });

  it('grades a real fix', () => {
    expect(geoQuality({ ...emptyGeoRecord(), treeLat: 36.9, treeLng: -76.2, accuracyMeters: 4 }).quality).toBe('good');
    expect(geoQuality({ ...emptyGeoRecord(), treeLat: 36.9, treeLng: -76.2, accuracyMeters: 45 }).quality).toBe('rough');
  });
});

describe('the AR capture session — Mike: "also the video caoturing that happens during AR"', () => {
  const session = (over: Partial<ReturnType<typeof emptyArSession>> = {}) =>
    ({ ...emptyArSession({ id: 's1', startedAt: '2026-08-03T15:00:00Z' }), ...over });

  it('counts every media ref without ever holding bytes', () => {
    const s = arSessionStanding(session({
      videoRefs: ['drive-v1'], keyframeRefs: ['drive-k1', 'drive-k2'], depthScanRefs: ['drive-d1'],
    }));
    expect(s.mediaCount).toBe(4);
  });

  it('a lost-tracking run says its guesses are unreliable', () => {
    expect(arSessionStanding(session({ trackingQuality: 'lost' })).qualityLine).toMatch(/unreliable/i);
    expect(arSessionStanding(session({ trackingQuality: 'good' })).qualityLine).toMatch(/held through/i);
    // Not recorded is its own state, not silently "good".
    expect(arSessionStanding(session()).qualityLine).toMatch(/unknown/i);
  });

  it('filming over the neighbour\'s line with no consent recorded is flagged', () => {
    const s = arSessionStanding(session({ coveredNeighborProperty: true }));
    expect(s.consentNeedsAttention).toBe(true);
    expect(s.consentLine).toMatch(/That is not consent/i);
  });

  it('no consent recorded on our own customer\'s property is stated, not flagged', () => {
    const s = arSessionStanding(session({ coveredNeighborProperty: false }));
    expect(s.consentNeedsAttention).toBe(false);
    expect(s.consentLine).toMatch(/not the same as given/i);
  });

  it('an explicit no-consent recording is the loudest state', () => {
    const s = arSessionStanding(session({ recordedWithConsent: false }));
    expect(s.consentNeedsAttention).toBe(true);
    expect(s.consentLine).toMatch(/Do not share this footage/i);
  });
});

describe('the RA holds it all together, and never leaks a customer (§4.3)', () => {
  const ra = () => newRiskAssessment({ id: 'ra1', treeId: 't1', propertyId: 'p1', now: '2026-08-03T15:00:00Z' });

  it('a fresh RA is honest about being empty', () => {
    const c = raCoverage(ra());
    expect(c.observation.recorded).toBe(0);
    expect(c.geo.quality).toBe('none');
    expect(c.hasPlan).toBe(false);
    expect(c.arSessionCount).toBe(0);
  });

  it('rolls up media and consent gaps across sessions', () => {
    const r = ra();
    r.arSessions = [
      { ...emptyArSession({ id: 's1', startedAt: 'x' }), videoRefs: ['v1'], coveredNeighborProperty: true },
      { ...emptyArSession({ id: 's2', startedAt: 'y' }), keyframeRefs: ['k1', 'k2'], recordedWithConsent: true },
    ];
    const c = raCoverage(r);
    expect(c.mediaCount).toBe(3);
    expect(c.consentGaps).toBe(1);
    expect(c.line).toMatch(/1 filming consent gap/);
  });

  it('estimates accumulate rather than overwrite — the history is data', () => {
    const r = ra();
    r.estimates = [estimate([limb()]), estimate([])];
    expect(raCoverage(r).estimateCount).toBe(2);
  });

  it('the log line carries ids and counts and nothing else', () => {
    const r = ra();
    r.customer = {
      ...emptyCustomerContext(),
      contactInstructions: 'CALL FIRST — Sandra Whitfield, 757-555-0199',
      siteEntryNotes: 'Gate code 4417, back of 8562 Circle Drive',
      statedConcern: 'limb over the neighbour\'s shed',
    };
    r.observation = { ...emptyObservation(), observedBy: 'Mike', freeNotes: 'Owner is Sandra, tenant called' };
    const line = raLogLine(r);
    // Everything above is exactly the material §4.3 keeps out of logs.
    expect(line).not.toMatch(/Sandra|Whitfield|757|4417|Circle Drive|shed|tenant/i);
    expect(line).toContain('ra=ra1');
    expect(line).toContain('tree=t1');
    expect(line).toMatch(/cust=3\/8/);
  });

  it('the coverage line is counts only, so it is safe on any surface', () => {
    const r = ra();
    r.customer = { ...emptyCustomerContext(), contactInstructions: 'ring the mobile, 757-555-0100' };
    expect(raCoverage(r).line).not.toMatch(/757|ring the mobile/i);
  });
});
