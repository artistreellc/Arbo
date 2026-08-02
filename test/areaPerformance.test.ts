import { describe, it, expect } from 'vitest';
import {
  buildAreaReport, buildCampaignReport, MIN_JOBS_FOR_VERDICT,
  type AreaJobFact, type CampaignFact,
} from '../src/ops/areaPerformance.js';

const job = (over: Partial<AreaJobFact> = {}): AreaJobFact => ({
  jobId: 'j', areaKey: 'a', hours: 4, crewSize: 3, revenue: 3600, jobType: 'removal', ...over,
});

/** n jobs in one area at a given revenue-per-crew-hour. */
const area = (key: string, n: number, ratePerCrewHour: number, over: Partial<AreaJobFact> = {}) =>
  Array.from({ length: n }, (_, i) => job({
    jobId: `${key}-${i}`, areaKey: key, hours: 4, crewSize: 3,
    revenue: ratePerCrewHour * 12, ...over,
  }));

describe('§6N.3 — a rate is normalized, never a naive average', () => {
  it('rates on revenue per crew-hour, so job MIX does not decide the winner', () => {
    // Big area: huge jobs, mediocre rate. Small area: small jobs, great rate.
    const facts = [
      ...area('big', 6, 100, { hours: 10, crewSize: 4, revenue: 4000 }),
      ...area('small', 6, 150, { hours: 2, crewSize: 2, revenue: 600 }),
    ];
    const r = buildAreaReport(facts);
    const big = r.areas.find((a) => a.areaKey === 'big')!;
    const small = r.areas.find((a) => a.areaKey === 'small')!;
    // Raw per-job says 'big' wins by miles...
    expect(big.rawRevenuePerJob).toBeGreaterThan(small.rawRevenuePerJob!);
    // ...but the normalized rate says 'small' is the better-run area.
    expect(small.normalizedRatePerCrewHour!).toBeGreaterThan(big.normalizedRatePerCrewHour!);
    expect(r.areas[0]!.areaKey).toBe('small');
  });

  it('always carries the job mix so a verdict can be sanity-checked', () => {
    const r = buildAreaReport([
      ...area('a', 3, 100),
      ...area('a', 3, 100, { jobType: 'pruning' }),
    ]);
    expect(r.areas[0]!.mix).toEqual({ removal: 3, pruning: 3 });
  });
});

describe('small samples get NO verdict', () => {
  it('withholds a verdict below the floor and says why', () => {
    const r = buildAreaReport([...area('thin', MIN_JOBS_FOR_VERDICT - 1, 999), ...area('solid', 6, 100)]);
    const thin = r.areas.find((a) => a.areaKey === 'thin')!;
    expect(thin.verdict).toBe('not_enough_data');
    expect(thin.line).toMatch(/not a good area or a bad one/i);
    expect(r.withheld).toContain('thin');
  });

  it('an unjudged area sorts LAST, never as the bottom of the ranking', () => {
    const r = buildAreaReport([
      ...area('thin', 2, 999),      // spectacular rate, tiny sample
      ...area('solid', 6, 100),
    ]);
    expect(r.areas[r.areas.length - 1]!.areaKey).toBe('thin');
    // And its gaudy rate did not win it the top slot.
    expect(r.areas[0]!.areaKey).toBe('solid');
  });

  it('rates an area once it clears the floor', () => {
    const r = buildAreaReport(area('a', MIN_JOBS_FOR_VERDICT, 100));
    expect(r.areas[0]!.verdict).not.toBe('not_enough_data');
  });
});

describe('§1B — unusable data is excluded and NAMED, never counted as zero', () => {
  it('drops zero-hour jobs from the benchmark and says how many', () => {
    const r = buildAreaReport([...area('a', 6, 100), job({ areaKey: 'a', hours: 0 })]);
    expect(r.blindSpots.join(' ')).toMatch(/could not be normalized/i);
    expect(r.blindSpots.join(' ')).toMatch(/not counted as zero/i);
    expect(r.areas[0]!.jobs).toBe(6);
  });

  it('no usable data means no ratings at all, not a table of zeros', () => {
    const r = buildAreaReport([job({ hours: 0 }), job({ revenue: 0 })]);
    expect(r.areas).toEqual([]);
    expect(r.fleetRatePerCrewHour).toBeNull();
    expect(r.blindSpots.join(' ')).toMatch(/no area can be rated/i);
  });

  it('above and below are measured against the fleet rate, with a dead band', () => {
    const r = buildAreaReport([...area('hot', 6, 200), ...area('cold', 6, 100)]);
    expect(r.areas.find((a) => a.areaKey === 'hot')!.verdict).toBe('above');
    expect(r.areas.find((a) => a.areaKey === 'cold')!.verdict).toBe('below');
    // Two areas at the same rate are both "at", not split by noise.
    const even = buildAreaReport([...area('x', 6, 100), ...area('y', 6, 100)]);
    expect(even.areas.every((a) => a.verdict === 'at')).toBe(true);
  });
});

const camp = (over: Partial<CampaignFact> = {}): CampaignFact => ({
  id: 'c1', type: 'flyer', cost: 500, bookedJobs: 5, attributionWired: true, ...over,
});

describe('campaign ROI — refuses the two comfortable lies', () => {
  it('computes cost per booked job when it actually can', () => {
    expect(buildCampaignReport([camp()])[0]!.costPerBookedJob).toBe(100);
  });

  it('an UNTRACKED campaign is unknown, not a failure', () => {
    const r = buildCampaignReport([camp({ attributionWired: false })])[0]!;
    expect(r.bookedJobs).toBeNull();
    expect(r.costPerBookedJob).toBeNull();
    expect(r.line).toMatch(/not the same as it failing/i);
  });

  it('a tracked campaign with no jobs IS reported as no jobs', () => {
    const r = buildCampaignReport([camp({ bookedJobs: 0 })])[0]!;
    expect(r.bookedJobs).toBe(0);
    expect(r.costPerBookedJob).toBeNull();
    expect(r.line).toMatch(/no booked jobs came from it/i);
  });

  it('no cost on file means unknown efficiency, never free', () => {
    const r = buildCampaignReport([camp({ cost: null })])[0]!;
    expect(r.costPerBookedJob).toBeNull();
    expect(r.line).toMatch(/cost per job is unknown/i);
  });

  it('unmeasurable campaigns sort last, not as the worst performers', () => {
    const r = buildCampaignReport([
      camp({ id: 'untracked', attributionWired: false }),
      camp({ id: 'cheap', cost: 100, bookedJobs: 10 }),
      camp({ id: 'dear', cost: 1000, bookedJobs: 2 }),
    ]);
    expect(r.map((x) => x.id)).toEqual(['cheap', 'dear', 'untracked']);
  });
});
