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
// R25 LiDAR import + measure. Every cloud here is SYNTHETIC, built in-test:
// a 40 cm trunk, a 6 m crown at 5–9 m and a ground plane. No real scan, no
// customer data (§3).
import { describe, it, expect } from 'vitest';
import { parsePointCloud, type ParsedCloud, type ParseResult } from '../src/lidar/parse.js';
import { measureTree } from '../src/lidar/measure.js';
import { summarizeTreeMeasurement, SIGN_OFF } from '../src/lidar/summary.js';

// ─── Synthetic tree (Z-up, metres) ───────────────────────────────────────────

type P = [number, number, number];

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number, sd: number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()) * sd;
}

interface TreeOpts {
  /** Trunk arc seen, degrees (360 = walked all the way round). */
  arcDeg?: number;
  leanDeg?: number;
  trunk?: boolean;
  seed?: number;
}

const STEM: [number, number] = [1.3, -0.7];

function syntheticTree(o: TreeOpts = {}): P[] {
  const r = rng(o.seed ?? 7);
  const pts: P[] = [];
  // Ground plane, 10 × 10 m, 1 cm noise.
  for (let i = 0; i < 20_000; i++) pts.push([r() * 10 - 5, r() * 10 - 5, gauss(r, 0.01)]);
  // Trunk: radius 0.2 m (DBH 40 cm), 0–5.5 m, 5 mm radial noise.
  if (o.trunk !== false) {
    const arc = ((o.arcDeg ?? 360) * Math.PI) / 180;
    const tilt = Math.tan(((o.leanDeg ?? 0) * Math.PI) / 180);
    for (let i = 0; i < 20_000; i++) {
      const h = r() * 5.5;
      const th = -arc / 2 + r() * arc;
      const rad = 0.2 + gauss(r, 0.005);
      pts.push([STEM[0] + rad * Math.cos(th) + h * tilt, STEM[1] + rad * Math.sin(th), h]);
    }
  }
  // Crown: ellipsoid shell 6 m wide, 5–9 m high, 2 cm noise.
  for (let i = 0; i < 20_000; i++) {
    const d = [gauss(r, 1), gauss(r, 1), gauss(r, 1)];
    const len = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
    pts.push([
      STEM[0] + (3 * d[0]!) / len + gauss(r, 0.02),
      STEM[1] + (3 * d[1]!) / len + gauss(r, 0.02),
      7 + (2 * d[2]!) / len + gauss(r, 0.02),
    ]);
  }
  return pts;
}

/** Z-up → ARKit Y-up (x, z, -y). */
function toYUp(pts: P[]): P[] {
  return pts.map(([x, y, z]) => [x, z, -y]);
}

// ─── Encoders ────────────────────────────────────────────────────────────────

const enc = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function asciiPly(pts: P[], comment = ''): Uint8Array {
  const head =
    `ply\nformat ascii 1.0\n${comment ? `comment ${comment}\n` : ''}element vertex ${pts.length}\n` +
    'property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n' +
    'element face 1\nproperty list uchar int vertex_indices\nend_header\n';
  const body = pts.map((p) => `${p[0].toFixed(5)} ${p[1].toFixed(5)} ${p[2].toFixed(5)} 90 120 60`).join('\n');
  return enc(`${head}${body}\n3 0 1 2\n`);
}

/** Binary PLY with extra properties around x/y/z (incl. a list) and a face
 *  element after the vertices, so skipping by type size is exercised. */
function binaryPly(pts: P[], le: boolean, coord: 'float' | 'double'): Uint8Array {
  const head = enc(
    `ply\nformat ${le ? 'binary_little_endian' : 'binary_big_endian'} 1.0\ncomment synthetic\n` +
      `element vertex ${pts.length}\nproperty ushort flag\nproperty ${coord} x\nproperty ${coord} y\nproperty ${coord} z\n` +
      'property list uchar short extra\nproperty uchar alpha\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n',
  );
  const cs = coord === 'float' ? 4 : 8;
  const rec = 2 + 3 * cs + 1 + 2 * 2 + 1;
  const buf = new Uint8Array(pts.length * rec + 2 * (1 + 3 * 4));
  const dv = new DataView(buf.buffer);
  let o = 0;
  for (const p of pts) {
    dv.setUint16(o, 7, le);
    o += 2;
    for (const v of p) {
      if (cs === 4) dv.setFloat32(o, v, le);
      else dv.setFloat64(o, v, le);
      o += cs;
    }
    dv.setUint8(o, 2);
    dv.setInt16(o + 1, -1, le);
    dv.setInt16(o + 3, 1, le);
    o += 5;
    dv.setUint8(o, 255);
    o += 1;
  }
  for (let f = 0; f < 2; f++) {
    dv.setUint8(o, 3);
    o += 1;
    for (let k = 0; k < 3; k++) {
      dv.setInt32(o, k, le);
      o += 4;
    }
  }
  return concat([head, buf]);
}

function xyzText(pts: P[], sep: string, header = ''): Uint8Array {
  return enc(header + pts.map((p) => p.map((v) => v.toFixed(5)).join(sep)).join('\n') + '\n');
}

interface LasOpts {
  minor?: 2 | 4;
  format?: 0 | 6;
  offset?: P;
  formatByte?: number;
  wkt?: string;
}

/** Hand-built LAS: 1.2 point format 0 by default, or 1.4 format 6 with the
 *  legacy count left 0 so the 64-bit count must be read. */
function las(pts: P[], o: LasOpts = {}): Uint8Array {
  const minor = o.minor ?? 2;
  const fmt = o.format ?? 0;
  const headerSize = minor === 4 ? 375 : 227;
  const recLen = fmt === 0 ? 20 : 30;
  const vlr = o.wkt ? enc(o.wkt) : null;
  const vlrBytes = vlr ? 54 + vlr.length : 0;
  const pointOffset = headerSize + vlrBytes;
  const buf = new Uint8Array(pointOffset + pts.length * recLen);
  const dv = new DataView(buf.buffer);
  buf.set(enc('LASF'), 0);
  dv.setUint8(24, 1);
  dv.setUint8(25, minor);
  dv.setUint16(94, headerSize, true);
  dv.setUint32(96, pointOffset, true);
  dv.setUint32(100, vlr ? 1 : 0, true);
  dv.setUint8(104, o.formatByte ?? fmt);
  dv.setUint16(105, recLen, true);
  dv.setUint32(107, minor === 4 ? 0 : pts.length, true);
  const off = o.offset ?? [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    dv.setFloat64(131 + a * 8, 0.001, true);
    dv.setFloat64(155 + a * 8, off[a]!, true);
  }
  if (minor === 4) dv.setBigUint64(247, BigInt(pts.length), true);
  if (vlr) {
    const v = headerSize;
    buf.set(enc('LASF_Projection'), v + 2);
    dv.setUint16(v + 18, 2112, true);
    dv.setUint16(v + 20, vlr.length, true);
    buf.set(vlr, v + 54);
  }
  pts.forEach((p, i) => {
    const r = pointOffset + i * recLen;
    for (let a = 0; a < 3; a++) dv.setInt32(r + a * 4, Math.round((p[a]! - off[a]!) / 0.001), true);
  });
  return buf;
}

function ok(r: ParseResult): ParsedCloud {
  if (!r.ok) throw new Error(`refused: ${r.reason} — ${r.detail}`);
  return r;
}

function expectTree(cloud: ParsedCloud, opts: { units?: 'm' | 'unknown' } = {}): void {
  const m = measureTree(cloud.points, { upAxis: cloud.upAxis.axis, units: opts.units ?? cloud.units });
  expect(m.dbhCm).not.toBeNull();
  expect(Math.abs(m.dbhCm! - 40)).toBeLessThanOrEqual(3);
  expect(Math.abs(m.heightM! - 9)).toBeLessThanOrEqual(0.3);
  expect(Math.abs(m.crownSpreadM! - 6)).toBeLessThanOrEqual(0.5);
}

const TREE = syntheticTree();
const TREE_Y = toYUp(TREE);

// ─── Parse round-trips ───────────────────────────────────────────────────────

describe('parsePointCloud — formats round-trip (R25)', () => {
  it('ascii PLY (Y-up, with a face element after the vertices)', () => {
    const c = ok(parsePointCloud(asciiPly(TREE_Y), 'scan.ply'));
    expect(c.format).toBe('ply_ascii');
    expect(c.count).toBe(TREE.length);
    expect(c.upAxis.axis).toBe('y');
    expect(c.upAxis.source).toBe('format');
    expect(c.units).toBe('unknown');
    expectTree(c);
  });

  it('binary little-endian PLY, float, extra props and a list skipped by type size', () => {
    const c = ok(parsePointCloud(binaryPly(TREE_Y, true, 'float'), 'scan.ply'));
    expect(c.format).toBe('ply_binary_le');
    expect(c.count).toBe(TREE.length);
    expect(c.points[0]).toBeCloseTo(TREE_Y[0]![0], 5);
    expect(c.points[2]).toBeCloseTo(TREE_Y[0]![2], 5);
    expectTree(c);
  });

  it('binary big-endian PLY with double coordinates', () => {
    const c = ok(parsePointCloud(binaryPly(TREE_Y, false, 'double'), 'scan.ply'));
    expect(c.format).toBe('ply_binary_be');
    expect(c.count).toBe(TREE.length);
    expect(c.points[1]).toBeCloseTo(TREE_Y[0]![1], 5);
    expectTree(c);
  });

  it('XYZ comma-separated with a header row, and PTS with a count line and extra columns', () => {
    const xyz = ok(parsePointCloud(xyzText(TREE_Y, ',', 'x,y,z\n'), 'scan.xyz'));
    expect(xyz.format).toBe('xyz');
    expect(xyz.count).toBe(TREE.length);
    expect(xyz.notes.join(' ')).toMatch(/header row/);
    expectTree(xyz);

    const ptsBody = TREE_Y.map((p) => `${p.map((v) => v.toFixed(5)).join(' ')} 12 200 180 90`).join('\n');
    const pts = ok(parsePointCloud(enc(`${TREE_Y.length}\n${ptsBody}\n`), 'scan.pts'));
    expect(pts.count).toBe(TREE.length);
    expect(pts.notes.join(' ')).not.toMatch(/declared/);
  });

  it('LAS 1.2 point format 0: scale and offset applied, Z-up', () => {
    const c = ok(parsePointCloud(las(TREE), 'scan.las'));
    expect(c.format).toBe('las');
    expect(c.count).toBe(TREE.length);
    expect(c.upAxis.axis).toBe('z');
    expect(c.points[0]).toBeCloseTo(TREE[0]![0], 3);
    expectTree(c);
  });

  it('LAS 1.4 point format 6 reads the 64-bit count when the legacy count is 0', () => {
    const c = ok(parsePointCloud(las(TREE, { minor: 4, format: 6 }), 'scan.las'));
    expect(c.count).toBe(TREE.length);
    expectTree(c);
  });

  it('geo-referenced LAS is re-centred (float32 precision) and still measures right', () => {
    const geo = TREE.map(([x, y, z]) => [x + 402_000, y + 4_080_000, z + 3] as P);
    const c = ok(parsePointCloud(las(geo, { offset: [402_000, 4_080_000, 0] }), 'geo.las'));
    expect(c.origin[0]).toBeGreaterThan(400_000);
    expect(c.notes.join(' ')).toMatch(/re-centred/);
    expectTree(c, { units: 'm' });
  });

  it('LAS units: a metre WKT says metres; a foot WKT is flagged and left unknown', () => {
    const m = ok(parsePointCloud(las(TREE.slice(0, 500), { wkt: 'PROJCS["x",UNIT["metre",1]]' }), 'a.las'));
    expect(m.units).toBe('m');
    const ft = ok(parsePointCloud(las(TREE.slice(0, 500), { wkt: 'PROJCS["x",UNIT["US survey foot",0.3048]]' }), 'b.las'));
    expect(ft.units).toBe('unknown');
    expect(ft.notes.join(' ')).toMatch(/FEET/);
  });

  it('caps the cloud with uniform decimation and says so', () => {
    const c = ok(parsePointCloud(las(TREE), 'scan.las', { maxPoints: 1000 }));
    expect(c.count).toBeLessThanOrEqual(1000);
    expect(c.sourceCount).toBe(TREE.length);
    expect(c.notes.join(' ')).toMatch(/uniform decimation/);
  });
});

// ─── Named refusals (§1B) ────────────────────────────────────────────────────

describe('parsePointCloud — every refusal is named', () => {
  const reason = (r: ParseResult): string => (r.ok ? 'ok' : r.reason);

  it('empty file, empty cloud, garbage', () => {
    expect(reason(parsePointCloud(new Uint8Array(0), 'x.ply'))).toBe('empty_file');
    const empty = enc('ply\nformat ascii 1.0\nelement vertex 0\nproperty float x\nproperty float y\nproperty float z\nend_header\n');
    expect(reason(parsePointCloud(empty, 'x.ply'))).toBe('empty_cloud');
    const garbage = new Uint8Array(512).map((_, i) => (i * 37 + 3) % 256);
    expect(reason(parsePointCloud(garbage, 'mystery.bin'))).toBe('unknown_format');
    expect(reason(parsePointCloud(enc('hello world\nno numbers here\n'), 'notes.txt'))).toBe('xyz_no_numeric_rows');
  });

  it('PLY header problems', () => {
    expect(reason(parsePointCloud(enc('ply\nformat ascii 1.0\nelement vertex 3\n'), 'x.ply'))).toBe('ply_header_unreadable');
    expect(reason(parsePointCloud(enc('not a ply'), 'x.ply'))).toBe('ply_header_unreadable');
    const noXyz = enc('ply\nformat ascii 1.0\nelement vertex 1\nproperty float a\nend_header\n1\n');
    expect(reason(parsePointCloud(noXyz, 'x.ply'))).toBe('ply_missing_xyz');
    const splat = enc(
      'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\n' +
        'property float opacity\nproperty float scale_0\nend_header\n0 0 0 1 1\n',
    );
    expect(reason(parsePointCloud(splat, 'splat.ply'))).toBe('ply_gaussian_splat_not_point_cloud');
  });

  it('a truncated binary PLY or LAS is refused, not half-measured', () => {
    const full = binaryPly(TREE_Y.slice(0, 200), true, 'float');
    expect(reason(parsePointCloud(full.subarray(0, full.length - 100), 'x.ply'))).toBe('ply_truncated');
    const l = las(TREE.slice(0, 200));
    expect(reason(parsePointCloud(l.subarray(0, l.length - 10), 'x.las'))).toBe('las_truncated');
  });

  it('LAZ is refused by name — by extension and by the compressed format bit', () => {
    expect(reason(parsePointCloud(las(TREE.slice(0, 10)), 'scan.laz'))).toBe('las_compressed_laz_not_supported');
    expect(reason(parsePointCloud(las(TREE.slice(0, 10), { formatByte: 0x80 }), 'scan.las'))).toBe(
      'las_compressed_laz_not_supported',
    );
  });

  it('meshes and unsupported cloud formats are named', () => {
    expect(reason(parsePointCloud(enc('glTF'), 'scan.glb'))).toBe('mesh_not_point_cloud');
    expect(reason(parsePointCloud(enc('x'), 'scan.e57'))).toBe('unsupported_format');
  });
});

// ─── Up axis ─────────────────────────────────────────────────────────────────

describe('up axis: Y-up vs Z-up', () => {
  it('a Z-up PLY is caught by its ground layer, and measures the same', () => {
    const c = ok(parsePointCloud(asciiPly(TREE), 'zup.ply'));
    expect(c.upAxis.axis).toBe('z');
    expect(c.upAxis.source).toBe('data');
    expectTree(c);
  });

  it('a person can override the guess', () => {
    const c = ok(parsePointCloud(asciiPly(TREE_Y), 'scan.ply', { upAxis: 'z' }));
    expect(c.upAxis).toMatchObject({ axis: 'z', source: 'override' });
  });

  it('the same tree measures the same in Y-up and Z-up', () => {
    const y = measureTree(ok(parsePointCloud(binaryPly(TREE_Y, true, 'float'), 'y.ply')).points, { upAxis: 'y' });
    const z = measureTree(ok(parsePointCloud(las(TREE), 'z.las')).points, { upAxis: 'z' });
    expect(Math.abs(y.dbhCm! - z.dbhCm!)).toBeLessThan(0.5);
    expect(Math.abs(y.heightM! - z.heightM!)).toBeLessThan(0.05);
  });
});

// ─── Measurement ─────────────────────────────────────────────────────────────

describe('measureTree (R25 — decision support)', () => {
  const flat = (pts: P[]): Float32Array => Float32Array.from(pts.flat());

  it('full walk-around: DBH good, height and crown flagged low (beyond clean range)', () => {
    const m = measureTree(flat(TREE), { upAxis: 'z', units: 'm', now: new Date('2026-09-28T12:00:00Z') });
    expect(Math.abs(m.dbhCm! - 40)).toBeLessThanOrEqual(3);
    expect(m.dbhFit!.arcCoverageDeg).toBeGreaterThan(300);
    expect(m.dbhFit!.rmseCm).toBeLessThan(1.5);
    expect(m.confidence.dbh.level).toBe('good');
    expect(m.confidence.height.level).toBe('low');
    expect(m.confidence.crown.level).toBe('low');
    expect(m.warnings).toContain('height exceeds phone LiDAR clean range (~4 m); treat as a minimum');
    expect(m.crownAxesM!.minor).toBeGreaterThan(5.5);
    expect(Math.abs(m.leanDeg!)).toBeLessThan(1.5);
    expect(m.measuredAt).toBe('2026-09-28T12:00:00.000Z');
    expect(m.warnings.join(' ')).not.toMatch(/UNITS NOT CONFIRMED/);
  });

  it('half-arc stem: warns the DBH may be underestimated and drops confidence', () => {
    const m = measureTree(flat(syntheticTree({ arcDeg: 150 })), { upAxis: 'z', units: 'm' });
    expect(m.dbhFit!.arcCoverageDeg).toBeLessThan(180);
    expect(m.warnings.some((w) => w.startsWith('partial stem arc < 180°'))).toBe(true);
    expect(m.confidence.dbh.level).toBe('low');
    expect(Math.abs(m.dbhCm! - 40)).toBeLessThanOrEqual(3);
  });

  it('reads a leaning stem', () => {
    const m = measureTree(flat(syntheticTree({ leanDeg: 8 })), { upAxis: 'z', units: 'm' });
    expect(Math.abs(m.leanDeg! - 8)).toBeLessThanOrEqual(1.5);
  });

  it('§1B: no trunk in the scan → DBH and lean null + unreadable with a named reason, never 0', () => {
    const m = measureTree(flat(syntheticTree({ trunk: false })), { upAxis: 'z', units: 'm' });
    expect(m.dbhCm).toBeNull();
    expect(m.leanDeg).toBeNull();
    expect(m.confidence.dbh.level).toBe('unreadable');
    expect(m.confidence.dbh.reason).toMatch(/^stem_not_found/);
    expect(m.confidence.lean.level).toBe('unreadable');
  });

  it('§1B: an empty cloud is unreadable everywhere, not a row of zeros', () => {
    const m = measureTree(new Float32Array(0), { upAxis: 'z', units: 'm' });
    expect([m.heightM, m.crownSpreadM, m.dbhCm, m.leanDeg]).toEqual([null, null, null, null]);
    expect(Object.values(m.confidence).every((c) => c.level === 'unreadable')).toBe(true);
  });

  it('unknown units: warns loudly (first) and still computes', () => {
    const m = measureTree(flat(TREE), { upAxis: 'z' });
    expect(m.warnings[0]).toMatch(/^UNITS NOT CONFIRMED/);
    expect(m.dbhCm).not.toBeNull();
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

describe('summarizeTreeMeasurement', () => {
  const FORBIDDEN = /\b(diseased?|dead|dying|decay(ed)?|rot(ten)?|hazard(ous)?|unsafe|risk|price[sd]?|cost|quote)\b|\$/i;

  it('one paragraph with confidence words and the sign-off; no price or diagnosis words', () => {
    const m = measureTree(Float32Array.from(syntheticTree({ arcDeg: 150 }).flat()), { upAxis: 'z' });
    const s = summarizeTreeMeasurement(m);
    expect(s).not.toMatch(/\n/);
    expect(s).toMatch(/low confidence/);
    expect(s).toMatch(/Trunk diameter at breast height/);
    expect(s.endsWith(SIGN_OFF)).toBe(true);
    expect(SIGN_OFF).toBe("Decision support — a person confirms before it's used.");
    expect(s).not.toMatch(FORBIDDEN);
  });

  it('an unreadable metric is said out loud, not shown as zero', () => {
    const m = measureTree(Float32Array.from(syntheticTree({ trunk: false }).flat()), { upAxis: 'z', units: 'm' });
    const s = summarizeTreeMeasurement(m);
    expect(s).toMatch(/Trunk diameter at breast height could not be read \(stem_not_found/);
    expect(s).not.toMatch(/\b0 cm\b/);
    expect(s).not.toMatch(FORBIDDEN);
  });
});

describe('parsePointCloud — hostile headers', () => {
  it('an empty element with a huge count before the vertices does not stall the parser', () => {
    const head = enc(
      'ply\nformat binary_little_endian 1.0\nelement junk 999999999999\n' +
        'element vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n',
    );
    const t0 = Date.now();
    const r = parsePointCloud(concat([head, new Uint8Array(12)]), 'x.ply');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.ok && r.count).toBe(1);
  });
});
