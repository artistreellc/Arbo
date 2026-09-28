// R25 desks (Mike, 2026-09-28): the public-works & permits knowledge base.
// Pure request → result functions so server.ts stays a list of one-line
// routes, the same shape as api.ts. Every route here is READ-ONLY.

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
