// Bouncie truck tracking (R31 — Mike, 2026-10-20: "why dont you build
// and then i add later"; amended the same day by his spec: Client ID
// arbo-app, the sign-in finishes at /api/bouncie/callback, the tokens are
// kept server-side in Supabase, a read-only pull of vehicles and trips, and
// location for him only, in working hours only). Built complete and DORMANT:
// nothing happens until Mike adds BOUNCIE_CLIENT_ID / BOUNCIE_CLIENT_SECRET
// on Railway, migration 0021 is applied, he sets ARBO_LINK_CREDENTIALS=live
// (his ruling on §3 — see src/db/credentialStore.ts), taps Connect Bouncie,
// adds BOUNCIE_WEBHOOK_KEY, and sets ARBO_LINK_BOUNCIE=live.
// Steps for Mike: docs/BOUNCIE.md.
//
// The rules this file keeps, each one structural:
//   - OWNER ONLY. Truck positions and trips are read by the owner routes and
//     nothing else; the crew door has no route to them (the policy engine
//     already walls 'tracking'/'bouncie' off every crew surface).
//   - READ ONLY. The one POST is the sign-in token swap; every other call is
//     a GET of /v1/vehicles or /v1/trips. `allowed()` refuses anything else
//     before it leaves the process — no webhook setup, no geo-zones, no settings.
//   - WORKING HOURS ONLY (brief §4.4; Mike 2026-09-21: 8am–8pm, every day but
//     Sunday). withinWorkingHours() in src/ops/locationIntel.ts is the ONE
//     clock: outside it Arbo reads nothing and holds nothing (tick() drops
//     what was held within a minute of 8pm, whether or not anyone asks), and
//     a report stamped outside it is never kept or shown, whenever it arrives.
//     "After hours" is NAMED — it never reads as "no trucks".
//   - A NAMED LINK that fails closed: positions are held and shown only when
//     ARBO_LINK_BOUNCIE is exactly 'live' (same rule as vendorLinks.ts). A
//     cut link is NAMED, never "no trucks" (§1B).
//   - MEMORY ONLY for positions and trips: the latest position per truck and
//     a minute's cache of a trips read, held in this process — no history.
//     A redeploy forgets them; Bouncie fills them back in.
//   - SECRETS stay server-side: the sign-in is kept in Supabase, sealed
//     (src/db/credentialStore.ts — Mike's "store the tokens server-side in
//     Supabase"), behind that door's own switch, ARBO_LINK_CREDENTIALS
//     (Mike, 2026-10-20: "Yes, allow the sign-in row" — set at deploy; still
//     fail-closed) — never in a response, never in a log. Logs carry counts
//     and the last 4 of a device id at most — never a coordinate, an
//     address, or a full VIN.
//   - KEPT ALIVE (Mike, 2026-10-20: "Keep the sign-in alive"): once a day,
//     whatever the hour, the minute tick swaps the refresh token and saves the
//     rotated pair — the token swap and nothing else (keepAlive()).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CredentialStore, credentialLinkOpen, type CredentialHttp, type CredentialProblem } from '../db/credentialStore.js';
import { withinWorkingHours } from '../ops/locationIntel.js';

export const AUTHORIZE_URL = 'https://auth.bouncie.com/dialog/authorize';
export const TOKEN_URL = 'https://auth.bouncie.com/oauth/token';
export const API_BASE = 'https://api.bouncie.dev/v1/';
const PUBLIC_ORIGIN = 'https://arbor-server-production.up.railway.app';
/**
 * Mike registers EXACTLY this redirect in the Bouncie portal (his spec,
 * 2026-10-20). The ONE place it is written: the authorize URL, the token
 * swap, the server's route (BOUNCIE_CALLBACK_PATH) and the Settings card all
 * read it from here.
 */
export const BOUNCIE_REDIRECT = `${PUBLIC_ORIGIN}/api/bouncie/callback`;
export const BOUNCIE_CALLBACK_PATH = new URL(BOUNCIE_REDIRECT).pathname;
/** The first build's callback. Retired — answered 410 with the new address, so there is one door. */
export const RETIRED_CALLBACK_PATH = '/bouncie/callback';
export const BOUNCIE_WEBHOOK_URL = `${PUBLIC_ORIGIN}/webhooks/bouncie`;
export const BOUNCIE_LINK_ENV = 'ARBO_LINK_BOUNCIE';

/**
 * The Bouncie link switch. Mirrors vendorLinked() in vendorLinks.ts on
 * purpose (open ONLY when exactly 'live', read at call time) but is kept
 * apart from that list, whose wording is the R21 Sona cut.
 */
export function bouncieLinked(): boolean {
  return process.env[BOUNCIE_LINK_ENV] === 'live';
}

const EXPIRY_MARGIN_MS = 60_000; // refresh a minute before the access token runs out
const STATE_TTL_MS = 10 * 60_000; // a Connect tap is good for ten minutes
const STATE_CAP = 5;
const CALL_DEADLINE_MS = 8_000;
const READ_EVERY_MS = 60_000; // one vehicles read a minute at most, however often the app asks
const RELOAD_EVERY_MS = 60_000; // a sign-in store that could not be read is tried again at most once a minute
const DRIVING_FRESH_MS = 15 * 60_000; // "driving" with no report for 15 min is not driving any more — it is stale
const PARKED_FRESH_MS = 24 * 60 * 60_000; // after a day without a report Arbo stops saying "parked"
const FUTURE_SLACK_MS = 5 * 60_000; // a device clock ahead of ours by more than this is a bad timestamp
const TRUCK_CAP = 50;
const SEEN_CAP = 5_000;
const EVENTS_PER_BODY = 500;
const POINTS_PER_EVENT = 1_000;
const PAGE = 10; // the page size Bouncie's own docs use — a larger one could be refused
const MAX_PAGES = 5;
const TRIPS_EVERY_MS = 60_000; // one trips read a minute per truck and day, however often the app asks
const TRIPS_CACHE_CAP = 10;
const TRIPS_CAP = 100;
const TRIP_POINTS_CAP = 2_000;
const GPS_TEXT_CAP = 4_000_000;
const MAX_TRIP_WINDOW_MS = 7 * 24 * 3600_000; // Bouncie's documented limit for one trips read: a week
const EARLIEST_TRIP_DAY = '2020-05-21'; // the earliest date Bouncie's trips read supports
const KEEP_ALIVE_AFTER_MS = 20 * 3600_000; // the keep-alive renews a sign-in last renewed 20 hours ago or more
const KEEP_ALIVE_RETRY_MS = 3600_000; // a keep-alive that failed is tried again no more than once an hour

export type BouncieHttp = (
  url: string,
  // redirect 'error': fetch follows a 3xx by default and a 307/308 re-sends the
  // body — the client secret and the refresh token — to wherever it points.
  // allowed() checks the first address only, so a redirect is a failure instead.
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; redirect: 'error'; signal?: RequestInit['signal'] },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultHttp: BouncieHttp = (url, init) => fetch(url, init);

/** The only three calls Arbo ever makes to Bouncie: the token swap and two reads. Everything else is refused before it leaves. */
function allowed(method: 'GET' | 'POST', url: string): boolean {
  return method === 'POST' ? url === TOKEN_URL : url.startsWith(`${API_BASE}vehicles?`) || url.startsWith(`${API_BASE}trips?`);
}

// ---------- the sign-in: where it is kept ----------

interface TokenRecord { accessToken: string; refreshToken: string; expiresAt: number; savedAt: string }

const TOKEN_FILE = 'bouncie-token.json';

function asTokenRecord(x: unknown): TokenRecord | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.accessToken !== 'string' || !r.accessToken) return null;
  if (typeof r.refreshToken !== 'string' || !r.refreshToken) return null;
  if (typeof r.expiresAt !== 'number' || !Number.isFinite(r.expiresAt) || typeof r.savedAt !== 'string') return null;
  return { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt, savedAt: r.savedAt };
}

function readTokenFile(dir: string): TokenRecord | null {
  try {
    return asTokenRecord(JSON.parse(readFileSync(join(dir, TOKEN_FILE), 'utf8')));
  } catch {
    return null; // nothing stored, no disk, or a damaged file — none of them is a sign-in
  }
}

/** Why the saved sign-in cannot be used — each its own sentence (§1B). */
export type StoreProblem = CredentialProblem;
export type TokenWhere = 'supabase' | 'disk' | 'memory';
type LoadResult = { ok: true; rec: TokenRecord | null; moved?: true } | { ok: false; problem: StoreProblem };
type SaveResult = { ok: true; where: TokenWhere } | { ok: false; problem: StoreProblem };

/** Where a sign-in is kept: Supabase in production; the disk file in practice mode (ARBO_DATA_LINKS=sim) and tests. */
export interface TokenBackend {
  readonly kind: 'supabase' | 'disk' | 'none';
  load(): Promise<LoadResult>;
  save(rec: TokenRecord): Promise<SaveResult>;
}

/**
 * PRACTICE MODE AND TESTS: the first build's store — one JSON file in
 * ARBO_SECRET_DIR (default /data), 0600, tmp + rename. No usable disk =
 * memory, and the status says so. Production keeps the sign-in in Supabase.
 */
export function diskTokenBackend(dir: string = process.env.ARBO_SECRET_DIR ?? '/data'): TokenBackend {
  return {
    kind: 'disk',
    load: async () => ({ ok: true, rec: readTokenFile(dir) }),
    save: async (rec) => {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tmp = join(dir, `${TOKEN_FILE}.tmp`);
        writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
        renameSync(tmp, join(dir, TOKEN_FILE));
        return { ok: true, where: 'disk' };
      } catch {
        return { ok: true, where: 'memory' };
      }
    },
  };
}

/**
 * PRODUCTION: one sealed row in Supabase, through the credential door.
 * A sign-in the first build left on the storage disk is moved in once — read,
 * saved to Supabase, and only then removed from the disk — and the disk is
 * never written again. If the move cannot be saved, the disk copy stays and
 * the next read tries again.
 */
export function supabaseTokenBackend(cred: CredentialStore, oldDir: string | null): TokenBackend {
  return {
    kind: 'supabase',
    async load() {
      const r = await cred.read();
      if (!r.ok) return r;
      if (r.plain !== null) {
        let rec: TokenRecord | null = null;
        try {
          rec = asTokenRecord(JSON.parse(r.plain));
        } catch {
          rec = null;
        }
        return rec ? { ok: true, rec } : { ok: false, problem: 'mismatch' };
      }
      const old = oldDir ? readTokenFile(oldDir) : null;
      if (!old || !oldDir) return { ok: true, rec: null };
      const w = await cred.write(JSON.stringify(old));
      if (!w.ok) return w;
      try {
        unlinkSync(join(oldDir, TOKEN_FILE));
      } catch {
        /* already gone, or a read-only disk: Supabase holds the copy Arbo reads from now on */
      }
      return { ok: true, rec: old, moved: true };
    },
    async save(rec) {
      const w = await cred.write(JSON.stringify(rec));
      return w.ok ? { ok: true, where: 'supabase' } : w;
    },
  };
}

/** No place to keep a sign-in (Supabase not configured): every read and write names that. */
export function noTokenBackend(): TokenBackend {
  return {
    kind: 'none',
    load: async () => ({ ok: false, problem: 'unconfigured' }),
    save: async () => ({ ok: false, problem: 'unconfigured' }),
  };
}

/**
 * The server's choice, made once at boot. Practice mode (ARBO_DATA_LINKS=sim)
 * opens no database by construction, so there the first build's disk file
 * stays. Everywhere else the sign-in lives in Supabase — and with Supabase
 * not configured, or the credential door cut (ARBO_LINK_CREDENTIALS, checked
 * by the door itself at every call), there is NO fallback: the state is
 * named, Connect refuses.
 */
export function bouncieTokenBackend(e: {
  supabaseUrl: string | null | undefined;
  serviceKey: string | null | undefined;
  clientSecret: string | null | undefined;
  practice: boolean;
  dir?: string;
  http?: CredentialHttp;
}): TokenBackend {
  const dir = e.dir ?? process.env.ARBO_SECRET_DIR ?? '/data';
  if (e.practice) return diskTokenBackend(dir);
  const cred = new CredentialStore({ url: e.supabaseUrl, serviceKey: e.serviceKey, provider: 'bouncie', secret: e.clientSecret, ...(e.http ? { http: e.http } : {}) });
  return e.supabaseUrl && e.serviceKey ? supabaseTokenBackend(cred, dir) : noTokenBackend();
}

/**
 * The sign-in in memory, kept in step with where it is stored. A read that
 * overlaps a save never overwrites it (`seq`), and a read that fails keeps
 * its NAMED problem — it is never taken for "not connected".
 */
export class BouncieTokenStore {
  private rec: TokenRecord | null = null;
  private where: TokenWhere | null = null;
  private problem: StoreProblem | null = null;
  private loadedAt: number | null = null;
  private loading: Promise<void> | null = null;
  private seq = 0;

  constructor(private readonly backend: TokenBackend) {}

  get kind(): TokenBackend['kind'] {
    return this.backend.kind;
  }

  /** When the last read landed (null = never). */
  lastLoad(): number | null {
    return this.loadedAt;
  }

  /** Read what is stored — one read at a time. */
  load(now: number): Promise<void> {
    if (!this.loading) {
      const at = this.seq;
      this.loading = this.backend.load()
        .catch((): LoadResult => ({ ok: false, problem: 'unreachable' }))
        .then((r) => {
          if (at !== this.seq) return; // a save landed meanwhile: it is newer than anything this read saw
          this.loadedAt = now;
          if (!r.ok) {
            this.problem = r.problem;
            return;
          }
          this.problem = null;
          this.rec = r.rec;
          this.where = r.rec ? (this.backend.kind === 'supabase' ? 'supabase' : 'disk') : null;
          if (r.moved) console.log('[bouncie] the sign-in on the storage disk was moved into Supabase (sealed) and removed from the disk');
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  /**
   * Read the stored row WITHOUT taking it — to see whether another Arbo saved
   * a newer one. A failed look is its named problem, never "nothing newer".
   */
  peek(): Promise<LoadResult> {
    return this.backend.load().catch((): LoadResult => ({ ok: false, problem: 'unreachable' }));
  }

  /** A look that failed (peek): named now, and read again by ensureLoaded within a minute. */
  failed(problem: StoreProblem, now: number): void {
    this.problem = problem;
    this.loadedAt = now;
  }

  /** Take a pair that is already stored (found by peek). */
  adopt(rec: TokenRecord): void {
    this.seq++;
    this.rec = rec;
    this.where = this.backend.kind === 'supabase' ? 'supabase' : 'disk';
    this.problem = null;
  }

  current(): TokenRecord | null {
    return this.rec;
  }

  problemNow(): StoreProblem | null {
    return this.problem;
  }

  /** Save a pair. Memory changes ONLY when the store took it — a failed save keeps the old pair in place. */
  async save(rec: TokenRecord): Promise<SaveResult> {
    this.seq++;
    const r = await this.backend.save(rec).catch((): SaveResult => ({ ok: false, problem: 'unreachable' }));
    this.seq++;
    if (r.ok) {
      this.rec = rec;
      this.where = r.where;
      this.problem = null;
    }
    return r;
  }

  /** Where the sign-in lives, when it was saved, or why it can't be read — never the token. */
  status(): { stored: boolean; where: TokenWhere | null; savedAt: string | null; problem: StoreProblem | null } {
    return { stored: this.rec !== null, where: this.where, savedAt: this.rec?.savedAt ?? null, problem: this.problem };
  }
}

// ---------- working hours: the one clock, and the day's window from it ----------

const ET_DATE_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

/** The Eastern date (YYYY-MM-DD) and hour of an instant. */
function etParts(ms: number): { day: string; hour: number } {
  const p: Record<string, string> = {};
  for (const x of ET_DATE_HOUR.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** A real calendar date written YYYY-MM-DD. */
function realDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === day;
}

/** The instant an Eastern wall-clock hour starts on a day, or null when that hour does not exist (spring forward). */
function etHour(day: string, hour: number): number | null {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  for (const offset of [4, 5]) { // EDT, then EST
    const t = Date.UTC(y, m - 1, d, hour + offset);
    const p = etParts(t);
    if (p.day === day && p.hour === hour) return t;
  }
  return null;
}

/**
 * That day's working window, found by ASKING withinWorkingHours hour by
 * hour — the one clock, not a copy of its numbers. Null when the day has no
 * working hours (Sunday).
 */
function workingWindow(day: string): { from: number; to: number } | null {
  let from: number | null = null;
  for (let h = 0; h < 24; h++) {
    const t = etHour(day, h);
    if (t === null) continue;
    const inside = withinWorkingHours(new Date(t));
    if (inside && from === null) from = t;
    else if (!inside && from !== null) return { from, to: t };
  }
  return from === null ? null : { from, to: from + 24 * 3600_000 };
}

// ---------- sign-in: state + PKCE ----------

/** S256 code challenge for a PKCE verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function authorizeUrl(clientId: string, state: string, verifier: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: BOUNCIE_REDIRECT,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

/**
 * Pending sign-ins. A state is minted only behind the owner key, lives ten
 * minutes, and is consumed the first time the callback sees it — whatever
 * happens next. Bound server-side (not to a cookie) on purpose: the
 * installed iPhone app and Safari keep separate cookies, and Mike's tap can
 * come back through either.
 */
class OAuthStates {
  private readonly pending = new Map<string, { verifier: string; at: number }>();

  mint(now: number): { state: string; verifier: string } {
    for (const [k, v] of this.pending) if (now - v.at > STATE_TTL_MS) this.pending.delete(k);
    while (this.pending.size >= STATE_CAP) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    this.pending.set(state, { verifier, at: now });
    return { state, verifier };
  }

  /** The verifier for a live state, or null. Single use: the state is gone after this call. */
  take(state: string, now: number): string | null {
    const v = this.pending.get(state);
    if (!v) return null;
    this.pending.delete(state);
    return now - v.at > STATE_TTL_MS ? null : v.verifier;
  }
}

// ---------- the trucks, in memory ----------

type Motion = 'driving' | 'parked' | 'unplugged';
const MOTION_RANK: Record<Motion, number> = { driving: 1, parked: 2, unplugged: 3 };

interface Truck {
  imei: string;
  vin: string | null;
  name: string | null;
  pos: { lat: number; lon: number; heading: number | null; at: number } | null;
  motion: Motion | null;
  motionAt: number;
  lastAt: number;
  /** The newest report the webhook carried for this truck (0 = none since restart). */
  hookAt: number;
  /** The newest report stamped OUTSIDE working hours (0 = none). Never kept — it only outdates what was held. */
  afterHoursAt: number;
  lastTrip: { at: number; miles: number | null; minutes: number | null } | null;
}

/**
 * 'seen' = a fresh position with no word yet on whether it is moving (a geo-zone event alone).
 * 'after_hours' = the truck's newest report was after hours, so where it is now is not shown.
 */
export type TruckMotion = Motion | 'seen' | 'stale' | 'no_fix' | 'after_hours';

/** What the owner routes hand out: last 4 of the ids, never the whole VIN or device number. */
export interface TruckView {
  /** Steady while Arbo runs, new after a restart — a key for the map, never a record id to keep. */
  id: string;
  name: string | null;
  vin4: string | null;
  device4: string;
  lat: number | null;
  lon: number | null;
  heading: number | null;
  /** The last report of any kind (a trip start, a battery reading) — not necessarily a position. */
  reportedAt: string | null;
  ageMinutes: number | null;
  /** When lat/lon were fixed. The map plots the dot at this age, never at the last report's. */
  positionAt: string | null;
  positionAgeMinutes: number | null;
  motion: TruckMotion;
  lastTrip: { endedAt: string; miles: number | null; minutes: number | null } | null;
}

/** Each webhook eventType and the key its payload sits under (tripData's points are under `data`). */
const PAYLOAD_KEY = new Map<string, string>([
  ['connect', 'connect'], ['disconnect', 'disconnect'], ['battery', 'battery'], ['mil', 'mil'], ['vinChange', 'vinChange'],
  ['tripStart', 'start'], ['tripData', 'data'], ['tripMetrics', 'metrics'], ['tripEnd', 'end'],
  ['applicationGeozone', 'geozone'], ['userGeozone', 'geozone'],
]);

function obj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** A Bouncie timestamp, or null: unparseable, or further ahead than a clock can drift, is never "now". */
function tsOf(v: unknown, now: number): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t <= now + FUTURE_SLACK_MS ? t : null;
}

function coord(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null; // 0,0 is "no fix", not the Gulf of Guinea
  return { lat, lon };
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const ids = (s: string): string => s.slice(-4);

/** Constant time over the SHA-256 of both sides, so neither the value nor its length leaks. */
function sameKey(given: unknown, key: string): boolean {
  const g = typeof given === 'string' ? given : '';
  const a = createHash('sha256').update(g).digest();
  const b = createHash('sha256').update(key).digest();
  return timingSafeEqual(a, b) && g.length > 0;
}

// ---------- matching trucks to Fleet units ----------

export interface UnitLite { id: string; name: string; vinOrSerial?: string | null }

const normVin = (s: string | null | undefined): string => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normName = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A real 17-character VIN (no I, O or Q) — a chipper's or trailer's serial number is not one. */
const REAL_VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * A Bouncie truck belongs to a Fleet unit when its VIN matches the unit's
 * VIN, or — failing that — its Bouncie nickname matches the unit's name.
 * Only when unambiguous: two units or two trucks on the same VIN or name
 * leave every one of them unmatched rather than guessed. Two different real
 * VINs are evidence AGAINST a pairing, and the same name never overrides them.
 */
export function matchTrucks<T extends { vin: string | null; name: string | null }>(
  units: UnitLite[],
  trucks: T[],
): { matched: Map<string, { truck: T; by: 'vin' | 'name' }>; unmatched: T[] } {
  const matched = new Map<string, { truck: T; by: 'vin' | 'name' }>();
  const taken = new Set<T>();
  const count = <K>(keys: K[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<K, number>());
  const unitVins = count(units.map((u) => normVin(u.vinOrSerial)));
  const truckVins = count(trucks.map((t) => normVin(t.vin)));
  for (const t of trucks) {
    const v = normVin(t.vin);
    if (!v || truckVins.get(v) !== 1 || unitVins.get(v) !== 1) continue;
    const u = units.find((x) => normVin(x.vinOrSerial) === v)!;
    matched.set(u.id, { truck: t, by: 'vin' });
    taken.add(t);
  }
  const openUnits = units.filter((u) => !matched.has(u.id));
  const openTrucks = trucks.filter((t) => !taken.has(t));
  const unitNames = count(openUnits.map((u) => normName(u.name)));
  const truckNames = count(openTrucks.map((t) => normName(t.name)));
  for (const t of openTrucks) {
    const n = normName(t.name);
    if (!n || truckNames.get(n) !== 1 || unitNames.get(n) !== 1) continue;
    const u = openUnits.find((x) => normName(x.name) === n)!;
    const uv = normVin(u.vinOrSerial);
    const tv = normVin(t.vin);
    if (REAL_VIN.test(uv) && tv && uv !== tv) continue;
    matched.set(u.id, { truck: t, by: 'name' });
    taken.add(t);
  }
  return { matched, unmatched: trucks.filter((t) => !taken.has(t)) };
}

// ---------- the integration ----------

export interface BouncieOptions {
  clientId: string | null;
  clientSecret: string | null;
  webhookKey: string | null;
  /**
   * BOUNCIE_API_KEY is on Railway (Mike's spec) — PRESENCE ONLY. Mike,
   * 2026-10-20: it is the portal's per-user Authorization Code (Users &
   * Devices → Authorize My Devices). Arbo does not need it — Connect Bouncie
   * gets its own code — so only whether it is set reaches here; its value is
   * never read, sent or logged.
   */
  apiKeySet?: boolean;
  /** Where the sign-in is kept. The server passes bouncieTokenBackend(); with none given, nothing can be kept, by name. */
  tokens?: TokenBackend;
  http?: BouncieHttp;
  now?: () => number;
}

type TokenAnswer =
  | { ok: true; accessToken: string; refreshToken: string | null; expiresInSec: number }
  | { ok: false; reason: 'rejected'; status: number }
  | { ok: false; reason: 'unreachable' | 'bad_answer' };

/** 'store' = the sign-in store can't be read, or it would not take a renewed sign-in — see signInState(). */
type TokenFail = { ok: false; reason: 'not_connected' | 'expired' | 'unreadable' | 'store' };
type TokenOutcome = { ok: true; token: string } | TokenFail;

type ReadOutcome = { ok: true; at: number } | TokenFail;

export type SignInState =
  | 'keys_missing'
  | 'store_cut' // the credential door is cut on purpose (ARBO_LINK_CREDENTIALS is not 'live'): Supabase is not touched
  | 'store_unconfigured' // Supabase is not configured: nowhere to keep a sign-in
  | 'store_missing' // the table is not there: migration 0021 not applied
  | 'store_unreadable' // Supabase did not answer, refused the key, or the row is not the expected shape
  | 'store_locked' // the row is there but does not open: BOUNCIE_CLIENT_SECRET changed
  | 'not_connected'
  | 'expired'
  | 'unsaved' // Bouncie renewed the sign-in, Supabase has not taken it yet: held, unused, retried
  | 'connected';
// 'sign_in_cut' = the sign-in store is cut ON PURPOSE (ARBO_LINK_CREDENTIALS) — a gap by choice, never
// worded or coloured like 'sign_in_store' (Arbo can't open a sign-in it should have).
export type PositionsState = 'keys_missing' | 'link_cut' | 'sign_in_cut' | 'sign_in_store' | 'not_connected' | 'token_expired' | 'after_hours' | 'unreadable' | 'no_trucks' | 'ok';
export type TripsState = 'keys_missing' | 'link_cut' | 'sign_in_cut' | 'sign_in_store' | 'not_connected' | 'token_expired' | 'after_hours' | 'not_a_working_day' | 'unreadable' | 'no_trips' | 'ok';
type Gate = 'keys_missing' | 'link_cut' | 'sign_in_cut' | 'sign_in_store' | 'not_connected' | 'token_expired' | 'after_hours';

const STORE_STATE: Record<StoreProblem, SignInState> = {
  cut: 'store_cut',
  unconfigured: 'store_unconfigured',
  missing_table: 'store_missing',
  refused: 'store_unreadable',
  mismatch: 'store_unreadable',
  unreachable: 'store_unreadable',
  locked: 'store_locked',
};

/** The callback page's words for a store that would not take a sign-in. */
const STORE_WORDS: Record<StoreProblem, string> = {
  cut: 'The sign-in store in Supabase is cut on purpose (ARBO_LINK_CREDENTIALS is not "live"), so Arbo touches no Supabase table to keep it.',
  unconfigured: 'Supabase isn’t configured on the server (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY), and the sign-in is kept only there.',
  missing_table: 'The sign-in table isn’t in Supabase yet — migration 0021 has not been applied.',
  refused: 'Supabase refused Arbo’s key (SUPABASE_SERVICE_ROLE_KEY).',
  mismatch: 'Supabase’s sign-in table doesn’t match what Arbo expects (migration 0021).',
  unreachable: 'Arbo couldn’t reach Supabase just now.',
  locked: 'The saved sign-in can’t be opened — BOUNCIE_CLIENT_SECRET has changed since it was saved.',
};

export interface CallbackResult { status: number; ok: boolean; title: string; line: string }

export class Bouncie {
  private readonly store: BouncieTokenStore;
  private readonly states = new OAuthStates();
  private readonly http: BouncieHttp;
  private readonly now: () => number;
  private readonly trucks = new Map<string, Truck>();
  private readonly seen = new Set<string>();
  private readonly salt = randomBytes(16).toString('hex');
  private refreshing: Promise<TokenOutcome> | null = null;
  private generation = 0; // bumped by every Connect, so a refresh from an older sign-in never overwrites a newer one
  private expired = false; // Bouncie refused our refresh token (or the app lost access): a Reconnect clears it, or a newer saved pair
  /** The refresh token Bouncie refused: a stored pair carrying any OTHER one is newer (another Arbo, or a Reconnect there). */
  private deadRefresh: string | null = null;
  private expiredLookAt = 0; // when Supabase was last looked at for a newer pair while expired — at most once a minute
  /** A renewed pair Bouncie handed back that the store has not taken yet. Held, never used, until it is saved. */
  private unsaved: { rec: TokenRecord; gen: number } | null = null;
  private saveChain: Promise<unknown> = Promise.resolve();
  /** When the daily keep-alive last failed to renew the sign-in (null = it has not, since the last success). */
  private keepAliveFailedAt: number | null = null;
  private keepAliveBusy = false; // one keep-alive at a time, however the minute ticks overlap
  private lastRead: { at: number; outcome: ReadOutcome } | null = null;
  private reading: Promise<ReadOutcome> | null = null;
  private readonly tripCache = new Map<string, { at: number; body: Record<string, unknown> }>();
  private refusedSignIns = 0;
  private readonly hook = {
    deliveries: 0, // authentic calls while the link is open and inside working hours, whatever was in them
    received: 0, // events kept
    lastAt: null as string | null,
    whileCut: 0,
    lastWhileCutAt: null as string | null,
    droppedKeysMissing: 0, // authentic, link open, but no BOUNCIE_CLIENT_ID / SECRET: answered and dropped
    // Authentic, link open, arrived outside working hours: answered and dropped unread. A COUNT only — it
    // shows the webhook is wired; the minute an after-hours update came is not kept (working hours only).
    afterHours: 0,
    afterHoursReports: 0, // events or trip points stamped after hours inside a daytime delivery: skipped unread
    lastAuthenticAt: null as string | null, // the last call that carried the key, whatever happened to it
    lastRejectedAt: null as string | null, // the last call without it — Settings tells a stranger from a wrong key by these two
    duplicates: 0,
    unknownTypes: 0,
    badEvents: 0,
    badJson: 0,
    oversized: 0,
    overCap: 0,
    rejected: 0,
    refusedNotWired: 0,
  };

  constructor(private readonly opts: BouncieOptions) {
    this.store = new BouncieTokenStore(opts.tokens ?? noTokenBackend());
    this.http = opts.http ?? defaultHttp;
    this.now = opts.now ?? Date.now;
    if (this.configured()) void this.store.load(this.now());
  }

  /** Both sign-in keys are on the server. The webhook key is separate (webhookWired). */
  configured(): boolean {
    return Boolean(this.opts.clientId && this.opts.clientSecret);
  }

  webhookWired(): boolean {
    return Boolean(this.opts.webhookKey);
  }

  /** The working-hours rule — withinWorkingHours, on this integration's clock. */
  private inHoursAt(ms: number): boolean {
    return withinWorkingHours(new Date(ms));
  }

  private inHours(): boolean {
    return this.inHoursAt(this.now());
  }

  /**
   * The stored sign-in, read once — and read again at most once a minute
   * while it could not be read (a migration applied meanwhile, Supabase back).
   * Not configured on the server is not retried: that needs a deploy.
   * While EXPIRED, Supabase is looked at once a minute too: a pair saved
   * since by another Arbo (a deploy overlap) or a Reconnect there is taken,
   * so Settings never sits on EXPIRED over a good sign-in.
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.configured()) return;
    const at = this.store.lastLoad();
    const p = this.store.problemNow();
    if (at === null || (p !== null && p !== 'unconfigured' && this.now() - at >= RELOAD_EVERY_MS)) await this.store.load(this.now());
    else if (this.expired && this.store.kind === 'supabase' && this.now() - this.expiredLookAt >= RELOAD_EVERY_MS) await this.lookPastExpired();
  }

  /** One look at Supabase while expired. Only a pair whose refresh token is not the refused one is taken. */
  private async lookPastExpired(): Promise<void> {
    this.expiredLookAt = this.now(); // set before the wait: a second caller meanwhile does not look again
    const gen = this.generation;
    const found = await this.store.peek();
    if (!this.expired || gen !== this.generation) return; // a Connect landed meanwhile: it is newer than this look
    if (!found.ok || !found.rec || found.rec.refreshToken === this.deadRefresh) return; // nothing newer: still expired
    this.generation++; // the stored pair is newer than any refresh still in flight here
    this.store.adopt(found.rec);
    this.expired = false;
    this.deadRefresh = null;
    this.lastRead = null;
    console.log('[bouncie] the sign-in had expired here, but a newer one is saved in Supabase — using it');
  }

  /** Bouncie refused this refresh token (or the access token twice): only a newer pair, or a Reconnect, clears it. */
  private expire(dead: string | null): void {
    this.expired = true;
    this.deadRefresh = dead;
    this.expiredLookAt = this.now();
  }

  /** Resolves once the stored sign-in has been read — the boot line and the Connect route wait for it. */
  ready(): Promise<void> {
    return this.ensureLoaded();
  }

  signInState(): SignInState {
    if (!this.configured()) return 'keys_missing';
    if (this.unsaved) return 'unsaved';
    const p = this.store.problemNow();
    if (p) return STORE_STATE[p];
    if (!this.store.current()) return 'not_connected';
    return this.expired ? 'expired' : 'connected';
  }

  private call(method: 'GET' | 'POST', url: string, headers: Record<string, string>, body?: string) {
    // Structural, not a convention: Arbo reads Bouncie and swaps a sign-in code. It never writes to Bouncie.
    if (!allowed(method, url)) return Promise.reject(new Error('bouncie_call_refused'));
    return this.http(url, { method, headers, redirect: 'error', ...(body === undefined ? {} : { body }), signal: globalThis.AbortSignal.timeout(CALL_DEADLINE_MS) });
  }

  private async tokenCall(form: Record<string, string>): Promise<TokenAnswer> {
    let res;
    try {
      res = await this.call('POST', TOKEN_URL, { 'content-type': 'application/json' }, JSON.stringify(form));
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    // 400/401/403 is Bouncie saying no to this code or refresh token. Anything else (429, 5xx) is "try later".
    if (!res.ok) return res.status === 400 || res.status === 401 || res.status === 403 ? { ok: false, reason: 'rejected', status: res.status } : { ok: false, reason: 'unreachable' };
    const b = obj(await res.json().catch(() => null));
    if (!b || typeof b.access_token !== 'string' || !b.access_token) return { ok: false, reason: 'bad_answer' };
    const sec = Number(b.expires_in);
    return {
      ok: true,
      accessToken: b.access_token,
      refreshToken: typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : null,
      expiresInSec: Number.isFinite(sec) && sec > 0 ? sec : 3600,
    };
  }

  /**
   * Saves run one at a time, in the order asked. A save from an older
   * sign-in than the newest Connect is dropped unsaved ('superseded'), so a
   * late refresh can never overwrite a newer sign-in — in memory or in Supabase.
   */
  private persist(rec: TokenRecord, gen: number): Promise<SaveResult | 'superseded'> {
    const run = this.saveChain.then((): Promise<SaveResult | 'superseded'> => (gen !== this.generation ? Promise.resolve('superseded' as const) : this.store.save(rec)));
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  /** What a caller gets when its own answer was overtaken by a newer sign-in. */
  private currentOutcome(): TokenOutcome {
    const cur = this.store.current();
    return cur && !this.expired && !this.unsaved ? { ok: true, token: cur.accessToken } : { ok: false, reason: 'not_connected' };
  }

  // ----- Connect -----

  /**
   * Mint a state + PKCE verifier and hand back where to send Mike. Owner key
   * checked by the route, which awaits ready() first. A store that cannot
   * keep a sign-in at all refuses here, before Mike is sent to Bouncie.
   */
  beginConnect(): { ok: true; authorizeUrl: string } | { ok: false; error: 'bouncie_keys_missing' | 'bouncie_store_cut' | 'bouncie_store_unconfigured' | 'bouncie_store_missing' } {
    if (!this.opts.clientId || !this.opts.clientSecret) return { ok: false, error: 'bouncie_keys_missing' };
    const p = this.store.problemNow();
    if (p === 'cut') return { ok: false, error: 'bouncie_store_cut' };
    if (p === 'unconfigured') return { ok: false, error: 'bouncie_store_unconfigured' };
    if (p === 'missing_table') return { ok: false, error: 'bouncie_store_missing' };
    const { state, verifier } = this.states.mint(this.now());
    return { ok: true, authorizeUrl: authorizeUrl(this.opts.clientId, state, verifier) };
  }

  /** The callback: state check → store check → code swap → token saved. Every outcome is a sentence; none repeats the code or state. */
  async finishConnect(q: { code: string | null; state: string | null }): Promise<CallbackResult> {
    const back = 'Go back to Settings in Arbo and tap Connect Bouncie again.';
    if (!this.opts.clientId || !this.opts.clientSecret) {
      return { status: 503, ok: false, title: 'Bouncie isn’t set up on the server', line: 'BOUNCIE_CLIENT_ID and BOUNCIE_CLIENT_SECRET are not on Railway yet, so Arbo cannot finish a sign-in. Nothing was saved.' };
    }
    const verifier = q.state && /^[A-Za-z0-9_-]{20,128}$/.test(q.state) ? this.states.take(q.state, this.now()) : null;
    if (!verifier) {
      // A public address: anyone can knock. The log says so once, then every hundredth time.
      this.refusedSignIns++;
      if (this.refusedSignIns === 1 || this.refusedSignIns % 100 === 0) console.error(`[bouncie] sign-in refused: unknown, used or expired state (${this.refusedSignIns} since restart)`);
      return { status: 400, ok: false, title: 'That sign-in link is not one Arbo is waiting for', line: `It was already used, it is more than ten minutes old, or Arbo restarted in between. Nothing was saved. ${back}` };
    }
    if (!q.code) {
      console.error('[bouncie] sign-in ended without a code');
      return { status: 400, ok: false, title: 'Bouncie did not send a sign-in code', line: `The approval was cancelled or refused on Bouncie’s page. Nothing was saved. ${back}` };
    }
    // Nowhere to keep it: say so BEFORE the code is spent at Bouncie.
    await this.ensureLoaded();
    const p = this.store.problemNow();
    if (p === 'cut' || p === 'unconfigured' || p === 'missing_table') {
      console.error(`[bouncie] sign-in not finished — nowhere to keep it (${p})`);
      return { status: 503, ok: false, title: 'Arbo has nowhere to keep the Bouncie sign-in yet', line: `${STORE_WORDS[p]} Bouncie was not asked anything and nothing was saved. ${back}` };
    }
    const r = await this.tokenCall({
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      grant_type: 'authorization_code',
      code: q.code,
      redirect_uri: BOUNCIE_REDIRECT,
      code_verifier: verifier,
    });
    if (!r.ok || !r.refreshToken) {
      const reason = r.ok ? 'no_refresh_token' : r.reason;
      const said = !r.ok && r.reason === 'rejected' ? r.status : null; // Bouncie's HTTP status — a number, never a secret
      console.error(`[bouncie] sign-in swap failed: ${reason}${said === null ? '' : ` (HTTP ${said})`}`);
      // A wrong Redirect URI fails on Bouncie's own page and never reaches here, so a refusal is a used or
      // replaced code — or, most likely on a first connect, a client secret pasted wrong.
      return reason === 'unreachable'
        ? { status: 502, ok: false, title: 'Arbo couldn’t reach Bouncie', line: `The sign-in did not finish. Nothing was saved. ${back}` }
        : said !== null
          ? { status: 400, ok: false, title: 'Bouncie refused the sign-in', line: `Bouncie said no (HTTP ${said}): the code was already used or replaced, or BOUNCIE_CLIENT_SECRET on Railway doesn’t match the portal. Nothing was saved. ${back}` }
          : { status: 400, ok: false, title: 'Bouncie refused the sign-in', line: `Bouncie did not accept that sign-in code (its answer was missing the sign-in token). Nothing was saved. ${back}` };
    }
    const now = this.now();
    this.generation++; // any refresh still in flight belongs to the old sign-in: its answer is dropped unsaved
    const saved = await this.persist({ accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: now + r.expiresInSec * 1000, savedAt: new Date(now).toISOString() }, this.generation);
    if (saved === 'superseded') {
      // Two approvals finished at once: the later one is kept, and this page says so rather than claim this one.
      return { status: 200, ok: true, title: 'Bouncie is connected', line: 'A second sign-in finished at the same moment; Arbo kept the newer one.' };
    }
    if (!saved.ok) {
      console.error(`[bouncie] sign-in swapped, but it could not be saved (${saved.problem}) — nothing kept`);
      return { status: 503, ok: false, title: 'Bouncie said yes, but Arbo couldn’t save the sign-in', line: `${STORE_WORDS[saved.problem]} Nothing was kept, so Bouncie is not connected. ${back}` };
    }
    this.expired = false;
    this.deadRefresh = null;
    this.unsaved = null;
    this.lastRead = null;
    this.tripCache.clear();
    console.log(`[bouncie] connected — sign-in kept on ${saved.where}`);
    const cut = bouncieLinked() ? '' : ' Truck positions stay off until ARBO_LINK_BOUNCIE is set to live on Railway.';
    return saved.where === 'supabase'
      ? { status: 200, ok: true, title: 'Bouncie is connected', line: `The sign-in is saved in Supabase, sealed, and survives redeploys.${cut}` }
      : saved.where === 'disk'
        ? { status: 200, ok: true, title: 'Bouncie is connected', line: `The sign-in is saved on Arbo’s storage disk (practice mode) and survives redeploys.${cut}` }
        : { status: 200, ok: true, title: 'Bouncie is connected — for now', line: `There is no storage disk, so the sign-in is held in memory and will need connecting again after the next restart.${cut}` };
  }

  // ----- the access token: refreshed early, one refresh at a time, rotation saved before use -----

  /** One token job at a time (a refresh, or saving a renewed pair); every caller in between shares its answer. */
  private oneAtATime(job: () => Promise<TokenOutcome>): Promise<TokenOutcome> {
    if (!this.refreshing) {
      this.refreshing = job().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  /**
   * A usable access token. `rejected` is the token Bouncie just answered 401
   * to: if it is still the current one, refresh now; if someone already
   * refreshed past it, hand back the newer one without a second refresh.
   */
  async accessToken(rejected?: string): Promise<TokenOutcome> {
    await this.ensureLoaded();
    if (this.unsaved) return this.oneAtATime(() => this.saveUnsaved());
    if (this.store.problemNow()) return { ok: false, reason: 'store' };
    const rec = this.store.current();
    if (!rec) return { ok: false, reason: 'not_connected' };
    if (this.expired) return { ok: false, reason: 'expired' };
    const due = rejected === undefined ? rec.expiresAt - EXPIRY_MARGIN_MS <= this.now() : rec.accessToken === rejected;
    if (!due) return { ok: true, token: rec.accessToken };
    return this.oneAtATime(() => this.refresh(rec));
  }

  private async refresh(rec: TokenRecord): Promise<TokenOutcome> {
    const gen = this.generation;
    const r = await this.tokenCall({
      client_id: this.opts.clientId ?? '',
      client_secret: this.opts.clientSecret ?? '',
      grant_type: 'refresh_token',
      refresh_token: rec.refreshToken,
    });
    // Mike connected again while this was in flight: the new sign-in wins and this answer is dropped unsaved.
    if (gen !== this.generation) return this.currentOutcome();
    if (!r.ok) {
      if (r.reason === 'rejected') {
        // Before calling it expired: another Arbo (the old one, during a deploy) may have
        // rotated this refresh token and saved the new pair. If Supabase holds a newer one, take it.
        if (this.store.kind === 'supabase') {
          const newer = await this.store.peek();
          if (gen !== this.generation) return this.currentOutcome();
          if (!newer.ok) {
            // Supabase could not be read: that is the store, by name — never "expired" on a look that failed.
            // The store is read again within a minute; a newer pair is taken then, the same dead one expires.
            this.store.failed(newer.problem, this.now());
            console.error(`[bouncie] refresh refused, and the saved sign-in could not be read to look for a newer one (${newer.problem}) — not marked expired`);
            return { ok: false, reason: 'store' };
          }
          if (newer.rec && newer.rec.refreshToken !== rec.refreshToken) {
            this.store.adopt(newer.rec);
            console.log('[bouncie] refresh refused, but a newer saved sign-in was found in Supabase — using it');
            return { ok: true, token: newer.rec.accessToken };
          }
        }
        this.expire(rec.refreshToken);
        console.error('[bouncie] refresh refused — the sign-in expired or was removed; Mike reconnects in Settings');
        return { ok: false, reason: 'expired' };
      }
      // Network or a Bouncie outage: the old pair is kept and tried again next time.
      console.error(`[bouncie] refresh failed: ${r.reason} — will try again`);
      return { ok: false, reason: 'unreadable' };
    }
    // Bouncie rotates the refresh token: the old one is already dead. The new
    // pair is SAVED before the new access token is used. If the store will not
    // take it, the old row stays as it was, and the new pair is held — unused —
    // and saved again before anything uses it.
    const now = this.now();
    const next: TokenRecord = {
      accessToken: r.accessToken,
      refreshToken: r.refreshToken ?? rec.refreshToken,
      expiresAt: now + r.expiresInSec * 1000,
      savedAt: new Date(now).toISOString(),
    };
    const saved = await this.persist(next, gen);
    if (saved === 'superseded') return this.currentOutcome();
    if (!saved.ok) {
      this.unsaved = { rec: next, gen };
      console.error(`[bouncie] refreshed, but the new sign-in could not be saved (${saved.problem}) — held unused and saved again before any use`);
      return { ok: false, reason: 'store' };
    }
    if (saved.where === 'memory') console.error('[bouncie] refreshed, but the new sign-in is in memory only (no storage disk)');
    return { ok: true, token: next.accessToken };
  }

  /** Try again to save the renewed pair the store refused. Nothing uses it until this succeeds. */
  private async saveUnsaved(): Promise<TokenOutcome> {
    const u = this.unsaved;
    if (!u) return this.currentOutcome();
    const saved = await this.persist(u.rec, u.gen);
    if (saved === 'superseded') {
      if (this.unsaved === u) this.unsaved = null;
      return this.currentOutcome();
    }
    if (!saved.ok) return { ok: false, reason: 'store' };
    if (this.unsaved === u) this.unsaved = null;
    console.log('[bouncie] the renewed sign-in is saved now');
    return { ok: true, token: u.rec.accessToken };
  }

  private markExpired(): void {
    this.expire(this.store.current()?.refreshToken ?? null);
    console.error('[bouncie] Bouncie refused the access token twice — the app lost access; Mike reconnects in Settings');
  }

  // ----- the vehicles read (positions when nothing is driving) -----

  private async get(url: string, token: string) {
    try {
      // The token goes bare: Bouncie's REST header is the token itself, no "Bearer".
      return await this.call('GET', url, { authorization: token, 'content-type': 'application/json' });
    } catch {
      return null;
    }
  }

  /** One read with the current token: a 401 refreshes once and retries once; a second 401 is "reconnect". */
  private async authedGet(url: string): Promise<{ ok: true; body: unknown } | TokenFail> {
    const tok = await this.accessToken();
    if (!tok.ok) return tok;
    let res = await this.get(url, tok.token);
    if (res && res.status === 401) {
      const again = await this.accessToken(tok.token);
      if (!again.ok) return again;
      res = await this.get(url, again.token);
      if (res && res.status === 401) {
        this.markExpired();
        return { ok: false, reason: 'expired' };
      }
    }
    if (!res || !res.ok) return { ok: false, reason: 'unreadable' };
    return { ok: true, body: await res.json().catch(() => null) };
  }

  private async readVehicles(): Promise<ReadOutcome> {
    const found: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await this.authedGet(`${API_BASE}vehicles?limit=${PAGE}${page ? `&skip=${page * PAGE}` : ''}`);
      if (!r.ok) return r;
      if (!Array.isArray(r.body)) return { ok: false, reason: 'unreadable' };
      found.push(...r.body.slice(0, TRUCK_CAP));
      if (r.body.length < PAGE) break;
    }
    const now = this.now();
    for (const v of found) this.applyVehicle(v, now);
    return { ok: true, at: now };
  }

  /** At most one read a minute and one at a time; only ever while the link is live and the sign-in is good. */
  private async read(): Promise<ReadOutcome> {
    const now = this.now();
    if (this.lastRead && now - this.lastRead.at < READ_EVERY_MS) return this.lastRead.outcome;
    if (!this.reading) {
      this.reading = this.readVehicles()
        .then((outcome) => {
          this.lastRead = { at: this.now(), outcome };
          return outcome;
        })
        .finally(() => {
          this.reading = null;
        });
    }
    return this.reading;
  }

  private truck(imei: string): Truck | null {
    const t = this.trucks.get(imei);
    if (t) return t;
    if (this.trucks.size >= TRUCK_CAP) return null;
    const fresh: Truck = { imei, vin: null, name: null, pos: null, motion: null, motionAt: 0, lastAt: 0, hookAt: 0, afterHoursAt: 0, lastTrip: null };
    this.trucks.set(imei, fresh);
    return fresh;
  }

  /** True the second time a key is seen. Oldest keys go first once the cap is reached. */
  private dup(key: string): boolean {
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    if (this.seen.size > SEEN_CAP) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return false;
  }

  /**
   * The newest timestamp wins, whatever order the reports arrive in — a late burst never moves a truck backwards,
   * and nothing older than the truck's last after-hours report comes back once that report has outdated it.
   */
  private offerPos(t: Truck, lat: unknown, lon: unknown, heading: unknown, at: number): void {
    const c = coord(lat, lon);
    if (!c || at <= t.afterHoursAt || (t.pos && at <= t.pos.at)) return;
    t.pos = { ...c, heading: num(heading), at };
  }

  /** Same rule for driving/parked/unplugged; at the same instant an end outranks a data point. */
  private offerMotion(t: Truck, m: Motion, at: number): void {
    if (at <= t.afterHoursAt) return;
    if (at > t.motionAt || (at === t.motionAt && (!t.motion || MOTION_RANK[m] > MOTION_RANK[t.motion]))) {
      t.motion = m;
      t.motionAt = at;
    }
  }

  private touch(t: Truck, at: number): void {
    if (at > t.lastAt) t.lastAt = at;
  }

  /**
   * A report stamped after hours. Nothing in it is kept — no place, no motion.
   * Its time alone outdates what Arbo held: where the truck was before it is
   * not where it is now, so that is dropped too (§1B: never a stale map).
   */
  private afterHoursReport(t: Truck, at: number): void {
    if (at <= t.afterHoursAt) return;
    t.afterHoursAt = at;
    if (t.pos && t.pos.at < at) t.pos = null;
    if (t.motion && t.motionAt < at) {
      t.motion = null;
      t.motionAt = 0;
    }
  }

  /** A webhook report: the truck's last report, and the last time the live stream spoke for it. */
  private heard(t: Truck, at: number): void {
    this.touch(t, at);
    if (at > t.hookAt) t.hookAt = at;
  }

  private applyVehicle(v: unknown, now: number): void {
    const r = obj(v);
    if (!r || typeof r.imei !== 'string' || !r.imei || r.imei.length > 64) return;
    const t = this.truck(r.imei);
    if (!t) return;
    if (typeof r.vin === 'string' && r.vin && r.vin.length <= 32) t.vin = r.vin;
    if (typeof r.nickName === 'string' && r.nickName.trim()) t.name = r.nickName.trim().slice(0, 80);
    const s = obj(r.stats);
    const at = tsOf(s?.lastUpdated, now);
    if (!s || at === null) return;
    // stats.lastUpdated is when Bouncie's vehicle DOCUMENT last changed, not when
    // its location was fixed, and that stored location can lag the live stream.
    // While the webhook has spoken for this truck in the last 15 minutes it is
    // the better witness: this read only names the truck, it never moves it.
    if (now - t.hookAt < DRIVING_FRESH_MS) return;
    // stats.location has no fix time of its own: lastUpdated is the only clock
    // it carries. Touched after hours, it may be where the truck went after
    // hours — not kept, and it outdates what was held.
    if (!this.inHoursAt(at)) {
      this.afterHoursReport(t, at);
      return;
    }
    const loc = obj(s.location); // its street address is never read
    if (loc) this.offerPos(t, loc.lat, loc.lon, loc.heading, at);
    if (typeof s.isRunning === 'boolean') this.offerMotion(t, s.isRunning ? 'driving' : 'parked', at);
    this.touch(t, at);
  }

  /** One webhook event into memory. Returns what happened to it, for the counts. */
  private applyEvent(ev: unknown, now: number): 'kept' | 'duplicate' | 'unknown' | 'bad' | 'full' | 'after_hours' {
    const e = obj(ev);
    if (!e || typeof e.eventType !== 'string' || typeof e.imei !== 'string' || !e.imei || e.imei.length > 64) return 'bad';
    const type = e.eventType;
    const imei = e.imei;
    const key = PAYLOAD_KEY.get(type);
    if (!key) return 'unknown';
    const vin = typeof e.vin === 'string' && e.vin && e.vin.length <= 32 ? e.vin : null;
    if (type === 'tripData') {
      // Two overlapping streams and bursts after a signal loss: a point is
      // the same point when the device and its timestamp match.
      const points = Array.isArray(e.data) ? e.data.slice(0, POINTS_PER_EVENT) : [];
      let fresh = 0;
      let bad = 0;
      let late = 0;
      for (const p of points) {
        const q = obj(p);
        const at = tsOf(q?.timestamp, now);
        if (!q || at === null) {
          bad++;
          continue;
        }
        if (!this.inHoursAt(at)) {
          // A point stamped after hours (a burst after a signal loss can arrive the next morning): skipped unread.
          late++;
          this.hook.afterHoursReports++;
          const held = this.trucks.get(imei);
          if (held) this.afterHoursReport(held, at);
          continue;
        }
        if (this.dup(`${imei}|${at}`)) continue;
        const t = this.truck(imei);
        if (!t) return 'full';
        if (vin) t.vin = vin;
        const g = obj(q.gps);
        this.offerPos(t, g?.lat, g?.lon, g?.heading, at);
        this.offerMotion(t, 'driving', at);
        this.heard(t, at);
        fresh++;
      }
      return fresh > 0 ? 'kept' : late > 0 ? 'after_hours' : bad === points.length ? 'bad' : 'duplicate';
    }
    const d = obj(e[key]);
    const at = tsOf(d?.timestamp, now);
    if (!d || at === null) return 'bad';
    if (!this.inHoursAt(at)) {
      this.hook.afterHoursReports++;
      const held = this.trucks.get(imei);
      if (held) this.afterHoursReport(held, at);
      return 'after_hours';
    }
    if (this.dup(`${imei}|${type}|${at}`)) return 'duplicate';
    const t = this.truck(imei);
    if (!t) return 'full';
    if (vin) t.vin = vin;
    if (type === 'connect' || type === 'disconnect') {
      this.offerPos(t, d.latitude, d.longitude, null, at);
      this.offerMotion(t, type === 'connect' ? 'parked' : 'unplugged', at);
    } else if (type === 'tripStart') {
      this.offerMotion(t, 'driving', at);
    } else if (type === 'tripEnd') {
      this.offerMotion(t, 'parked', at);
    } else if (type === 'tripMetrics') {
      if (!t.lastTrip || at > t.lastTrip.at) {
        const sec = num(d.tripTime);
        t.lastTrip = { at, miles: num(d.tripDistance), minutes: sec === null ? null : Math.round(sec / 60) };
      }
    } else if (type === 'vinChange') {
      if (typeof d.newVin === 'string' && d.newVin && d.newVin.length <= 32) t.vin = d.newVin;
    } else if (type === 'applicationGeozone' || type === 'userGeozone') {
      const loc = obj(d.location); // the zone's name is Mike's place name — not kept
      this.offerPos(t, loc?.lat, loc?.lon, loc?.heading, at);
    }
    // battery and mil: counted and timed, nothing else kept.
    this.heard(t, at);
    return 'kept';
  }

  // ----- the webhook -----

  /**
   * POST /webhooks/bouncie. Bouncie retries anything that is not a 2xx with a
   * JSON body, and switches off a webhook that keeps failing — so an
   * authentic call is ALWAYS answered 200 at once, even when its data is
   * dropped (link cut, keys missing, after hours, a bad body). A wrong or
   * missing key is 401. The answer never carries an Authorization header:
   * Bouncie would take that as a new webhook key.
   */
  async handleWebhook(
    h: { authorization?: unknown; xBouncie?: unknown },
    readBody: () => Promise<string | null>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!this.opts.webhookKey) {
      this.hook.refusedNotWired++;
      if (this.hook.refusedNotWired === 1 || this.hook.refusedNotWired % 100 === 0) {
        console.error(`[bouncie] webhook call refused — BOUNCIE_WEBHOOK_KEY is not set (${this.hook.refusedNotWired} since restart)`);
      }
      return { status: 503, body: { error: 'webhook_not_wired' } };
    }
    const viaAuth = sameKey(h.authorization, this.opts.webhookKey);
    const viaHeader = sameKey(h.xBouncie, this.opts.webhookKey);
    if (!viaAuth && !viaHeader) {
      this.hook.rejected++;
      this.hook.lastRejectedAt = new Date(this.now()).toISOString();
      if (this.hook.rejected === 1 || this.hook.rejected % 100 === 0) {
        console.error(`[bouncie] webhook call refused — wrong or missing key (${this.hook.rejected} since restart)`);
      }
      return { status: 401, body: { error: 'unauthorized' } };
    }
    const raw = await readBody();
    const nowIso = new Date(this.now()).toISOString();
    this.hook.lastAuthenticAt = nowIso;
    // Accept-and-drop: Bouncie must not switch the webhook off while Mike is still setting up.
    // Each drop is counted under its own reason, so Settings never shows a bare "0 kept" for it.
    if (!bouncieLinked()) {
      this.dropHeld();
      this.hook.whileCut++;
      this.hook.lastWhileCutAt = nowIso;
      return { status: 200, body: { ok: true } };
    }
    if (!this.configured()) {
      this.dropHeld();
      this.hook.droppedKeysMissing++;
      return { status: 200, body: { ok: true } };
    }
    if (!this.inHours()) {
      // Working hours only (§4.4): an update that arrives after hours is answered — so Bouncie keeps
      // the webhook on — and dropped UNREAD. Nothing is held after hours.
      this.dropHeld();
      this.hook.afterHours++;
      return { status: 200, body: { ok: true } };
    }
    this.hook.deliveries++;
    this.hook.lastAt = nowIso;
    if (raw === null) {
      this.hook.oversized++;
      return { status: 200, body: { ok: true } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.hook.badJson++;
      return { status: 200, body: { ok: true } };
    }
    const events = Array.isArray(parsed) ? parsed.slice(0, EVENTS_PER_BODY) : [parsed];
    const now = this.now();
    const firstEver = this.hook.received === 0;
    for (const ev of events) {
      const r = this.applyEvent(ev, now);
      if (r === 'kept') this.hook.received++;
      else if (r === 'after_hours') continue; // each after-hours report was counted where it was found
      else if (r === 'duplicate') this.hook.duplicates++;
      else if (r === 'unknown') this.hook.unknownTypes++;
      else if (r === 'full') this.hook.overCap++;
      else this.hook.badEvents++;
    }
    if (firstEver && this.hook.received > 0) {
      // Ids only, and only characters an id can have — nothing from the body reaches the log as written.
      const first = obj(events[0]);
      const type = typeof first?.eventType === 'string' && PAYLOAD_KEY.has(first.eventType) ? first.eventType : 'event';
      const dev = typeof first?.imei === 'string' ? ids(first.imei).replace(/[^0-9A-Za-z]/g, '?') : '????';
      console.log(`[bouncie] first live update since restart — ${type} from device …${dev}`);
    }
    return { status: 200, body: { ok: true } };
  }

  // ----- what the owner routes read -----

  /** A truck's id for the owner routes: steady while Arbo runs, never the device number. */
  private idOf(imei: string): string {
    return createHash('sha256').update(this.salt + imei).digest('hex').slice(0, 12);
  }

  /** Everything held about where the trucks are or went: positions, trips, the last read. */
  private dropHeld(): void {
    this.trucks.clear();
    this.tripCache.clear();
    this.lastRead = null;
  }

  /**
   * The server runs this once a minute (startServer). It never reads a truck and never throws.
   *   - Outside working hours (or with the link cut) nothing about the trucks is held — dropped
   *     within a minute of 8pm even when nobody asks; a request is not what makes it true.
   *   - A renewed sign-in Supabase would not take is saved again, whatever the hour: it is Arbo's
   *     own sign-in, not a location, and if Arbo restarts before it is saved the sign-in is lost.
   *   - The daily keep-alive (keepAlive): the one call to Bouncie the tick may make — a token swap —
   *     and, while the sign-in store could not be read, one read of that row at most hourly.
   */
  async tick(): Promise<void> {
    try {
      if (!bouncieLinked() || !this.inHours()) this.dropHeld();
      if (this.unsaved) await this.oneAtATime(() => this.saveUnsaved());
      await this.keepAlive();
    } catch {
      /* named where it happened (saveUnsaved / refresh / the store); the next tick tries again */
    }
  }

  /**
   * KEEP THE SIGN-IN ALIVE — Mike, 2026-10-20: "Keep the sign-in alive". Bouncie's
   * refresh token lapses if it goes unused for a while, and positions use it only
   * 8am–8pm, Monday to Saturday: 36 hours unused every weekend. So once a day,
   * WHATEVER THE HOUR (nights and Sunday included), a sign-in last renewed 20 hours
   * ago or more is renewed.
   *
   * It is the token swap and NOTHING ELSE: refresh() — the same single-flight
   * refresh a read uses, so the rotated pair is saved before anything uses it and a
   * store that refuses it keeps the old row (the new pair is held unused, NOT SAVED,
   * and the tick saves it). No vehicle, trip or position is asked for or kept.
   *
   * It never runs while the sign-in store is cut (ARBO_LINK_CREDENTIALS, read here
   * at every tick) or the sign-in is not connected — keys missing, not connected,
   * expired, a store problem, or a renewal still waiting to be saved. A failed one
   * is named in Settings (status().keepAlive) and tried again no more than hourly.
   *
   * A store problem would otherwise stop it for good: only ensureLoaded() clears
   * one, and nothing on the minute tick calls it (Settings does; the Fleet card
   * does not while positions are cut). So a sign-in store that could not be read —
   * at boot, or the look after a refused renewal — is read again HERE, no more
   * than hourly, and only while the switch is open (rereadFailedStore).
   */
  private async keepAlive(): Promise<void> {
    if (this.keepAliveBusy || !credentialLinkOpen()) return;
    this.keepAliveBusy = true;
    try {
      await this.rereadFailedStore();
      if (this.signInState() !== 'connected') return;
      await this.renewIfDue();
    } finally {
      this.keepAliveBusy = false;
    }
  }

  /** The sign-in store could not be read: read it again, at most hourly. Not configured needs a deploy, so it is not retried. */
  private async rereadFailedStore(): Promise<void> {
    const p = this.store.problemNow();
    if (!this.configured() || p === null || p === 'unconfigured' || this.unsaved) return;
    const at = this.store.lastLoad();
    if (at !== null && this.now() - at < KEEP_ALIVE_RETRY_MS) return;
    await this.store.load(this.now());
  }

  /** The renewal itself, on a connected sign-in: due 20 hours after the last one, a failure retried at most hourly. */
  private async renewIfDue(): Promise<void> {
    const rec = this.store.current();
    if (!rec) return;
    const now = this.now();
    const renewedAt = Date.parse(rec.savedAt);
    if (Number.isFinite(renewedAt) && now - renewedAt < KEEP_ALIVE_AFTER_MS) return; // renewed within 20 hours
    if (this.keepAliveFailedAt !== null && now - this.keepAliveFailedAt < KEEP_ALIVE_RETRY_MS) return; // at most hourly
    const gen = this.generation;
    const r = await this.oneAtATime(() => this.refresh(rec));
    if (gen !== this.generation) return; // a Connect landed meanwhile: newer than this renewal — not a failure
    if (r.ok) {
      this.keepAliveFailedAt = null;
      console.log('[bouncie] keep-alive: the sign-in is renewed');
      return;
    }
    if (this.unsaved) return; // renewed at Bouncie, not saved yet: NOT SAVED names it, and the tick saves it
    this.keepAliveFailedAt = now;
    console.error(`[bouncie] keep-alive: the sign-in was not renewed (${r.reason}) — Arbo tries again within the hour`);
  }

  /** A keep-alive failure still standing: none since, and the sign-in not renewed after it some other way. */
  private keepAliveFailure(): string | null {
    const f = this.keepAliveFailedAt;
    const rec = this.store.current();
    if (f === null || !rec || Date.parse(rec.savedAt) > f) return null;
    return new Date(f).toISOString();
  }

  private view(t: Truck, now: number): TruckView {
    const age = t.lastAt ? Math.max(0, now - t.lastAt) : null;
    const posAge = t.pos ? Math.max(0, now - t.pos.at) : null;
    // "Driving" needs a fresh FIX: a trip start or a battery reading with no
    // position never makes yesterday's fix look like this minute's. A parked
    // truck's fix stays true while it sits, so there staleness is "no report at all".
    // No fix because the newest report was after hours is its own state: not "no position yet".
    const motion: TruckMotion =
      t.motion === 'unplugged' ? 'unplugged'
        : posAge === null || age === null ? (t.afterHoursAt ? 'after_hours' : 'no_fix')
          : t.motion === 'driving' ? (posAge <= DRIVING_FRESH_MS ? 'driving' : 'stale')
            : age > PARKED_FRESH_MS ? 'stale'
              : t.motion === 'parked' ? 'parked' : 'seen';
    return {
      id: this.idOf(t.imei),
      name: t.name,
      vin4: t.vin ? ids(t.vin) : null,
      device4: ids(t.imei),
      lat: t.pos?.lat ?? null,
      lon: t.pos?.lon ?? null,
      heading: t.pos?.heading ?? null,
      reportedAt: t.lastAt ? new Date(t.lastAt).toISOString() : null,
      ageMinutes: age === null ? null : Math.floor(age / 60_000),
      positionAt: t.pos ? new Date(t.pos.at).toISOString() : null,
      positionAgeMinutes: posAge === null ? null : Math.floor(posAge / 60_000),
      motion,
      lastTrip: t.lastTrip ? { endedAt: new Date(t.lastTrip.at).toISOString(), miles: t.lastTrip.miles, minutes: t.lastTrip.minutes } : null,
    };
  }

  /**
   * Why Arbo will not read Bouncie right now, or null when it may — one order
   * for positions and trips: keys → link → sign-in store → sign-in → hours.
   * A cut link and after hours drop everything held (nothing is kept then).
   */
  private async readGate(): Promise<Gate | null> {
    if (!this.configured()) return 'keys_missing';
    if (!bouncieLinked()) {
      this.dropHeld();
      return 'link_cut';
    }
    await this.ensureLoaded();
    const signIn = this.signInState();
    if (signIn === 'store_cut') return 'sign_in_cut'; // on purpose: its own words, grey — never "can't open it"
    if (signIn.startsWith('store_')) return 'sign_in_store';
    if (signIn === 'not_connected') return 'not_connected';
    if (signIn === 'expired') return 'token_expired';
    if (!this.inHours()) {
      this.dropHeld();
      return 'after_hours';
    }
    return null; // connected, or a renewed sign-in waiting to be saved (the read saves it first, or says why not)
  }

  private static failState(r: TokenFail): 'token_expired' | 'not_connected' | 'sign_in_store' | 'unreadable' {
    return r.reason === 'expired' ? 'token_expired' : r.reason === 'not_connected' ? 'not_connected' : r.reason === 'store' ? 'sign_in_store' : 'unreadable';
  }

  /** Read Bouncie (cached) when the link is live, the sign-in is good and it is working hours; say which state otherwise. */
  private async positionsState(): Promise<{ state: PositionsState; readAt: string | null }> {
    const gate = await this.readGate();
    if (gate) return { state: gate, readAt: null };
    const r = await this.read();
    const readAt = this.lastReadOkAt();
    if (!r.ok) return { state: Bouncie.failState(r), readAt };
    return { state: this.trucks.size ? 'ok' : 'no_trucks', readAt };
  }

  private lastReadOkAt(): string | null {
    return this.lastRead && this.lastRead.outcome.ok ? new Date(this.lastRead.outcome.at).toISOString() : null;
  }

  /**
   * GET /api/fleet/positions. `units` is the Fleet list as the fleet route
   * answered it (or why it could not). Positions are listed only while the
   * link is live; every other state is named, and "no_trucks" is said only
   * after Bouncie itself answered with none.
   */
  async positions(units: { ok: true; units: UnitLite[] } | { ok: false; error: string }) {
    const { state, readAt } = await this.positionsState();
    const now = this.now();
    const live = state === 'ok' || state === 'unreadable';
    const trucks = live ? [...this.trucks.values()] : [];
    const { matched, unmatched } = units.ok
      ? matchTrucks(units.units, trucks)
      : { matched: new Map<string, { truck: Truck; by: 'vin' | 'name' }>(), unmatched: trucks };
    return {
      state,
      message: POSITIONS_SAYS[state],
      readAt,
      units: units.ok
        ? units.units.map((u) => {
          const m = matched.get(u.id);
          return { unitId: u.id, unitName: u.name, match: m ? m.by : null, truck: m ? this.view(m.truck, now) : null };
        })
        : null,
      unitsError: units.ok ? null : units.error,
      unmatched: unmatched.map((t) => this.view(t, now)),
    };
  }

  /**
   * GET /api/fleet/trips?truck=<id>&day=YYYY-MM-DD — one truck's trips on one
   * day, inside working hours only. `truck` is the id /api/fleet/positions
   * hands out, never the device number: a query string lands in request logs,
   * and the logs carry the last 4 of a device id at most.
   *
   * The window asked of Bouncie is the day's working hours (never more than
   * Bouncie's one-week limit), so it never sends an after-hours trip; any trip
   * that still starts or ends outside them is dropped unread and counted.
   * Outside working hours nothing is read at all, by name.
   */
  async trips(q: { truck: string | null; day: string | null }): Promise<{ status: number; body: Record<string, unknown> }> {
    const now = this.now();
    const day = q.day ?? '';
    if (!realDay(day) || day < EARLIEST_TRIP_DAY || day > etParts(now).day) {
      return { status: 400, body: { error: 'bad_day', message: `day must be a date written YYYY-MM-DD, from ${EARLIEST_TRIP_DAY} to today.` } };
    }
    if (!q.truck || !/^[0-9a-f]{12}$/.test(q.truck)) {
      return { status: 400, body: { error: 'bad_truck', message: 'truck must be a truck id from /api/fleet/positions.' } };
    }
    const gate = await this.readGate();
    if (gate) return { status: 200, body: { state: gate, message: TRIPS_SAYS[gate], day, trips: [] } };
    const find = () => [...this.trucks.values()].find((x) => this.idOf(x.imei) === q.truck);
    let t = find();
    if (!t) {
      // Not held now (after hours drops everything, so every morning starts empty): look at Bouncie's
      // list first — the once-a-minute vehicles read — before calling the id unknown. A failed look is
      // "couldn't read", never "unknown truck".
      const look = await this.read();
      if (!look.ok) {
        const state = Bouncie.failState(look);
        return { status: 200, body: { state, message: TRIPS_SAYS[state], day, trips: [] } };
      }
      t = find();
    }
    if (!t) {
      return { status: 404, body: { error: 'unknown_truck', message: 'Arbo doesn’t know that truck id: it isn’t in Bouncie’s list now, or Arbo restarted since it was handed out (ids change on a restart). Read /api/fleet/positions again for the current ones.' } };
    }
    const truck = { id: q.truck, name: t.name, device4: ids(t.imei) };
    const w = workingWindow(day);
    if (!w) return { status: 200, body: { state: 'not_a_working_day', message: TRIPS_SAYS.not_a_working_day, day, truck, trips: [] } };
    const to = Math.min(w.to, now);
    if (to <= w.from || to - w.from > MAX_TRIP_WINDOW_MS) {
      return { status: 400, body: { error: 'bad_window', message: 'That day’s working hours have not started yet.' } };
    }
    const key = `${t.imei}|${day}`;
    const hit = this.tripCache.get(key);
    if (hit && now - hit.at < TRIPS_EVERY_MS) return { status: 200, body: hit.body };
    const query = new URLSearchParams({ imei: t.imei, 'gps-format': 'geojson', 'starts-after': new Date(w.from).toISOString(), 'ends-before': new Date(to).toISOString() });
    const r = await this.authedGet(`${API_BASE}trips?${query.toString()}`);
    if (!r.ok) {
      const state = Bouncie.failState(r);
      return { status: 200, body: { state, message: TRIPS_SAYS[state], day, truck, trips: [] } };
    }
    if (!Array.isArray(r.body)) return { status: 200, body: { state: 'unreadable', message: TRIPS_SAYS.unreadable, day, truck, trips: [] } };
    const skipped = { outsideHours: 0, unreadable: 0, overCap: Math.max(0, r.body.length - TRIPS_CAP) };
    const trips: Array<Record<string, unknown>> = [];
    for (const x of r.body.slice(0, TRIPS_CAP)) {
      const o = obj(x);
      const start = tsOf(o?.startTime, now);
      const end = tsOf(o?.endTime, now);
      if (!o || start === null || end === null || end < start) {
        skipped.unreadable++;
        continue;
      }
      if (start < w.from || end > to || !this.inHoursAt(start) || !this.inHoursAt(end)) {
        skipped.outsideHours++; // dropped unread: not even its distance is kept
        continue;
      }
      const path = tripPath(o.gps);
      trips.push({
        // Bouncie's transactionId carries the full device number: only a salted hash of it leaves the server.
        id: createHash('sha256').update(this.salt + (typeof o.transactionId === 'string' ? o.transactionId : `${t.imei}|${start}`)).digest('hex').slice(0, 12),
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
        minutes: Math.round((end - start) / 60_000),
        miles: num(o.distance),
        path: path ? path.points : null,
        pathPoints: path ? path.points.length : 0,
        pathThinned: path ? path.thinned : false,
        pathUnreadablePoints: path ? path.unreadable : null, // points Bouncie sent that could not be read: dropped, counted
      });
    }
    trips.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    // §1B: a trip that could not be read may have been inside the hours, so none read is NOT "no trips".
    const state: TripsState = trips.length ? 'ok' : skipped.unreadable > 0 ? 'unreadable' : 'no_trips';
    const n = skipped.unreadable;
    const unreadNote = `${n} ${n === 1 ? 'trip' : 'trips'} Bouncie sent couldn’t be read and ${n === 1 ? 'isn’t' : 'aren’t'} shown.`;
    const message = n === 0 ? TRIPS_SAYS[state]
      : state === 'ok' ? `${TRIPS_SAYS.ok} ${unreadNote}`
        : `Bouncie answered, but ${unreadNote} This is not "no trips".`;
    const body = { state, message, day, truck, window: { from: new Date(w.from).toISOString(), to: new Date(to).toISOString() }, trips, skipped, readAt: new Date(now).toISOString() };
    if (this.tripCache.size >= TRIPS_CACHE_CAP) {
      const oldest = this.tripCache.keys().next().value;
      if (oldest !== undefined) this.tripCache.delete(oldest);
    }
    this.tripCache.set(key, { at: now, body });
    return { status: 200, body };
  }

  /** GET /api/bouncie — the Settings card. Booleans, counts and times; never a key, a token or a position. */
  async status() {
    await this.ensureLoaded();
    const p = await this.positionsState();
    const known = [...this.trucks.values()];
    const last = known.reduce((m, t) => Math.max(m, t.lastAt), 0);
    return {
      keys: { clientId: Boolean(this.opts.clientId), clientSecret: Boolean(this.opts.clientSecret), webhookKey: this.webhookWired(), apiKey: Boolean(this.opts.apiKeySet) },
      signIn: { state: this.signInState(), ...this.store.status() },
      // Mike, 2026-10-20: "Keep the sign-in alive" — a renewal that failed, by when; null once one succeeds.
      keepAlive: { failedAt: this.keepAliveFailure() },
      link: { envVar: BOUNCIE_LINK_ENV, open: bouncieLinked() },
      positions: { state: p.state, readAt: p.readAt },
      trucks: { known: known.length, lastReportAt: last ? new Date(last).toISOString() : null },
      webhook: { wired: this.webhookWired(), url: BOUNCIE_WEBHOOK_URL, ...this.hook },
      redirectUri: BOUNCIE_REDIRECT,
    };
  }

  /** One boot line: states only. */
  bootLine(): string {
    const s = this.store.status();
    const kept = s.problem ? ` (sign-in store: ${s.problem})` : s.stored ? ` (kept on ${s.where})` : '';
    return `sign-in ${this.signInState()}${kept}; webhook ${this.webhookWired() ? 'wired' : 'NOT wired'}; link ${bouncieLinked() ? 'live' : `CUT (${BOUNCIE_LINK_ENV} is not "live")`}`;
  }
}

/** One sentence per state — §1B: none of these may read like another. */
export const POSITIONS_SAYS: Record<PositionsState, string> = {
  keys_missing: 'Bouncie is not set up on the server — BOUNCIE_CLIENT_ID and BOUNCIE_CLIENT_SECRET are missing. This is not "no trucks".',
  link_cut: 'Truck tracking is cut on purpose (ARBO_LINK_BOUNCIE is not "live"). Nothing is read while it is cut. This is not "no trucks".',
  sign_in_cut: 'The Bouncie sign-in store in Supabase is cut on purpose (ARBO_LINK_CREDENTIALS is not "live"), so there is no sign-in to read with. Nothing is read while it is cut. This is not "no trucks".',
  sign_in_store: 'Arbo can’t open the saved Bouncie sign-in right now — Settings → Bouncie says why. This is not "no trucks".',
  not_connected: 'Bouncie is set up but not connected — connect it in Settings. This is not "no trucks".',
  token_expired: 'The Bouncie sign-in expired or was removed — reconnect it in Settings. This is not "no trucks".',
  after_hours: 'After hours — Arbo tracks trucks only 8am–8pm, Monday to Saturday, so it reads and keeps no positions now. Tracking resumes at 8am on the next working day. This is not "no trucks".',
  unreadable: 'Arbo could not read Bouncie just now. This is not "no trucks".',
  no_trucks: 'Bouncie answered and lists no trucks on this account.',
  ok: 'Positions from Bouncie.',
};

/** The same, for one truck's trips — §1B: "couldn't read" and "after hours" are never "no trips". */
export const TRIPS_SAYS: Record<TripsState, string> = {
  keys_missing: 'Bouncie is not set up on the server — BOUNCIE_CLIENT_ID and BOUNCIE_CLIENT_SECRET are missing. This is not "no trips".',
  link_cut: 'Truck tracking is cut on purpose (ARBO_LINK_BOUNCIE is not "live"). Nothing is read while it is cut. This is not "no trips".',
  sign_in_cut: 'The Bouncie sign-in store in Supabase is cut on purpose (ARBO_LINK_CREDENTIALS is not "live"), so there is no sign-in to read with. Nothing is read while it is cut. This is not "no trips".',
  sign_in_store: 'Arbo can’t open the saved Bouncie sign-in right now — Settings → Bouncie says why. This is not "no trips".',
  not_connected: 'Bouncie is set up but not connected — connect it in Settings. This is not "no trips".',
  token_expired: 'The Bouncie sign-in expired or was removed — reconnect it in Settings. This is not "no trips".',
  after_hours: 'After hours — Arbo reads no trips outside 8am–8pm, Monday to Saturday. Tracking resumes at 8am on the next working day. This is not "no trips".',
  not_a_working_day: 'That day has no working hours (Sunday), so Arbo reads no trips for it. This is not "no trips".',
  unreadable: 'Arbo could not read Bouncie’s trips just now. This is not "no trips".',
  no_trips: 'Bouncie answered: this truck has no trips inside working hours that day.',
  ok: 'Trips from Bouncie, inside working hours only.',
};

/**
 * A trip's path from Bouncie's GeoJSON (GeoJSON order is [lon, lat]), as
 * {lat, lon} points — a LineString, a Feature, or the first feature of a
 * collection; it may arrive as text. Thinned evenly (the last point kept)
 * past the cap. Null when it can't be read — including coordinates of which
 * not one reads (a MultiLineString, a Point): never an empty path standing in
 * for one. A point that doesn't read is dropped and counted (`unreadable`).
 */
function tripPath(gps: unknown): { points: Array<{ lat: number; lon: number }>; thinned: boolean; unreadable: number } | null {
  let g: unknown = gps;
  if (typeof g === 'string') {
    if (g.length > GPS_TEXT_CAP) return null;
    try {
      g = JSON.parse(g);
    } catch {
      return null;
    }
  }
  const o = obj(g);
  const feature = o && Array.isArray(o.features) ? obj(o.features[0]) : o;
  const geom = obj(feature?.geometry) ?? feature;
  const coords = geom && Array.isArray(geom.coordinates) ? (geom.coordinates as unknown[]) : null;
  if (!coords) return null;
  const step = Math.max(1, Math.ceil(coords.length / TRIP_POINTS_CAP));
  const points: Array<{ lat: number; lon: number }> = [];
  let unreadable = 0;
  const take = (p: unknown): void => {
    const c = Array.isArray(p) ? coord(p[1], p[0]) : null;
    if (c) points.push(c);
    else unreadable++;
  };
  for (let i = 0; i < coords.length; i += step) take(coords[i]);
  // Thinning can step past the last point; the trip still ends where it ended.
  const lastIndex = coords.length - 1;
  if (step > 1 && lastIndex % step !== 0) take(coords[lastIndex]);
  if (unreadable > 0 && points.length === 0) return null;
  return { points, thinned: step > 1, unreadable };
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * The page Mike lands on after Bouncie's approval screen — never blank, and
 * never the code or state again. /app#settings is not a deep link in the
 * app, so this page says where to look instead of pretending to send him there.
 */
export function callbackPage(r: CallbackResult): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="referrer" content="no-referrer"><title>Arbo — Bouncie</title><style>@font-face{font-family:Fraunces;src:url(/fonts/fraunces.woff2) format('woff2');font-weight:300 800}@font-face{font-family:'Instrument Sans';src:url(/fonts/instrument-sans.woff2) format('woff2');font-weight:400 700}body{font-family:'Instrument Sans',system-ui,sans-serif;background:#F7F5F0;color:#13201A;max-width:520px;margin:0 auto;padding:56px 20px;line-height:1.6}h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:1.8rem;color:${r.ok ? '#1B4D3E' : '#8A3B12'}}p{color:#3B4A43}a.btn{display:inline-block;margin-top:12px;background:linear-gradient(180deg,#245F4D,#1B4D3E);color:#fff;text-decoration:none;font-weight:700;padding:15px 30px;border-radius:16px}@media (prefers-color-scheme:dark){body{background:#0B1512;color:#EAF1EC}h1{color:${r.ok ? '#5FB08F' : '#E8A07A'}}p{color:#C5D2CA}}</style></head><body><h1>${esc(r.title)}</h1><p>${esc(r.line)}</p><p>In Arbo: Settings (the gear at the top) → Bouncie (truck tracking) shows where it stands.</p><a class="btn" href="/app">Back to the app</a></body></html>`;
}
