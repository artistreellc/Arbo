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
  buildPortalView, toTreeCard, paymentState, siteFeatures,
  NOT_ASSESSED, NO_SCHEDULE,
  type PortalTree, type PortalProperty, type PortalJob,
} from '../src/portal/customerView.js';

// The third door — the first surface a NON-employee sees. These tests are the
// two things that would actually hurt: a customer reading a blank as "my tree
// is fine", and a figure Arbo made up.

const prop: PortalProperty = {
  id: 'p1', address: '101 Simulation Row', city: 'Virginia Beach', zip: '23451',
  geoLat: 36.85, geoLng: -75.98,
  hazardPowerLines: false, powerLinesCheckedAt: null,
  waterMeterLocation: null, waterMeterPathNote: null, siteFeaturesNote: null,
};
const tree = (over: Partial<PortalTree> = {}): PortalTree => ({
  id: 't1', species: 'Live oak', size: 'large', locationOnLot: 'front left',
  conditionNotes: 'Good structure, minor deadwood.',
  lastServiceDate: '2025-03-01', nextDueForecast: '2027-03-01', ...over,
});
const noLink = () => null;

describe('an unassessed tree never reads as a healthy one (§1B)', () => {
  it('states the absence instead of leaving it blank', () => {
    const c = toTreeCard(tree({ conditionNotes: null }));
    expect(c.assessed).toBe(false);
    expect(c.assessment).toBe(NOT_ASSESSED);
    expect(c.assessment).toMatch(/not a clean bill of health/i);
  });

  it('treats whitespace-only notes as unassessed', () => {
    expect(toTreeCard(tree({ conditionNotes: '   ' })).assessed).toBe(false);
  });

  it('shows Mike’s words verbatim when he HAS assessed it, and never adds to them', () => {
    const c = toTreeCard(tree({ conditionNotes: 'Cavity at the union. Watch it.' }));
    expect(c.assessment).toBe('Cavity at the union. Watch it.');
    expect(c.assessed).toBe(true);
  });

  it('names an unrecorded species rather than showing an empty line', () => {
    const c = toTreeCard(tree({ species: null }));
    expect(c.species).toBe('Species not recorded');
    expect(c.speciesKnown).toBe(false);
  });

  it('distinguishes "no pruning date set" from a date', () => {
    expect(toTreeCard(tree({ nextDueForecast: null })).scheduleLine).toBe(NO_SCHEDULE);
    expect(toTreeCard(tree()).scheduleLine).toContain('2027-03-01');
  });

  it('counts every gap where the customer can see it', () => {
    const v = buildPortalView({
      property: prop,
      trees: [tree({ id: 'a' }), tree({ id: 'b', conditionNotes: null, nextDueForecast: null, species: null })],
      job: null, linkFor: noLink,
    });
    expect(v.gaps.join(' ')).toMatch(/1 of your 2 tree\(s\) have not been assessed/);
    expect(v.gaps.join(' ')).toMatch(/1 have no pruning date set/);
    expect(v.gaps.join(' ')).toMatch(/1 have no species recorded/);
  });
});

describe('§3 — the payment figure always comes from a human', () => {
  const done = (over: Partial<PortalJob> = {}): PortalJob => ({
    id: 'j1', status: 'complete', scheduledFor: '2026-08-01T13:00:00Z',
    completedAt: '2026-08-01T17:00:00Z', scope: 'Removal',
    agreedAmount: 1850, amountPaid: null, ...over,
  });

  it('offers a link only for a figure that was agreed', () => {
    const r = paymentState(done(), (id, amt) => `https://sq.link/${id}/${amt}`);
    expect(r.state).toBe('payable');
    expect(r).toMatchObject({ amount: 1850 });
  });

  it('shows NO button when there is no agreed figure, and says why', () => {
    const r = paymentState(done({ agreedAmount: null }), () => 'should-not-be-used');
    expect(r.state).toBe('no_agreed_figure');
    expect(r.line).toMatch(/not ready yet/i);
    expect(JSON.stringify(r)).not.toContain('should-not-be-used');
  });

  it('never invents a figure from the scope or anything else', () => {
    const r = paymentState(done({ agreedAmount: 0 }), noLink);
    expect(r.state).toBe('no_agreed_figure');
  });

  it('asks for nothing before the work is complete', () => {
    expect(paymentState(done({ completedAt: null }), noLink).state).toBe('nothing_due');
    expect(paymentState(null, noLink).state).toBe('nothing_due');
  });

  it('recognises a job already paid', () => {
    expect(paymentState(done({ amountPaid: 1850 }), noLink).state).toBe('already_paid');
  });

  it('cannot take a payment itself — the link is injected', () => {
    // paymentState has no idea what Square is. If the injector returns null,
    // the state is still payable and the UI shows the figure without a button.
    const r = paymentState(done(), () => null);
    expect(r).toMatchObject({ state: 'payable', link: null });
  });
});

describe('the site map', () => {
  it('places trees that have a recorded location and COUNTS the rest', () => {
    const v = buildPortalView({
      property: prop,
      trees: [tree({ id: 'a' }), tree({ id: 'b', locationOnLot: null })],
      job: null, linkFor: noLink,
    });
    expect(v.map.markers).toHaveLength(1);
    expect(v.map.unplaced).toBe(1);
    expect(v.map.line).toMatch(/not on the map yet/i);
  });

  it('says an unmapped property is unmapped rather than drawing an empty lot', () => {
    // An empty map over a real address reads as "you have no trees".
    const v = buildPortalView({
      property: { ...prop, geoLat: null, geoLng: null },
      trees: [tree()], job: null, linkFor: noLink,
    });
    expect(v.map.centre).toBeNull();
    expect(v.map.line).toMatch(/do not have this property mapped/i);
  });
});

describe('one property, and nothing internal', () => {
  it('leaks no internal field into the payload', () => {
    const v = buildPortalView({
      property: prop, trees: [tree()],
      job: {
        id: 'j1', status: 'booked', scheduledFor: '2026-08-05T13:00:00Z',
        completedAt: null, scope: 'Removal', agreedAmount: 1850, amountPaid: null,
      },
      linkFor: noLink,
    });
    const json = JSON.stringify(v).toLowerCase();
    for (const forbidden of ['margin', 'leakage', 'crew', 'lead source', 'callrail', 'competitor']) {
      expect(json, `portal payload leaked "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('shows the window language, never a promised time (§1.4)', () => {
    const v = buildPortalView({
      property: prop, trees: [],
      job: {
        id: 'j1', status: 'booked', scheduledFor: '2026-08-05T13:00:00Z',
        completedAt: null, scope: null, agreedAmount: null, amountPaid: null,
      },
      linkFor: noLink,
    });
    expect(v.project.line).toMatch(/Mike confirms the exact time/i);
  });
});

describe('site information — power lines and the water meter (Mike, 2026-08-03)', () => {
  it('an UNCHECKED property never reads as "no power lines"', () => {
    // hazard_power_lines is a boolean defaulting to false, so on its own it
    // cannot tell "there are none" from "nobody looked". On this field that
    // distinction is the whole point.
    const f = siteFeatures(prop).find((x) => x.label === 'Power lines')!;
    expect(f.known).toBe(false);
    expect(f.value).toMatch(/not the same as none/i);
  });

  it('a CHECKED property with none says so, and one with lines says that', () => {
    const checked = siteFeatures({ ...prop, powerLinesCheckedAt: '2026-08-01T12:00:00Z' })
      .find((x) => x.label === 'Power lines')!;
    expect(checked.known).toBe(true);
    expect(checked.value).toMatch(/none noted/i);

    const hasLines = siteFeatures({ ...prop, hazardPowerLines: true })
      .find((x) => x.label === 'Power lines')!;
    expect(hasLines.value).toMatch(/noted on this property/i);
  });

  it('carries the water meter cap and how to find its run', () => {
    const f = siteFeatures({
      ...prop,
      waterMeterLocation: 'Cap is in the grass strip left of the driveway apron.',
      waterMeterPathNote: 'Run goes straight back to the hose bib on the north wall.',
    });
    expect(f.find((x) => x.label === 'Water meter cap')!.value).toMatch(/driveway apron/);
    expect(f.find((x) => x.label === 'Finding the meter run')!.value).toMatch(/hose bib/);
    expect(f.filter((x) => !x.known)).toHaveLength(1); // only power lines left
  });

  it('names every unrecorded site fact rather than omitting the row', () => {
    const f = siteFeatures(prop);
    expect(f.every((x) => x.value.trim().length > 0)).toBe(true);
    expect(f.filter((x) => !x.known).length).toBe(3);
  });

  it('counts unrecorded site info in the customer-visible gaps', () => {
    const v = buildPortalView({ property: prop, trees: [], job: null, linkFor: noLink });
    expect(v.gaps.join(' ')).toMatch(/3 piece\(s\) of site information are not recorded/);
    expect(v.site.length).toBeGreaterThanOrEqual(3);
  });
});
