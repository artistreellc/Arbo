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
// LIDAR POINT-CLOUD IMPORT — owner ruling R25 (Mike, 2026-09-28): the app is
// to be "compatible to connect to lidar".
//
// What that can honestly mean (docs/research/R25_permits_lidar_pwa.md, part B;
// docs/BUILD_R25.md "LiDAR"): a web page CANNOT read the iPhone LiDAR sensor —
// iOS Safari exposes no depth API. The scan is taken in a native app (Polycam,
// 3d Scanner App, SiteScape, Scaniverse), EXPORTED as a point cloud, and this
// file reads that export. Supported: PLY (ascii, binary little/big endian),
// LAS 1.0–1.4 point formats 0–10, and XYZ / PTS / TXT / CSV text.
//
// Brief §6X holds: no AR capture, no photogrammetry, no cut-count model. This
// file only turns bytes into xyz points.
//
// §1B: every refusal is NAMED. "We could not read this file" is never
// rendered as an empty cloud, and an empty cloud is its own named refusal.
// A file that is shorter than its own header says is TRUNCATED and refused —
// measuring a half-uploaded scan would give a confident wrong number.

export type UpAxis = 'y' | 'z';
export type PointCloudFormat = 'ply_ascii' | 'ply_binary_le' | 'ply_binary_be' | 'las' | 'xyz';
export type Units = 'm' | 'unknown';

export interface UpAxisGuess {
  axis: UpAxis;
  /** Plain words: why this axis. */
  reason: string;
  /** 'override' = a person set it; 'format' = the file type's convention;
   *  'data' = the ground layer in the points contradicted the convention. */
  source: 'override' | 'format' | 'data';
}

export interface ParsedCloud {
  ok: true;
  /** xyz interleaved, metres if `units` is 'm', relative to `origin`. */
  points: Float32Array;
  /** Points kept (after decimation and after dropping non-finite rows). */
  count: number;
  /** Points the file declared / contained before decimation. */
  sourceCount: number;
  format: PointCloudFormat;
  units: Units;
  upAxis: UpAxisGuess;
  /** Subtracted from every point to keep float32 precision on geo-referenced
   *  files. [0,0,0] for ordinary phone scans. Real coordinate = point + origin. */
  origin: [number, number, number];
  notes: string[];
}

export type ParseRefusalReason =
  | 'empty_file'
  | 'empty_cloud'
  | 'unknown_format'
  | 'unsupported_format'
  | 'mesh_not_point_cloud'
  | 'ply_header_unreadable'
  | 'ply_no_vertex_element'
  | 'ply_missing_xyz'
  | 'ply_truncated'
  | 'ply_gaussian_splat_not_point_cloud'
  | 'las_header_unreadable'
  | 'las_unsupported_version'
  | 'las_unsupported_point_format'
  | 'las_compressed_laz_not_supported'
  | 'las_truncated'
  | 'xyz_no_numeric_rows';

export interface ParseRefusal {
  ok: false;
  reason: ParseRefusalReason;
  /** One plain sentence for a person: what is wrong and what to export instead. */
  detail: string;
}

export type ParseResult = ParsedCloud | ParseRefusal;

export interface ParseOptions {
  /** A person's override of the up axis. Wins over every guess. */
  upAxis?: UpAxis;
  /** Point cap; defaults to MAX_POINTS. Exposed for tests. */
  maxPoints?: number;
}

/** Above this the cloud is uniformly decimated (every k-th point kept). */
export const MAX_POINTS = 5_000_000;

/** Coordinates larger than this (geo-referenced files) are re-centred so
 *  float32 keeps millimetre precision. */
const RECENTRE_ABOVE = 10_000;

const EXPORT_HINT = 'Export the scan as PLY, LAS, XYZ or PTS from the scanner app.';

function refuse(reason: ParseRefusalReason, detail: string): ParseRefusal {
  return { ok: false, reason, detail };
}

// ─── Point sink: decimation, re-centring and non-finite rows in one place ───

class PointSink {
  /** Share of source points kept: 1, or maxPoints / expected when over the cap. */
  private readonly ratio: number;
  private readonly maxPoints: number;
  private readonly buf: Float32Array;
  private n = 0;
  private seen = 0;
  private originSet = false;
  origin: [number, number, number] = [0, 0, 0];
  nonFinite = 0;

  constructor(expected: number, maxPoints: number) {
    this.maxPoints = maxPoints;
    this.ratio = expected > maxPoints ? maxPoints / expected : 1;
    this.buf = new Float32Array((Math.ceil(Math.max(expected, 0) * this.ratio) + 1) * 3);
  }

  /** Call once per source point, in file order. True = keep this one.
   *  Keeps evenly spaced points, so an over-cap cloud lands on the cap. */
  take(): boolean {
    const keep = this.ratio === 1 || Math.floor((this.seen + 1) * this.ratio) > Math.floor(this.seen * this.ratio);
    this.seen++;
    return keep;
  }

  push(x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      this.nonFinite++;
      return;
    }
    if (!this.originSet) {
      this.originSet = true;
      const big = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > RECENTRE_ABOVE;
      if (big) this.origin = [Math.round(x), Math.round(y), Math.round(z)];
    }
    if (this.n * 3 >= this.buf.length) return;
    const o = this.n * 3;
    this.buf[o] = x - this.origin[0];
    this.buf[o + 1] = y - this.origin[1];
    this.buf[o + 2] = z - this.origin[2];
    this.n++;
  }

  get count(): number {
    return this.n;
  }

  get sourceSeen(): number {
    return this.seen;
  }

  points(): Float32Array {
    return this.n * 3 === this.buf.length ? this.buf : this.buf.slice(0, this.n * 3);
  }

  notes(sourceCount: number): string[] {
    const out: string[] = [];
    if (this.ratio < 1) {
      out.push(
        `Cloud had ${sourceCount.toLocaleString('en-US')} points; kept ${this.n.toLocaleString('en-US')}, evenly spaced (uniform decimation), to stay within ${this.maxPoints.toLocaleString('en-US')}.`,
      );
    }
    if (this.nonFinite > 0) out.push(`${this.nonFinite} points had non-numeric coordinates and were dropped.`);
    if (this.origin.some((v) => v !== 0)) {
      out.push(`Geo-referenced coordinates were re-centred on [${this.origin.join(', ')}] to keep precision.`);
    }
    return out;
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const MESH_EXTENSIONS = new Set(['obj', 'fbx', 'gltf', 'glb', 'usdz', 'usd', 'stl', 'dae', '3mf']);
const OTHER_CLOUD_EXTENSIONS = new Set(['e57', 'pcd', 'rcp', 'rcs', 'spz', 'ptx']);
const TEXT_EXTENSIONS = new Set(['xyz', 'pts', 'txt', 'csv', 'asc']);

export function parsePointCloud(bytes: Uint8Array, filename: string, opts: ParseOptions = {}): ParseResult {
  const maxPoints = opts.maxPoints ?? MAX_POINTS;
  const ext = (filename.split('.').pop() ?? '').toLowerCase();

  if (bytes.length === 0) return refuse('empty_file', 'The file is empty.');
  if (ext === 'laz') {
    return refuse('las_compressed_laz_not_supported', 'LAZ (compressed LAS) is not read. Export uncompressed LAS instead.');
  }

  let result: ParseResult;
  let formatAxis: UpAxisGuess;
  if (startsWithAscii(bytes, 'ply') && (bytes[3] === 0x0a || bytes[3] === 0x0d)) {
    result = parsePly(bytes, maxPoints);
    formatAxis = {
      axis: 'y',
      source: 'format',
      reason: 'PLY exports from iPhone scanner apps (Polycam, 3d Scanner App) use ARKit coordinates, which are Y-up',
    };
  } else if (startsWithAscii(bytes, 'LASF')) {
    result = parseLas(bytes, maxPoints);
    formatAxis = { axis: 'z', source: 'format', reason: 'LAS files are Z-up by specification' };
  } else if (ext === 'ply') {
    return refuse('ply_header_unreadable', 'The file is named .ply but does not start with a PLY header.');
  } else if (ext === 'las') {
    return refuse('las_header_unreadable', 'The file is named .las but does not start with the LASF signature.');
  } else if (MESH_EXTENSIONS.has(ext)) {
    return refuse('mesh_not_point_cloud', `.${ext} is a mesh, not a point cloud. ${EXPORT_HINT}`);
  } else if (OTHER_CLOUD_EXTENSIONS.has(ext)) {
    return refuse('unsupported_format', `.${ext} is not read yet. ${EXPORT_HINT}`);
  } else if (TEXT_EXTENSIONS.has(ext) || looksLikeText(bytes)) {
    result = parseXyz(bytes, maxPoints);
    formatAxis = {
      axis: 'y',
      source: 'format',
      reason: 'text exports from iPhone scanner apps usually keep ARKit Y-up (not confirmed for every app)',
    };
  } else {
    return refuse('unknown_format', `The file is not a recognised point cloud. ${EXPORT_HINT}`);
  }

  if (!result.ok) return result;
  result.upAxis = opts.upAxis
    ? { axis: opts.upAxis, source: 'override', reason: 'set by the person measuring' }
    : guessUpAxis(result.points, formatAxis);
  return result;
}

// ─── Up axis ─────────────────────────────────────────────────────────────────

/** How thin the lowest layer of points is along one axis, as a share of the
 *  cloud's extent on that axis. A scanned ground plane makes this near 0 on
 *  the true up axis; along a horizontal axis it is roughly 0.1. */
function bottomLayerRatio(points: Float32Array, axis: number): number | null {
  const n = Math.floor(points.length / 3);
  if (n < 100) return null;
  const step = Math.max(1, Math.ceil(n / 200_000));
  const vals = new Float64Array(Math.ceil(n / step));
  let k = 0;
  for (let i = 0; i < n; i += step) vals[k++] = points[i * 3 + axis] ?? 0;
  const v = vals.subarray(0, k).sort();
  const q = (p: number): number => v[Math.floor(p * (k - 1))] ?? 0;
  const extent = q(0.99) - q(0.01);
  if (!(extent > 0)) return null;
  return (q(0.1) - q(0.01)) / extent;
}

/** Keep the format's convention unless the ground layer in the data clearly
 *  says otherwise. Exported so the measure step can reuse it. */
export function guessUpAxis(points: Float32Array, formatDefault: UpAxisGuess): UpAxisGuess {
  const d = formatDefault.axis;
  const other: UpAxis = d === 'y' ? 'z' : 'y';
  const rd = bottomLayerRatio(points, d === 'y' ? 1 : 2);
  const ro = bottomLayerRatio(points, other === 'y' ? 1 : 2);
  if (ro !== null && ro < 0.03 && (rd === null || rd > 0.06)) {
    return {
      axis: other,
      source: 'data',
      reason: `the lowest points form a flat ground layer along ${other.toUpperCase()}, not ${d.toUpperCase()}, so the file looks ${other.toUpperCase()}-up (the usual convention, ${d.toUpperCase()}-up, did not fit)`,
    };
  }
  const check =
    rd !== null && rd < 0.03 ? 'the ground layer in the points agrees' : 'the points showed no clear ground layer to confirm it';
  return { ...formatDefault, reason: `${formatDefault.reason}; ${check}` };
}

// ─── PLY ─────────────────────────────────────────────────────────────────────

type PlyType = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64';

const PLY_TYPE_NAMES: Record<string, PlyType> = {
  char: 'i8', int8: 'i8', uchar: 'u8', uint8: 'u8',
  short: 'i16', int16: 'i16', ushort: 'u16', uint16: 'u16',
  int: 'i32', int32: 'i32', uint: 'u32', uint32: 'u32',
  float: 'f32', float32: 'f32', double: 'f64', float64: 'f64',
};

const PLY_SIZE: Record<PlyType, number> = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8 };

interface PlyProperty {
  name: string;
  type: PlyType;
  /** Set for `property list <countType> <itemType> name`; `type` is then the item type. */
  countType?: PlyType;
}

interface PlyElement {
  name: string;
  count: number;
  props: PlyProperty[];
}

function readScalar(dv: DataView, off: number, t: PlyType, le: boolean): number {
  switch (t) {
    case 'i8': return dv.getInt8(off);
    case 'u8': return dv.getUint8(off);
    case 'i16': return dv.getInt16(off, le);
    case 'u16': return dv.getUint16(off, le);
    case 'i32': return dv.getInt32(off, le);
    case 'u32': return dv.getUint32(off, le);
    case 'f32': return dv.getFloat32(off, le);
    case 'f64': return dv.getFloat64(off, le);
  }
}

function parsePly(bytes: Uint8Array, maxPoints: number): ParseResult {
  const headText = latin1(bytes.subarray(0, Math.min(bytes.length, 65_536)));
  const end = /end_header[ \t]*\r?\n/.exec(headText);
  if (!end) return refuse('ply_header_unreadable', 'The PLY header never ends (no end_header line).');
  const dataStart = end.index + end[0].length;
  const lines = headText.slice(0, end.index).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let format: PointCloudFormat | null = null;
  const elements: PlyElement[] = [];
  const comments: string[] = [];
  for (const line of lines.slice(1)) {
    const t = line.split(/\s+/);
    if (t[0] === 'format') {
      if (t[1] === 'ascii') format = 'ply_ascii';
      else if (t[1] === 'binary_little_endian') format = 'ply_binary_le';
      else if (t[1] === 'binary_big_endian') format = 'ply_binary_be';
      else return refuse('ply_header_unreadable', `Unknown PLY format "${t[1] ?? ''}".`);
    } else if (t[0] === 'comment' || t[0] === 'obj_info') {
      comments.push(line);
    } else if (t[0] === 'element') {
      const count = Number(t[2]);
      if (!t[1] || !Number.isInteger(count) || count < 0) {
        return refuse('ply_header_unreadable', `Bad element line "${line}".`);
      }
      elements.push({ name: t[1], count, props: [] });
    } else if (t[0] === 'property') {
      const el = elements[elements.length - 1];
      if (!el) return refuse('ply_header_unreadable', 'A PLY property appears before any element.');
      if (t[1] === 'list') {
        const countType = PLY_TYPE_NAMES[t[2] ?? ''];
        const itemType = PLY_TYPE_NAMES[t[3] ?? ''];
        if (!countType || !itemType || !t[4]) return refuse('ply_header_unreadable', `Bad list property "${line}".`);
        el.props.push({ name: t[4], type: itemType, countType });
      } else {
        const type = PLY_TYPE_NAMES[t[1] ?? ''];
        if (!type || !t[2]) return refuse('ply_header_unreadable', `Unknown PLY property type in "${line}".`);
        el.props.push({ name: t[2], type });
      }
    } else {
      return refuse('ply_header_unreadable', `Unrecognised PLY header line "${line}".`);
    }
  }
  if (!format) return refuse('ply_header_unreadable', 'The PLY header has no format line.');

  const vIndex = elements.findIndex((e) => e.name === 'vertex');
  const vertex = elements[vIndex];
  if (!vertex) return refuse('ply_no_vertex_element', 'The PLY file has no vertex element, so no points.');
  const axisOf = (name: string): number => vertex.props.findIndex((p) => p.name === name && !p.countType);
  const ix = axisOf('x');
  const iy = axisOf('y');
  const iz = axisOf('z');
  if (ix < 0 || iy < 0 || iz < 0) return refuse('ply_missing_xyz', 'The PLY vertex element has no x, y, z properties.');
  const names = new Set(vertex.props.map((p) => p.name));
  if (names.has('opacity') && (names.has('scale_0') || names.has('rot_0'))) {
    return refuse(
      'ply_gaussian_splat_not_point_cloud',
      'This PLY is a Gaussian-splat export, not a LiDAR point cloud. Export the point cloud (PLY or LAS) instead.',
    );
  }
  if (vertex.count === 0) return refuse('empty_cloud', 'The PLY file declares zero points.');

  const sink = new PointSink(vertex.count, maxPoints);
  // Elements before the vertices are skipped. One with no properties takes
  // no bytes, so it is dropped here rather than looped over (a hostile header
  // could declare billions of empty records).
  const before = elements.slice(0, vIndex).filter((e) => e.props.length > 0);
  const err =
    format === 'ply_ascii'
      ? readPlyAscii(bytes, dataStart, before, vertex, [ix, iy, iz], sink)
      : readPlyBinary(bytes, dataStart, format === 'ply_binary_le', before, vertex, [ix, iy, iz], sink);
  if (err) return err;
  if (sink.count === 0) return refuse('empty_cloud', 'No point in the PLY file had usable coordinates.');

  const notes = sink.notes(vertex.count);
  return {
    ok: true,
    points: sink.points(),
    count: sink.count,
    sourceCount: vertex.count,
    format,
    units: unitsFromText(comments.join('\n'), notes),
    upAxis: { axis: 'y', source: 'format', reason: '' },
    origin: sink.origin,
    notes,
  };
}

function readPlyBinary(
  bytes: Uint8Array,
  start: number,
  le: boolean,
  before: PlyElement[],
  vertex: PlyElement,
  xyz: [number, number, number],
  sink: PointSink,
): ParseRefusal | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.length;
  const truncated = refuse('ply_truncated', 'The PLY file ends before all its points (upload cut short?).');
  let off = start;

  // Walk one record; when `out` is given, store the xyz values into it.
  const walk = (el: PlyElement, out: number[] | null): boolean => {
    for (let p = 0; p < el.props.length; p++) {
      const prop = el.props[p]!;
      if (prop.countType) {
        const cs = PLY_SIZE[prop.countType];
        if (off + cs > len) return false;
        const c = readScalar(dv, off, prop.countType, le);
        // A negative or fractional count is a corrupt file — refuse, never
        // spin (a -1 count with 1-byte items would not move the cursor).
        if (!Number.isInteger(c) || c < 0) return false;
        off += cs + c * PLY_SIZE[prop.type];
      } else {
        const s = PLY_SIZE[prop.type];
        if (off + s > len) return false;
        if (out) {
          const a = p === xyz[0] ? 0 : p === xyz[1] ? 1 : p === xyz[2] ? 2 : -1;
          if (a >= 0) out[a] = readScalar(dv, off, prop.type, le);
        }
        off += s;
      }
    }
    return off <= len;
  };

  for (const el of before) {
    for (let i = 0; i < el.count; i++) if (!walk(el, null)) return truncated;
  }
  const v = [0, 0, 0];
  for (let i = 0; i < vertex.count; i++) {
    const keep = sink.take();
    if (!walk(vertex, keep ? v : null)) return truncated;
    if (keep) sink.push(v[0]!, v[1]!, v[2]!);
  }
  return null;
}

function readPlyAscii(
  bytes: Uint8Array,
  start: number,
  before: PlyElement[],
  vertex: PlyElement,
  xyz: [number, number, number],
  sink: PointSink,
): ParseRefusal | null {
  const text = latin1(bytes.subarray(start));
  const truncated = refuse('ply_truncated', 'The PLY file ends before all its points (upload cut short?).');
  const lines = lineReader(text);
  const skip = before.reduce((s, el) => s + el.count, 0);
  for (let i = 0; i < skip; i++) if (lines.next() === null) return truncated;

  const v = [0, 0, 0];
  for (let i = 0; i < vertex.count; i++) {
    const line = lines.next();
    if (line === null) return truncated;
    if (!sink.take()) continue;
    const tok = line.split(/\s+/);
    let k = 0;
    for (let p = 0; p < vertex.props.length; p++) {
      const prop = vertex.props[p]!;
      if (prop.countType) {
        k += 1 + Number(tok[k]);
        continue;
      }
      const a = p === xyz[0] ? 0 : p === xyz[1] ? 1 : p === xyz[2] ? 2 : -1;
      if (a >= 0) v[a] = tok[k] === undefined ? NaN : Number(tok[k]);
      k++;
    }
    sink.push(v[0]!, v[1]!, v[2]!);
  }
  return null;
}

// ─── LAS ─────────────────────────────────────────────────────────────────────

/** Minimum point record length per point data format 0–10 (ASPRS LAS 1.4 R15). */
const LAS_MIN_RECORD = [20, 28, 26, 34, 57, 63, 30, 36, 38, 59, 67];

function parseLas(bytes: Uint8Array, maxPoints: number): ParseResult {
  const len = bytes.length;
  if (len < 227) return refuse('las_header_unreadable', 'The LAS header is shorter than the 227 bytes every version needs.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = dv.getUint8(24);
  const minor = dv.getUint8(25);
  if (major !== 1 || minor > 4) {
    return refuse('las_unsupported_version', `LAS version ${major}.${minor} is not read (1.0–1.4 are).`);
  }
  const headerSize = dv.getUint16(94, true);
  const pointOffset = dv.getUint32(96, true);
  const vlrCount = dv.getUint32(100, true);
  const formatRaw = dv.getUint8(104);
  const recordLength = dv.getUint16(105, true);

  // LASzip marks compressed files by setting the high bits of the format id.
  if (formatRaw & 0xc0) {
    return refuse('las_compressed_laz_not_supported', 'This LAS file is LAZ-compressed. Export uncompressed LAS instead.');
  }
  const pointFormat = formatRaw & 0x3f;
  const minRecord = LAS_MIN_RECORD[pointFormat];
  if (minRecord === undefined) {
    return refuse('las_unsupported_point_format', `LAS point format ${pointFormat} is not read (0–10 are).`);
  }
  if (recordLength < minRecord) {
    return refuse('las_header_unreadable', `LAS point record length ${recordLength} is too short for format ${pointFormat}.`);
  }
  if (headerSize < 227 || pointOffset < headerSize) {
    return refuse('las_header_unreadable', 'The LAS header size or point-data offset is impossible.');
  }

  const sx = dv.getFloat64(131, true);
  const sy = dv.getFloat64(139, true);
  const sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true);
  const oy = dv.getFloat64(163, true);
  const oz = dv.getFloat64(171, true);
  if (![sx, sy, sz].every((s) => Number.isFinite(s) && s !== 0) || ![ox, oy, oz].every(Number.isFinite)) {
    return refuse('las_header_unreadable', 'The LAS scale or offset values are unusable.');
  }

  let count = dv.getUint32(107, true);
  if (minor >= 4 && headerSize >= 375 && len >= 255) {
    const big = Number(dv.getBigUint64(247, true));
    if (big > 0) count = big;
  }

  // Variable-length records: the LASzip marker and the linear unit.
  const vlr = readLasVlrs(bytes, dv, headerSize, pointOffset, vlrCount);
  if (vlr.laszip) {
    return refuse('las_compressed_laz_not_supported', 'This LAS file is LAZ-compressed. Export uncompressed LAS instead.');
  }
  if (count === 0) return refuse('empty_cloud', 'The LAS file declares zero points.');
  if (pointOffset + count * recordLength > len) {
    return refuse('las_truncated', 'The LAS file ends before all its points (upload cut short?).');
  }

  const sink = new PointSink(count, maxPoints);
  for (let i = 0; i < count; i++) {
    if (!sink.take()) continue;
    const off = pointOffset + i * recordLength;
    sink.push(
      dv.getInt32(off, true) * sx + ox,
      dv.getInt32(off + 4, true) * sy + oy,
      dv.getInt32(off + 8, true) * sz + oz,
    );
  }
  if (sink.count === 0) return refuse('empty_cloud', 'No point in the LAS file had usable coordinates.');

  const notes = sink.notes(count);
  let units: Units = 'unknown';
  if (vlr.unit === 'm') units = 'm';
  if (vlr.unit === 'ft') {
    notes.push('The LAS coordinate system is in FEET. Values were not converted; re-export in metres before measuring.');
  }
  return {
    ok: true,
    points: sink.points(),
    count: sink.count,
    sourceCount: count,
    format: 'las',
    units,
    upAxis: { axis: 'z', source: 'format', reason: '' },
    origin: sink.origin,
    notes,
  };
}

function readLasVlrs(
  bytes: Uint8Array,
  dv: DataView,
  headerSize: number,
  pointOffset: number,
  vlrCount: number,
): { laszip: boolean; unit: 'm' | 'ft' | null } {
  let laszip = false;
  let metre = false;
  let foot = false;
  let pos = headerSize;
  for (let i = 0; i < vlrCount && pos + 54 <= pointOffset; i++) {
    const userId = latin1(bytes.subarray(pos + 2, pos + 18)).replace(/\0+$/, '');
    const recordId = dv.getUint16(pos + 18, true);
    const size = dv.getUint16(pos + 20, true);
    const data = pos + 54;
    if (data + size > pointOffset) break;
    if (userId === 'laszip encoded') laszip = true;
    if (userId === 'LASF_Projection' && recordId === 2112) {
      const wkt = latin1(bytes.subarray(data, data + size));
      if (/foot|feet|ftUS/i.test(wkt)) foot = true;
      else if (/metre|meter/i.test(wkt)) metre = true;
    }
    if (userId === 'LASF_Projection' && recordId === 34735 && size >= 8) {
      // GeoKeyDirectory: 4-short header, then [keyId, location, count, value] entries.
      const keys = dv.getUint16(data + 6, true);
      for (let k = 0; k < keys && data + 8 + k * 8 + 8 <= data + size; k++) {
        const e = data + 8 + k * 8;
        const keyId = dv.getUint16(e, true);
        const value = dv.getUint16(e + 6, true);
        if (keyId === 3076 || keyId === 4099) {
          if (value === 9001) metre = true;
          if (value === 9002 || value === 9003) foot = true;
        }
      }
    }
    pos = data + size;
  }
  return { laszip, unit: foot ? 'ft' : metre ? 'm' : null };
}

// ─── XYZ / PTS / TXT / CSV ───────────────────────────────────────────────────

function parseXyz(bytes: Uint8Array, maxPoints: number): ParseResult {
  let newlines = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) newlines++;
  const text = latin1(bytes);
  const sink = new PointSink(newlines + 1, maxPoints);
  const lines = lineReader(text);
  let skipped = 0;
  let first = true;
  let declared: number | null = null;
  for (let line = lines.next(); line !== null; line = lines.next()) {
    if (line.startsWith('#') || line.startsWith('//')) continue;
    const tok = line.split(/[\s,;]+/);
    if (first && tok.length === 1 && /^\d+$/.test(tok[0] ?? '')) {
      declared = Number(tok[0]); // PTS: the first line is the point count.
      first = false;
      continue;
    }
    first = false;
    const x = Number(tok[0]);
    const y = Number(tok[1]);
    const z = Number(tok[2]);
    if (tok.length < 3 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      skipped++;
      continue;
    }
    if (sink.take()) sink.push(x, y, z);
  }
  if (sink.count === 0) {
    return skipped > 0
      ? refuse('xyz_no_numeric_rows', 'No row in the text file starts with three numbers (x y z).')
      : refuse('empty_cloud', 'The text file holds no points.');
  }
  const sourceCount = sink.sourceSeen;
  const notes = sink.notes(sourceCount);
  if (skipped > 0) notes.push(`${skipped} rows were not x y z numbers (e.g. a header row) and were skipped.`);
  if (declared !== null && declared !== sourceCount) {
    notes.push(`The PTS header declared ${declared} points; the file holds ${sourceCount}.`);
  }
  return {
    ok: true,
    points: sink.points(),
    count: sink.count,
    sourceCount,
    format: 'xyz',
    units: 'unknown',
    upAxis: { axis: 'y', source: 'format', reason: '' },
    origin: sink.origin,
    notes,
  };
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function latin1(b: Uint8Array): string {
  // One char per byte, so string offsets are byte offsets (the PLY header needs that).
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');
}

function startsWithAscii(b: Uint8Array, s: string): boolean {
  if (b.length < s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[i] !== s.charCodeAt(i)) return false;
  return true;
}

/** Printable ASCII and whitespace only, in the first 4 KB. */
function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4096);
  for (let i = 0; i < n; i++) {
    const c = b[i]!;
    if (c === 0x09 || c === 0x0a || c === 0x0d) continue;
    if (c < 0x20 || c > 0x7e) return false;
  }
  return n > 0;
}

/** Non-empty trimmed lines, one at a time, without splitting a 60 MB string. */
function lineReader(text: string): { next(): string | null } {
  let pos = 0;
  return {
    next(): string | null {
      while (pos < text.length) {
        let end = text.indexOf('\n', pos);
        if (end < 0) end = text.length;
        const line = text.slice(pos, end).trim();
        pos = end + 1;
        if (line) return line;
      }
      return null;
    },
  };
}

/** A PLY comment that states the unit. Metres only when it says so. */
function unitsFromText(text: string, notes: string[]): Units {
  if (/\b(feet|foot|ft)\b/i.test(text)) {
    notes.push('The file header mentions feet. Values were not converted; re-export in metres before measuring.');
    return 'unknown';
  }
  if (/\b(metres?|meters?)\b/i.test(text) || /\bunits?\s*[:=]?\s*m\b/i.test(text)) return 'm';
  return 'unknown';
}
