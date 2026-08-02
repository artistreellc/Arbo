import { describe, it, expect } from 'vitest';
import { quoteCheck, deriveLeakagePct, defaultTargets } from '../src/ops/estimating.js';

describe('estimating & rate engine (§6J2) — internal only, honest math', () => {
  it('a strong removal quote lands ON_TARGET', () => {
    const r = quoteCheck({
      jobType: 'removal', truckToTruckHours: 4, crewSize: 5,
      quotedPrice: 4400, loadedLaborPerManHour: 45, leakagePct: 0.08,
      equipmentCost: 300, dumpFees: 150, materials: 0,
    });
    expect(r.verdict).toBe('ON_TARGET');
    expect(r.effectiveRatePerHr).toBe(1100);
    expect(r.internalOnly).toBe(true);
  });

  it('the $3,800 day from the brief "lost money and it should say so"', () => {
    // §6J2.1: a 5-man crew, full day (~5 billable hrs), $3,800 gross.
    const r = quoteCheck({
      jobType: 'removal', truckToTruckHours: 5, crewSize: 5,
      quotedPrice: 3800, loadedLaborPerManHour: 45, leakagePct: 0.08,
      equipmentCost: 400, dumpFees: 200, materials: 100,
    });
    expect(r.verdict).not.toBe('ON_TARGET');
    expect(r.dayFloorEquivalent).toBeLessThan(defaultTargets.dayFloor);
    expect(r.drivers.join(' ')).toContain('floor');
  });

  it('LOSES_MONEY when all-in cost exceeds the quote', () => {
    const r = quoteCheck({
      jobType: 'pruning', truckToTruckHours: 6, crewSize: 5,
      quotedPrice: 1200, loadedLaborPerManHour: 45, leakagePct: 0.08,
      equipmentCost: 200, dumpFees: 100,
    });
    expect(r.verdict).toBe('LOSES_MONEY');
    expect(r.margin).toBeLessThan(0);
  });

  it('pruning is judged against the $700 target, not the removal rate', () => {
    const r = quoteCheck({
      jobType: 'pruning', truckToTruckHours: 2, crewSize: 3,
      quotedPrice: 1500, loadedLaborPerManHour: 45, leakagePct: 0.05,
    });
    expect(r.targetRatePerHr).toBe(700);
    expect(r.verdict).toBe('ON_TARGET');
  });

  it('missing cost inputs are named, never silently zeroed', () => {
    const r = quoteCheck({
      jobType: 'removal', truckToTruckHours: 3, crewSize: 4,
      quotedPrice: 3500, loadedLaborPerManHour: 45, leakagePct: 0.08,
    });
    expect(r.drivers.some((d) => d.includes('equipment cost not captured'))).toBe(true);
    expect(r.drivers.some((d) => d.includes('dump fees not captured'))).toBe(true);
  });

  it('leakage load is applied and disclosed as a driver', () => {
    const r = quoteCheck({
      jobType: 'removal', truckToTruckHours: 4, crewSize: 5,
      quotedPrice: 5000, loadedLaborPerManHour: 45, leakagePct: 0.08,
      equipmentCost: 0, dumpFees: 0, materials: 0,
    });
    expect(r.leakageLoad).toBe(400);
    expect(r.drivers.some((d) => d.includes('leakage'))).toBe(true);
  });

  it('every result is stamped internalOnly — §6J2.5 law rides the payload', () => {
    const r = quoteCheck({
      jobType: 'other', truckToTruckHours: 1, crewSize: 2,
      quotedPrice: 900, loadedLaborPerManHour: 40, leakagePct: 0,
    });
    expect(r.internalOnly).toBe(true);
  });
});

describe('leakage derivation (§6J2.4) — re-derived, never a fixed markup', () => {
  it('derives from actuals when both sides exist', () => {
    const d = deriveLeakagePct({ leakageTotal: 8000, revenueTotal: 100000 });
    expect(d.basis).toBe('derived');
    expect(d.pct).toBeCloseTo(0.08);
  });

  it('falls back to the ~8% default with a NAMED basis when data is thin', () => {
    expect(deriveLeakagePct({ leakageTotal: null, revenueTotal: null }).basis)
      .toBe('default_insufficient_data');
    expect(deriveLeakagePct({ leakageTotal: 500, revenueTotal: null }).pct).toBe(0.08);
    expect(deriveLeakagePct({ leakageTotal: null, revenueTotal: 50000 }).pct).toBe(0.08);
  });

  it('clamps a freak window so one bad week cannot poison every bid', () => {
    const d = deriveLeakagePct({ leakageTotal: 50000, revenueTotal: 60000 });
    expect(d.pct).toBeLessThanOrEqual(0.2);
  });
});
