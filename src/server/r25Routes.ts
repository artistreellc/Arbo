// R25 desks (Mike, 2026-09-28): the public-works & permits knowledge base
// and the LiDAR measure.
// Pure request → result functions so server.ts stays a list of one-line
// routes, the same shape as api.ts. Every route here is READ-ONLY.

import type { IncomingMessage } from 'node:http';
import { parsePointCloud, type UpAxis } from '../lidar/parse.js';
import { measureTree } from '../lidar/measure.js';
import { summarizeTreeMeasurement, SIGN_OFF } from '../lidar/summary.js';
import { SERVICE_CITIES, type ServiceCity } from '../lib/address.js';
import { FACTS } from '../permitting/publicWorks/facts.js';
import { factsFor, jobChecklist, stale, summary, type JobInput, type Maybe } from '../permitting/publicWorks/query.js';

export interface RouteResult {
  status: number;
  body: unknown;
}

function isCity(v: unknown): v is ServiceCity {
  return typeof v === 'string' && (SERVICE_CITIES as readonly string[]).includes(v);
}

/** GET /api/permits/db?city=… — the handcrafted facts, with what needs re-checking. */
export function permitsDb(city: string | null, today = new Date()): RouteResult {
  if (city !== null && !isCity(city)) return { status: 400, body: { error: 'unknown_city', cities: SERVICE_CITIES } };
  const facts = city ? [...factsFor(city), ...factsFor('Regional'), ...factsFor('Virginia')] : [...FACTS];
  return {
    status: 200,
    body: {
      cities: SERVICE_CITIES,
      summary: summary(),
      facts,
      // A fact past its check date is still shown — marked, never hidden.
      stale: stale(facts, today).map((f) => f.id),
    },
  };
}

// 'unknown' is an answer in its own right: a question nobody answered must
// come back as REVIEW NEEDED, never be read as "no" (§1B).
function maybe(v: unknown): Maybe | null {
  if (v === true || v === false || v === 'unknown') return v;
  return null;
}

/** POST /api/permits/checklist — the ordered job checklist for one site. */
export function permitsChecklist(body: Record<string, unknown>): RouteResult {
  if (!isCity(body.city)) return { status: 400, body: { error: 'unknown_city', cities: SERVICE_CITIES } };
  const inRpa = maybe(body.inRpa ?? 'unknown');
  const nearPowerLines = maybe(body.nearPowerLines ?? 'unknown');
  const inRightOfWay = maybe(body.inRightOfWay ?? 'unknown');
  const historicDistrict = maybe(body.historicDistrict ?? 'unknown');
  if (inRpa === null || nearPowerLines === null || inRightOfWay === null || historicDistrict === null) {
    return { status: 400, body: { error: 'answers_are_yes_no_or_unknown' } };
  }
  const input: JobInput = {
    city: body.city,
    inRpa,
    nearPowerLines,
    inRightOfWay,
    historicDistrict,
    stumpGrinding: body.stumpGrinding === true,
    haulingDebris: body.haulingDebris === true,
    burning: body.burning === true,
  };
  return { status: 200, body: { input, items: jobChecklist(input) } };
}

// ---------------------------------------------------------------------------
// R25 LiDAR: measure a tree from a scan a LiDAR app exported (PLY / LAS / XYZ).
// A web page cannot read the iPhone's LiDAR sensor itself; Polycam, 3d Scanner
// App, SiteScape or Scaniverse capture, Arbo measures. Nothing is stored — the
// file is read in memory and the numbers go back to the phone.

/** A phone scan export is rarely over ~40 MB; past this the upload is refused by name. */
export const LIDAR_MAX_BYTES = 60 * 1024 * 1024;
/**
 * Measuring runs on the server's one thread. 1.5M points measures in under a
 * second; a bigger cloud is thinned evenly first, and the notes say so.
 */
export const LIDAR_ENDPOINT_MAX_POINTS = 1_500_000;

export class TooLargeError extends Error {}

export async function readBytes(req: IncomingMessage, max: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new TooLargeError('file_too_large');
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** POST /api/lidar/measure?name=scan.ply&up=y|z — raw file bytes in the body. */
export function lidarMeasure(bytes: Uint8Array, name: string | null, up: string | null): RouteResult {
  if (!name) return { status: 400, body: { error: 'filename_required', detail: 'Send the file name so Arbo can tell PLY, LAS and XYZ apart.' } };
  const upAxis: UpAxis | undefined = up === 'y' || up === 'z' ? up : undefined;
  const cloud = parsePointCloud(bytes, name, { upAxis, maxPoints: LIDAR_ENDPOINT_MAX_POINTS });
  if (!cloud.ok) return { status: 422, body: { error: cloud.reason, detail: cloud.detail } };
  const m = measureTree(cloud.points, { upAxis: cloud.upAxis.axis, units: cloud.units });
  return {
    status: 200,
    body: {
      file: { name, format: cloud.format, points: cloud.count, sourcePoints: cloud.sourceCount, units: cloud.units, upAxis: cloud.upAxis, notes: cloud.notes },
      measurement: m,
      summary: summarizeTreeMeasurement(m),
      signOff: SIGN_OFF,
    },
  };
}
