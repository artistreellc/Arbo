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
// TREE MEASUREMENT FROM A PHONE LIDAR POINT CLOUD — owner ruling R25 (Mike,
// 2026-09-28). Research: docs/research/R25_permits_lidar_pwa.md part B.
//
// What a phone scan can and cannot tell you, and so what this file claims:
//   * Range is about 5 m, clean data about 3–4 m. DBH is the one metric phone
//     LiDAR does decently (RMSE ~2–5 cm; Gollob et al. 2021, ForestScanner),
//     and the apps tend to UNDER-estimate it.
//   * Height and crown of a mature tree are poor: the top is out of range, so
//     height is a MINIMUM and says so. No validated phone crown method exists.
//   * Every metric carries a confidence ('good' | 'fair' | 'low' |
//     'unreadable') and a reason. Height and crown are never 'good'.
//
// §1B: a metric that cannot be computed is `null` with confidence
// 'unreadable' and a named reason — NEVER 0. "The scan did not show the
// trunk" and "the trunk is 0 cm" are different facts.
//
// Brief §6X: no AR capture, no photogrammetry, no cut-count model. This is
// geometry only — no health words, no prices. Decision support: a person
// signs off before any number is used.
//
// Method, kept deliberately plain:
//   1. ground  = low percentile of the up axis (whole scan, then refined near
//                the stem);
//   2. stem    = the densest vertical column 0.3–2.5 m above ground;
//   3. DBH     = circle fit (RANSAC, then Kasa algebraic least squares) to a
//                1.27–1.47 m slice around the stem (1.37 m breast height);
//   4. lean    = the line between stem centres fitted at 0.5 m and 2.0 m;
//   5. height  = robust top of the points near the stem, minus ground;
//   6. crown   = the two principal horizontal extents of the top 2/3.

import { guessUpAxis, type UpAxis, type Units } from './parse.js';

export type Confidence = 'good' | 'fair' | 'low' | 'unreadable';

export interface MetricConfidence {
  level: Confidence;
  reason: string;
}

export interface DbhFit {
  /** Points within 2.5 cm of the fitted circle. */
  inliers: number;
  /** Scatter of those points about the circle. */
  rmseCm: number;
  /** How much of the trunk's circumference the scan saw, 0–360. */
  arcCoverageDeg: number;
}

export interface MeasureOptions {
  /** From the parse step (or a person). Missing → guessed from the data. */
  upAxis?: UpAxis;
  units?: Units;
  /** Clock injection for tests. */
  now?: Date;
}

export interface TreeMeasurement {
  heightM: number | null;
  /** Widest horizontal extent of the top 2/3 of the tree. */
  crownSpreadM: number | null;
  /** The two principal horizontal extents (compass-free: a phone scan has no north). */
  crownAxesM: { major: number; minor: number } | null;
  dbhCm: number | null;
  dbhFit: DbhFit | null;
  leanDeg: number | null;
  confidence: {
    height: MetricConfidence;
    crown: MetricConfidence;
    dbh: MetricConfidence;
    lean: MetricConfidence;
  };
  warnings: string[];
  units: Units;
  upAxis: UpAxis;
  pointCount: number;
  measuredAt: string;
}

export const BREAST_HEIGHT_M = 1.37;
/** Phone LiDAR clean range (research part B). */
export const CLEAN_RANGE_M = 4;

const SLICE_HALF_M = 0.1;
const STEM_SEARCH_RADIUS_M = 1.2;
const GROUND_RADIUS_M = 1.5;
const NEIGHBOURHOOD_M = 12;
const FIT_TOLERANCE_M = 0.025;
const MIN_FIT_POINTS = 12;

export const UNITS_WARNING =
  'UNITS NOT CONFIRMED: the file does not say it is in metres. Every figure assumes metres; if the scan app exported feet, all of them are off by a factor of 3.28.';

const RANK: Record<Confidence, number> = { good: 3, fair: 2, low: 1, unreadable: 0 };

function worse(a: MetricConfidence, level: Confidence, reason: string): MetricConfidence {
  return RANK[level] < RANK[a.level] ? { level, reason } : a;
}

function unreadable(reason: string): MetricConfidence {
  return { level: 'unreadable', reason };
}

export function measureTree(points: Float32Array, opts: MeasureOptions = {}): TreeMeasurement {
  const warnings: string[] = [];
  const units: Units = opts.units ?? 'unknown';
  const n = Math.floor(points.length / 3);
  let upAxis = opts.upAxis;
  if (!upAxis) {
    const g = guessUpAxis(points, { axis: 'y', source: 'format', reason: 'no up axis given; assumed ARKit Y-up' });
    upAxis = g.axis;
    warnings.push(`Up axis was not given; used ${g.axis.toUpperCase()}-up (${g.reason}).`);
  }
  if (units === 'unknown') warnings.unshift(UNITS_WARNING);

  const result: TreeMeasurement = {
    heightM: null,
    crownSpreadM: null,
    crownAxesM: null,
    dbhCm: null,
    dbhFit: null,
    leanDeg: null,
    confidence: {
      height: unreadable('empty_cloud: the scan holds no points'),
      crown: unreadable('empty_cloud: the scan holds no points'),
      dbh: unreadable('empty_cloud: the scan holds no points'),
      lean: unreadable('empty_cloud: the scan holds no points'),
    },
    warnings,
    units,
    upAxis,
    pointCount: n,
    measuredAt: (opts.now ?? new Date()).toISOString(),
  };
  if (n === 0) return result;

  const cloud: Cloud = upAxis === 'z' ? { p: points, n, u: 2, a: 0, b: 1 } : { p: points, n, u: 1, a: 0, b: 2 };

  // 1–2. Ground (whole scan), then the stem column.
  const g0 = sampledPercentile(cloud, 0.02);
  const stem = findStem(cloud, g0);

  // 1b. Ground near the stem: sloped yards make the whole-scan figure wrong.
  let ground = g0;
  if (stem) {
    const near = upValues(cloud, stem, GROUND_RADIUS_M, -Infinity, Infinity);
    if (near.length >= 20) ground = percentile(near, 0.01);
  }

  // 3. DBH.
  if (!stem) {
    result.confidence.dbh = unreadable('stem_not_found: no trunk-like column of points 0.3–2.5 m above ground');
    result.confidence.lean = unreadable('stem_not_found: no trunk-like column of points 0.3–2.5 m above ground');
    warnings.push('No trunk found in the scan; height and crown use the whole scan.');
  } else {
    const bh = ground + BREAST_HEIGHT_M;
    const fit = fitSlice(cloud, stem, bh - SLICE_HALF_M, bh + SLICE_HALF_M, 1);
    if (!fit) {
      result.confidence.dbh = unreadable('dbh_slice_unreadable: too few trunk points at 1.27–1.47 m to fit a circle');
    } else {
      result.dbhCm = round1(fit.r * 200);
      result.dbhFit = { inliers: fit.inliers, rmseCm: round2(fit.rmse * 100), arcCoverageDeg: Math.round(fit.arcDeg) };
      result.confidence.dbh = dbhConfidence(fit, warnings);
      stem.a = fit.cx;
      stem.b = fit.cy;
    }

    // 4. Lean from stem centres at 0.5 m and 2.0 m.
    const low = fitSlice(cloud, stem, ground + 0.4, ground + 0.6, 2);
    const high = fitSlice(cloud, stem, ground + 1.9, ground + 2.1, 3);
    if (!low || !high) {
      result.confidence.lean = unreadable(
        `lean_slice_unreadable: no circle fit at ${!low ? '0.5 m' : '2.0 m'} above ground`,
      );
    } else {
      const offset = Math.hypot(high.cx - low.cx, high.cy - low.cy);
      result.leanDeg = round1((Math.atan2(offset, 1.5) * 180) / Math.PI);
      let c: MetricConfidence = { level: 'good', reason: 'stem centres fitted cleanly at 0.5 m and 2.0 m; lowest 2 m of trunk only' };
      if (Math.min(low.arcDeg, high.arcDeg) < 270 || Math.max(low.rmse, high.rmse) > 0.015) {
        c = worse(c, 'fair', 'stem centres fitted on part of the trunk; lowest 2 m of trunk only');
      }
      if (Math.min(low.arcDeg, high.arcDeg) < 180) {
        c = worse(c, 'low', 'less than half the trunk seen at 0.5 m or 2.0 m, so the stem centres are uncertain');
      }
      result.confidence.lean = c;
    }
  }

  // 5. Height.
  const nearUp = stem ? upValues(cloud, stem, NEIGHBOURHOOD_M, -Infinity, Infinity) : allUp(cloud);
  const k = Math.max(5, Math.ceil(nearUp.length * 0.0005));
  const sortedUp = nearUp.sort();
  const top = sortedUp[Math.max(0, sortedUp.length - k)] ?? ground;
  const height = top - ground;
  if (!(height > 0.3)) {
    result.confidence.height = unreadable('no_height: nothing in the scan rises more than 0.3 m above ground');
    result.confidence.crown = unreadable('no_height: nothing in the scan rises more than 0.3 m above ground');
    return result;
  }
  result.heightM = round2(height);
  if (height > CLEAN_RANGE_M) {
    result.confidence.height = { level: 'low', reason: 'the top is beyond the phone\'s clean range (~4 m); a minimum, not a measurement' };
    warnings.push('height exceeds phone LiDAR clean range (~4 m); treat as a minimum');
  } else {
    result.confidence.height = { level: 'fair', reason: 'within the phone\'s clean range; phone LiDAR tends to read heights short' };
  }
  if (!stem) result.confidence.height = worse(result.confidence.height, 'low', 'no trunk found; measured from the lowest point in the whole scan');

  // 6. Crown: top 2/3 of the tree, principal horizontal extents.
  const crown = crownAxes(cloud, stem, ground + height / 3);
  if (!crown) {
    result.confidence.crown = unreadable('crown_unreadable: too few points in the top two-thirds of the tree');
    return result;
  }
  result.crownAxesM = { major: round2(crown.major), minor: round2(crown.minor) };
  result.crownSpreadM = round2(crown.major);
  let cc: MetricConfidence = {
    level: 'fair',
    reason: `no validated phone-LiDAR crown method; counts everything above one-third height within ${NEIGHBOURHOOD_M} m of the stem`,
  };
  if (height > CLEAN_RANGE_M || crown.major > 2 * CLEAN_RANGE_M) {
    cc = worse(cc, 'low', 'the crown reaches beyond the phone\'s clean range (~4 m); edges and top are likely missing');
  }
  if (result.dbhCm !== null && crown.major <= (1.5 * result.dbhCm) / 100) {
    cc = worse(cc, 'low', 'only trunk above one-third height — the crown looks unscanned');
  }
  if (!stem) cc = worse(cc, 'low', 'no trunk found; crown uses the whole scan');
  result.confidence.crown = cc;
  return result;
}

function dbhConfidence(fit: Circle, warnings: string[]): MetricConfidence {
  let c: MetricConfidence = {
    level: 'good',
    reason: `circle fitted on ${fit.inliers} points covering ${Math.round(fit.arcDeg)}° of the trunk`,
  };
  if (fit.arcDeg < 180) {
    c = worse(c, 'low', `only ${Math.round(fit.arcDeg)}° of the trunk seen; the fit may run small`);
    warnings.push(`partial stem arc < 180° (${Math.round(fit.arcDeg)}°); DBH may be underestimated — scan further around the trunk`);
  } else if (fit.arcDeg < 270) {
    c = worse(c, 'fair', `${Math.round(fit.arcDeg)}° of the trunk seen; a full walk-around fits better`);
  }
  if (fit.rmse > 0.03) c = worse(c, 'low', `points scatter ${round1(fit.rmse * 100)} cm about the circle`);
  else if (fit.rmse > 0.015) c = worse(c, 'fair', `points scatter ${round1(fit.rmse * 100)} cm about the circle`);
  if (fit.inliers < 30) c = worse(c, 'fair', `only ${fit.inliers} points on the trunk circle`);
  if (fit.inliers < fit.slicePoints * 0.4) {
    c = worse(c, 'fair', 'many points at breast height are off the trunk circle (branches, brush or a second stem)');
  }
  if (fit.r * 2 > 2.5) c = worse(c, 'low', 'diameter over 2.5 m is outside what a phone scan resolves; check the scan and units');
  // The apps and the Kasa fit both lean small (research part B).
  return c;
}

// ─── Geometry ────────────────────────────────────────────────────────────────

interface Cloud {
  p: Float32Array;
  n: number;
  /** Index (0–2) of the up axis and the two horizontal axes. */
  u: number;
  a: number;
  b: number;
}

interface XY {
  a: number;
  b: number;
}

interface Circle {
  cx: number;
  cy: number;
  r: number;
  inliers: number;
  rmse: number;
  arcDeg: number;
  slicePoints: number;
}

/** Sorts `v` in place, then reads the q-th quantile. */
function percentile(v: Float64Array, q: number): number {
  v.sort();
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))] ?? 0;
}

function sampledPercentile(c: Cloud, q: number): number {
  const step = Math.max(1, Math.ceil(c.n / 200_000));
  const v = new Float64Array(Math.ceil(c.n / step));
  let k = 0;
  for (let i = 0; i < c.n; i += step) v[k++] = c.p[i * 3 + c.u]!;
  return percentile(v.subarray(0, k), q);
}

function allUp(c: Cloud): Float64Array {
  const v = new Float64Array(c.n);
  for (let i = 0; i < c.n; i++) v[i] = c.p[i * 3 + c.u]!;
  return v;
}

/** Up values of points within `radius` (horizontal) of `centre`, in [lo, hi]. */
function upValues(c: Cloud, centre: XY, radius: number, lo: number, hi: number): Float64Array {
  const out: number[] = [];
  const r2 = radius * radius;
  for (let i = 0; i < c.n; i++) {
    const o = i * 3;
    const u = c.p[o + c.u]!;
    if (u < lo || u > hi) continue;
    const da = c.p[o + c.a]! - centre.a;
    const db = c.p[o + c.b]! - centre.b;
    if (da * da + db * db <= r2) out.push(u);
  }
  return Float64Array.from(out);
}

/** The densest vertical column 0.3–2.5 m above ground, on a 10 cm grid,
 *  scored by its weakest of three height bands so a bush or a low branch
 *  alone cannot win. */
function findStem(c: Cloud, ground: number): XY | null {
  const CELL = 0.1;
  const OFF = 1 << 20;
  const key = (ix: number, iy: number): number => (ix + OFF) * 2 ** 21 + (iy + OFF);
  const bands = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
  for (let i = 0; i < c.n; i++) {
    const o = i * 3;
    const h = c.p[o + c.u]! - ground;
    if (h < 0.3 || h >= 2.5) continue;
    const band = bands[h < 1.0 ? 0 : h < 1.7 ? 1 : 2]!;
    const k = key(Math.floor(c.p[o + c.a]! / CELL), Math.floor(c.p[o + c.b]! / CELL));
    band.set(k, (band.get(k) ?? 0) + 1);
  }
  const windowSum = (m: Map<number, number>, ix: number, iy: number): number => {
    let s = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) s += m.get(key(ix + dx, iy + dy)) ?? 0;
    return s;
  };
  let best: XY | null = null;
  let bestScore = 0;
  for (const k of bands[1]!.keys()) {
    const ix = Math.floor(k / 2 ** 21) - OFF;
    const iy = (k % 2 ** 21) - OFF;
    const score = Math.min(...bands.map((m) => windowSum(m, ix, iy)));
    if (score > bestScore) {
      bestScore = score;
      best = { a: (ix + 0.5) * CELL, b: (iy + 0.5) * CELL };
    }
  }
  return bestScore >= 15 ? best : null;
}

function fitSlice(c: Cloud, centre: XY, lo: number, hi: number, seed: number): Circle | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const r2 = STEM_SEARCH_RADIUS_M * STEM_SEARCH_RADIUS_M;
  for (let i = 0; i < c.n; i++) {
    const o = i * 3;
    const u = c.p[o + c.u]!;
    if (u < lo || u > hi) continue;
    const x = c.p[o + c.a]!;
    const y = c.p[o + c.b]!;
    if ((x - centre.a) ** 2 + (y - centre.b) ** 2 <= r2) {
      xs.push(x);
      ys.push(y);
    }
  }
  return fitCircleRansac(xs, ys, seed);
}

/** RANSAC over 3-point circles, then Kasa least squares on the inliers
 *  (twice, re-collecting inliers after the first refinement). Seeded, so
 *  the same scan always gives the same numbers. */
function fitCircleRansac(xs: number[], ys: number[], seed = 1): Circle | null {
  const n = xs.length;
  if (n < MIN_FIT_POINTS) return null;
  const rand = mulberry32(0x5eed + seed);
  const inliersOf = (cx: number, cy: number, r: number, from: number[] | null = null): number[] => {
    const idx: number[] = [];
    const m = from ? from.length : n;
    for (let j = 0; j < m; j++) {
      const i = from ? from[j]! : j;
      if (Math.abs(Math.hypot(xs[i]! - cx, ys[i]! - cy) - r) <= FIT_TOLERANCE_M) idx.push(i);
    }
    return idx;
  };
  // Hypotheses are scored on at most ~2,000 evenly spaced points (a dense
  // scan can put 60,000 in one slice); the refinement below uses them all.
  const step = Math.max(1, Math.floor(n / 2000));
  const sample: number[] = [];
  for (let i = 0; i < n; i += step) sample.push(i);

  let best: number[] = [];
  for (let it = 0; it < 400; it++) {
    const i = Math.floor(rand() * n);
    const j = Math.floor(rand() * n);
    const k = Math.floor(rand() * n);
    if (i === j || j === k || i === k) continue;
    const circ = circumcircle(xs[i]!, ys[i]!, xs[j]!, ys[j]!, xs[k]!, ys[k]!);
    if (!circ || circ.r < 0.02 || circ.r > 1.6) continue;
    const inl = inliersOf(circ.cx, circ.cy, circ.r, sample);
    if (inl.length > best.length) best = inl;
  }
  if (best.length < MIN_FIT_POINTS) return null;

  let fit = kasa(xs, ys, best);
  if (!fit) return null;
  let inl = inliersOf(fit.cx, fit.cy, fit.r);
  if (inl.length < MIN_FIT_POINTS) return null;
  fit = kasa(xs, ys, inl) ?? fit;
  inl = inliersOf(fit.cx, fit.cy, fit.r);
  if (inl.length < MIN_FIT_POINTS) return null;

  let se = 0;
  const angles: number[] = [];
  for (const i of inl) {
    const dx = xs[i]! - fit.cx;
    const dy = ys[i]! - fit.cy;
    se += (Math.hypot(dx, dy) - fit.r) ** 2;
    angles.push(Math.atan2(dy, dx));
  }
  return {
    cx: fit.cx,
    cy: fit.cy,
    r: fit.r,
    inliers: inl.length,
    rmse: Math.sqrt(se / inl.length),
    arcDeg: arcCoverageDeg(angles),
    slicePoints: n,
  };
}

/** 360° minus the largest empty gap between the points' bearings. */
function arcCoverageDeg(angles: number[]): number {
  if (angles.length < 2) return 0;
  const s = angles.slice().sort((x, y) => x - y);
  let gap = s[0]! + 2 * Math.PI - s[s.length - 1]!;
  for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i]! - s[i - 1]!);
  return 360 - (gap * 180) / Math.PI;
}

function circumcircle(
  x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
): { cx: number; cy: number; r: number } | null {
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-12) return null;
  const s1 = x1 * x1 + y1 * y1;
  const s2 = x2 * x2 + y2 * y2;
  const s3 = x3 * x3 + y3 * y3;
  const cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d;
  const cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d;
  return { cx, cy, r: Math.hypot(x1 - cx, y1 - cy) };
}

/** Kasa algebraic circle fit: minimise Σ(x²+y²+Dx+Ey+F)², on points
 *  centred on their mean for numerical stability. */
function kasa(xs: number[], ys: number[], idx: number[]): { cx: number; cy: number; r: number } | null {
  const m = idx.length;
  if (m < 3) return null;
  let mx = 0;
  let my = 0;
  for (const i of idx) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= m;
  my /= m;
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  for (const i of idx) {
    const x = xs[i]! - mx;
    const y = ys[i]! - my;
    const z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
    sxz += x * z; syz += y * z; sz += z;
  }
  // Normal equations: [sxx sxy sx; sxy syy sy; sx sy m] [D E F]ᵀ = -[sxz syz sz]ᵀ
  const sol = solve3(
    [sxx, sxy, sx, sxy, syy, sy, sx, sy, m],
    [-sxz, -syz, -sz],
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  return { cx: cx + mx, cy: cy + my, r: Math.sqrt(r2) };
}

/** Cramer's rule for a 3×3 system (row-major). */
function solve3(A: number[], b: number[]): [number, number, number] | null {
  const det = (M: number[]): number =>
    M[0]! * (M[4]! * M[8]! - M[5]! * M[7]!) -
    M[1]! * (M[3]! * M[8]! - M[5]! * M[6]!) +
    M[2]! * (M[3]! * M[7]! - M[4]! * M[6]!);
  const d = det(A);
  if (Math.abs(d) < 1e-15) return null;
  const col = (c: number): number[] => A.map((v, i) => (i % 3 === c ? b[Math.floor(i / 3)]! : v));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

/** Principal horizontal extents of points above `floor` near the stem. */
function crownAxes(c: Cloud, centre: XY | null, floor: number): { major: number; minor: number } | null {
  const as: number[] = [];
  const bs: number[] = [];
  const r2 = NEIGHBOURHOOD_M * NEIGHBOURHOOD_M;
  for (let i = 0; i < c.n; i++) {
    const o = i * 3;
    if (c.p[o + c.u]! < floor) continue;
    const a = c.p[o + c.a]!;
    const b = c.p[o + c.b]!;
    if (centre && (a - centre.a) ** 2 + (b - centre.b) ** 2 > r2) continue;
    as.push(a);
    bs.push(b);
  }
  const m = as.length;
  if (m < 50) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < m; i++) {
    ma += as[i]!;
    mb += bs[i]!;
  }
  ma /= m;
  mb /= m;
  let saa = 0, sab = 0, sbb = 0;
  for (let i = 0; i < m; i++) {
    const da = as[i]! - ma;
    const db = bs[i]! - mb;
    saa += da * da; sab += da * db; sbb += db * db;
  }
  const theta = 0.5 * Math.atan2(2 * sab, saa - sbb);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const p1 = new Float64Array(m);
  const p2 = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    p1[i] = as[i]! * cos + bs[i]! * sin;
    p2[i] = -as[i]! * sin + bs[i]! * cos;
  }
  const extent = (v: Float64Array): number => {
    v.sort();
    const q = (p: number): number => v[Math.floor(p * (v.length - 1))]!;
    return q(0.998) - q(0.002);
  };
  const e1 = extent(p1);
  const e2 = extent(p2);
  return { major: Math.max(e1, e2), minor: Math.min(e1, e2) };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
