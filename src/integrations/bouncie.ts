// Bouncie truck tracking (R31 — Mike, 2026-10-20: "why dont you build
// and then i add later"). Built complete and DORMANT: nothing happens until
// Mike adds BOUNCIE_CLIENT_ID / BOUNCIE_CLIENT_SECRET on Railway, taps
// Connect Bouncie, adds BOUNCIE_WEBHOOK_KEY, and sets ARBO_LINK_BOUNCIE=live.
// Steps for Mike: docs/BOUNCIE.md.
//
// The rules this file keeps, each one structural:
//   - OWNER ONLY. Truck positions are read by the owner routes and nothing
//     else; the crew door has no route to them (the policy engine already
//     walls 'tracking'/'bouncie' off every crew surface).
//   - READ ONLY. The one POST is the sign-in token swap; every other call is
//     a GET of /v1/vehicles. `allowed()` refuses anything else before it
//     leaves the process — no webhook setup, no geo-zones, no settings.
//   - A NAMED LINK that fails closed: positions are held and shown only when
//     ARBO_LINK_BOUNCIE is exactly 'live' (same rule as vendorLinks.ts). A
//     cut link is NAMED, never "no trucks" (§1B).
//   - MEMORY ONLY. The latest position per truck, held in this process — no
//     database, no history. A redeploy forgets it; Bouncie fills it back in.
//   - SECRETS stay server-side: the tokens live in one file on the storage
//     disk (mode 0600, written atomically, like the Google token), never in
//     a response, never in a log. Logs carry counts and the last 4 of a
//     device id at most — never a coordinate, an address, or a full VIN.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const AUTHORIZE_URL = 'https://auth.bouncie.com/dialog/authorize';
export const TOKEN_URL = 'https://auth.bouncie.com/oauth/token';
export const API_BASE = 'https://api.bouncie.dev/v1/';
/** Mike registers EXACTLY this redirect in the Bouncie portal (docs/BOUNCIE.md). */
const PUBLIC_ORIGIN = 'https://arbor-server-production.up.railway.app';
export const BOUNCIE_REDIRECT = `${PUBLIC_ORIGIN}/bouncie/callback`;
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
const DRIVING_FRESH_MS = 15 * 60_000; // "driving" with no report for 15 min is not driving any more — it is stale
const PARKED_FRESH_MS = 24 * 60 * 60_000; // after a day without a report Arbo stops saying "parked"
const FUTURE_SLACK_MS = 5 * 60_000; // a device clock ahead of ours by more than this is a bad timestamp
const TRUCK_CAP = 50;
const SEEN_CAP = 5_000;
const EVENTS_PER_BODY = 500;
const POINTS_PER_EVENT = 1_000;
const PAGE = 10; // the page size Bouncie's own docs use — a larger one could be refused
const MAX_PAGES = 5;

export type BouncieHttp = (
  url: string,
  // redirect 'error': fetch follows a 3xx by default and a 307/308 re-sends the
  // body — the client secret and the refresh token — to wherever it points.
  // allowed() checks the first address only, so a redirect is a failure instead.
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; redirect: 'error'; signal?: RequestInit['signal'] },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultHttp: BouncieHttp = (url, init) => fetch(url, init);

/** The only two calls Arbo ever makes to Bouncie. Everything else is refused before it leaves. */
function allowed(method: 'GET' | 'POST', url: string): boolean {
  return method === 'POST' ? url === TOKEN_URL : url.startsWith(`${API_BASE}vehicles?`);
}

// ---------- the token on the storage disk ----------

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

/** One JSON file in ARBO_SECRET_DIR (default /data), 0600, tmp + rename. No disk = memory, and the status says so. */
export class BouncieTokenStore {
  private rec: TokenRecord | null = null;
  private where: 'disk' | 'memory' | null = null;

  constructor(private readonly dir: string = process.env.ARBO_SECRET_DIR ?? '/data') {
    try {
      this.rec = asTokenRecord(JSON.parse(readFileSync(join(this.dir, TOKEN_FILE), 'utf8')));
      if (this.rec) this.where = 'disk';
    } catch {
      /* nothing stored yet, or no disk — status says which */
    }
  }

  current(): TokenRecord | null {
    return this.rec;
  }

  /** Swap in a new pair. Memory first, then the disk; never throws for a missing disk. */
  save(rec: TokenRecord): 'disk' | 'memory' {
    this.rec = rec;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const tmp = join(this.dir, `${TOKEN_FILE}.tmp`);
      writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
      renameSync(tmp, join(this.dir, TOKEN_FILE));
      this.where = 'disk';
    } catch {
      this.where = 'memory';
    }
    return this.where;
  }

  /** Where the sign-in lives and when it was saved — never the token. */
  status(): { stored: boolean; where: 'disk' | 'memory' | null; savedAt: string | null } {
    return { stored: this.rec !== null, where: this.where, savedAt: this.rec?.savedAt ?? null };
  }
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
  lastTrip: { at: number; miles: number | null; minutes: number | null } | null;
}

/** 'seen' = a fresh position with no word yet on whether it is moving (a geo-zone event alone). */
export type TruckMotion = Motion | 'seen' | 'stale' | 'no_fix';

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
  dir?: string;
  http?: BouncieHttp;
  now?: () => number;
}

type TokenAnswer =
  | { ok: true; accessToken: string; refreshToken: string | null; expiresInSec: number }
  | { ok: false; reason: 'rejected'; status: number }
  | { ok: false; reason: 'unreachable' | 'bad_answer' };

type TokenOutcome = { ok: true; token: string } | { ok: false; reason: 'not_connected' | 'expired' | 'unreadable' };

type ReadOutcome = { ok: true; at: number } | { ok: false; reason: 'not_connected' | 'expired' | 'unreadable' };

export type SignInState = 'keys_missing' | 'not_connected' | 'expired' | 'connected';
export type PositionsState = 'keys_missing' | 'link_cut' | 'not_connected' | 'token_expired' | 'unreadable' | 'no_trucks' | 'ok';

export interface CallbackResult { status: number; ok: boolean; title: string; line: string }

export class Bouncie {
  readonly store: BouncieTokenStore;
  private readonly states = new OAuthStates();
  private readonly http: BouncieHttp;
  private readonly now: () => number;
  private readonly trucks = new Map<string, Truck>();
  private readonly seen = new Set<string>();
  private readonly salt = randomBytes(16).toString('hex');
  private refreshing: Promise<TokenOutcome> | null = null;
  private generation = 0; // bumped by every Connect, so a refresh from an older sign-in never overwrites a newer one
  private expired = false; // Bouncie refused our refresh token (or the app lost access): only Reconnect clears it
  private lastRead: { at: number; outcome: ReadOutcome } | null = null;
  private reading: Promise<ReadOutcome> | null = null;
  private refusedSignIns = 0;
  private readonly hook = {
    deliveries: 0, // authentic calls while the link is open, whatever was in them
    received: 0, // events kept
    lastAt: null as string | null,
    whileCut: 0,
    lastWhileCutAt: null as string | null,
    droppedKeysMissing: 0, // authentic, link open, but no BOUNCIE_CLIENT_ID / SECRET: answered and dropped
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
    this.store = new BouncieTokenStore(opts.dir);
    this.http = opts.http ?? defaultHttp;
    this.now = opts.now ?? Date.now;
  }

  /** Both sign-in keys are on the server. The webhook key is separate (webhookWired). */
  configured(): boolean {
    return Boolean(this.opts.clientId && this.opts.clientSecret);
  }

  webhookWired(): boolean {
    return Boolean(this.opts.webhookKey);
  }

  signInState(): SignInState {
    if (!this.configured()) return 'keys_missing';
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

  // ----- Connect -----

  /** Mint a state + PKCE verifier and hand back where to send Mike. Owner key checked by the route. */
  beginConnect(): { ok: true; authorizeUrl: string } | { ok: false; error: 'bouncie_keys_missing' } {
    if (!this.opts.clientId || !this.opts.clientSecret) return { ok: false, error: 'bouncie_keys_missing' };
    const { state, verifier } = this.states.mint(this.now());
    return { ok: true, authorizeUrl: authorizeUrl(this.opts.clientId, state, verifier) };
  }

  /** The callback: state check → code swap → token saved. Every outcome is a sentence; none repeats the code or state. */
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
    this.generation++;
    this.expired = false;
    this.lastRead = null;
    const where = this.store.save({ accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: now + r.expiresInSec * 1000, savedAt: new Date(now).toISOString() });
    console.log(`[bouncie] connected — sign-in kept on ${where}`);
    const cut = bouncieLinked() ? '' : ' Truck positions stay off until ARBO_LINK_BOUNCIE is set to live on Railway.';
    return where === 'disk'
      ? { status: 200, ok: true, title: 'Bouncie is connected', line: `The sign-in is saved on Arbo’s storage disk and survives redeploys.${cut}` }
      : { status: 200, ok: true, title: 'Bouncie is connected — for now', line: `There is no storage disk, so the sign-in is held in memory and will need connecting again after the next restart.${cut}` };
  }

  // ----- the access token: refreshed early, one refresh at a time, rotation saved before use -----

  /**
   * A usable access token. `rejected` is the token Bouncie just answered 401
   * to: if it is still the current one, refresh now; if someone already
   * refreshed past it, hand back the newer one without a second refresh.
   */
  async accessToken(rejected?: string): Promise<TokenOutcome> {
    const rec = this.store.current();
    if (!rec) return { ok: false, reason: 'not_connected' };
    if (this.expired) return { ok: false, reason: 'expired' };
    const due = rejected === undefined ? rec.expiresAt - EXPIRY_MARGIN_MS <= this.now() : rec.accessToken === rejected;
    if (!due) return { ok: true, token: rec.accessToken };
    if (!this.refreshing) {
      this.refreshing = this.refresh(rec).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refresh(rec: TokenRecord): Promise<TokenOutcome> {
    const gen = this.generation;
    const r = await this.tokenCall({
      client_id: this.opts.clientId ?? '',
      client_secret: this.opts.clientSecret ?? '',
      grant_type: 'refresh_token',
      refresh_token: rec.refreshToken,
    });
    if (gen !== this.generation) {
      // Mike connected again while this was in flight: the new sign-in wins and this answer is dropped unsaved.
      const cur = this.store.current();
      return cur && !this.expired ? { ok: true, token: cur.accessToken } : { ok: false, reason: 'not_connected' };
    }
    if (!r.ok) {
      if (r.reason === 'rejected') {
        this.expired = true;
        console.error('[bouncie] refresh refused — the sign-in expired or was removed; Mike reconnects in Settings');
        return { ok: false, reason: 'expired' };
      }
      // Network or a Bouncie outage: the old pair is kept and tried again next time.
      console.error(`[bouncie] refresh failed: ${r.reason} — will try again`);
      return { ok: false, reason: 'unreadable' };
    }
    // Bouncie rotates the refresh token: the old one is already dead. The new
    // pair is saved (memory, then disk) BEFORE the new access token is used.
    const now = this.now();
    const where = this.store.save({
      accessToken: r.accessToken,
      refreshToken: r.refreshToken ?? rec.refreshToken,
      expiresAt: now + r.expiresInSec * 1000,
      savedAt: new Date(now).toISOString(),
    });
    if (where === 'memory') console.error('[bouncie] refreshed, but the new sign-in is in memory only (no storage disk)');
    return { ok: true, token: r.accessToken };
  }

  private markExpired(): void {
    this.expired = true;
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

  private async readVehicles(): Promise<ReadOutcome> {
    let tok = await this.accessToken();
    if (!tok.ok) return tok;
    const found: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${API_BASE}vehicles?limit=${PAGE}${page ? `&skip=${page * PAGE}` : ''}`;
      let res = await this.get(url, tok.token);
      if (res && res.status === 401) {
        const again = await this.accessToken(tok.token);
        if (!again.ok) return again;
        tok = again;
        res = await this.get(url, tok.token);
        if (res && res.status === 401) {
          this.markExpired();
          return { ok: false, reason: 'expired' };
        }
      }
      if (!res || !res.ok) return { ok: false, reason: 'unreadable' };
      const body = await res.json().catch(() => null);
      if (!Array.isArray(body)) return { ok: false, reason: 'unreadable' };
      found.push(...body.slice(0, TRUCK_CAP));
      if (body.length < PAGE) break;
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
    const fresh: Truck = { imei, vin: null, name: null, pos: null, motion: null, motionAt: 0, lastAt: 0, hookAt: 0, lastTrip: null };
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

  /** The newest timestamp wins, whatever order the reports arrive in — a late burst never moves a truck backwards. */
  private offerPos(t: Truck, lat: unknown, lon: unknown, heading: unknown, at: number): void {
    const c = coord(lat, lon);
    if (!c || (t.pos && at <= t.pos.at)) return;
    t.pos = { ...c, heading: num(heading), at };
  }

  /** Same rule for driving/parked/unplugged; at the same instant an end outranks a data point. */
  private offerMotion(t: Truck, m: Motion, at: number): void {
    if (at > t.motionAt || (at === t.motionAt && (!t.motion || MOTION_RANK[m] > MOTION_RANK[t.motion]))) {
      t.motion = m;
      t.motionAt = at;
    }
  }

  private touch(t: Truck, at: number): void {
    if (at > t.lastAt) t.lastAt = at;
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
    const loc = obj(s.location); // its street address is never read
    if (loc) this.offerPos(t, loc.lat, loc.lon, loc.heading, at);
    if (typeof s.isRunning === 'boolean') this.offerMotion(t, s.isRunning ? 'driving' : 'parked', at);
    this.touch(t, at);
  }

  /** One webhook event into memory. Returns what happened to it, for the counts. */
  private applyEvent(ev: unknown, now: number): 'kept' | 'duplicate' | 'unknown' | 'bad' | 'full' {
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
      for (const p of points) {
        const q = obj(p);
        const at = tsOf(q?.timestamp, now);
        if (!q || at === null) {
          bad++;
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
      return fresh > 0 ? 'kept' : bad === points.length ? 'bad' : 'duplicate';
    }
    const d = obj(e[key]);
    const at = tsOf(d?.timestamp, now);
    if (!d || at === null) return 'bad';
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
   * dropped (link cut, keys missing, a bad body). A wrong or missing key is
   * 401. The answer never carries an Authorization header: Bouncie would
   * take that as a new webhook key.
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
      this.trucks.clear();
      this.hook.whileCut++;
      this.hook.lastWhileCutAt = nowIso;
      return { status: 200, body: { ok: true } };
    }
    if (!this.configured()) {
      this.trucks.clear();
      this.hook.droppedKeysMissing++;
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

  private view(t: Truck, now: number): TruckView {
    const age = t.lastAt ? Math.max(0, now - t.lastAt) : null;
    const posAge = t.pos ? Math.max(0, now - t.pos.at) : null;
    // "Driving" needs a fresh FIX: a trip start or a battery reading with no
    // position never makes yesterday's fix look like this minute's. A parked
    // truck's fix stays true while it sits, so there staleness is "no report at all".
    const motion: TruckMotion =
      t.motion === 'unplugged' ? 'unplugged'
        : posAge === null || age === null ? 'no_fix'
          : t.motion === 'driving' ? (posAge <= DRIVING_FRESH_MS ? 'driving' : 'stale')
            : age > PARKED_FRESH_MS ? 'stale'
              : t.motion === 'parked' ? 'parked' : 'seen';
    return {
      id: createHash('sha256').update(this.salt + t.imei).digest('hex').slice(0, 12),
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

  /** Read Bouncie (cached) when the link is live and the sign-in is good; say which state otherwise. */
  private async positionsState(): Promise<{ state: PositionsState; readAt: string | null }> {
    if (!this.configured()) return { state: 'keys_missing', readAt: null };
    if (!bouncieLinked()) {
      this.trucks.clear(); // nothing is held while the link is cut
      return { state: 'link_cut', readAt: null };
    }
    const signIn = this.signInState();
    if (signIn === 'not_connected') return { state: 'not_connected', readAt: null };
    if (signIn === 'expired') return { state: 'token_expired', readAt: null };
    const r = await this.read();
    const readAt = this.lastReadOkAt();
    if (!r.ok) return { state: r.reason === 'expired' ? 'token_expired' : r.reason === 'not_connected' ? 'not_connected' : 'unreadable', readAt };
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

  /** GET /api/bouncie — the Settings card. Booleans, counts and times; never a key, a token or a position. */
  async status() {
    const p = await this.positionsState();
    const known = [...this.trucks.values()];
    const last = known.reduce((m, t) => Math.max(m, t.lastAt), 0);
    return {
      keys: { clientId: Boolean(this.opts.clientId), clientSecret: Boolean(this.opts.clientSecret), webhookKey: this.webhookWired() },
      signIn: { state: this.signInState(), ...this.store.status() },
      link: { envVar: BOUNCIE_LINK_ENV, open: bouncieLinked() },
      positions: { state: p.state, readAt: p.readAt },
      trucks: { known: known.length, lastReportAt: last ? new Date(last).toISOString() : null },
      webhook: { wired: this.webhookWired(), url: BOUNCIE_WEBHOOK_URL, ...this.hook },
      redirectUri: BOUNCIE_REDIRECT,
    };
  }

  /** One boot line: states only. */
  bootLine(): string {
    return `sign-in ${this.signInState()}${this.store.current() ? ` (kept on ${this.store.status().where})` : ''}; webhook ${this.webhookWired() ? 'wired' : 'NOT wired'}; link ${bouncieLinked() ? 'live' : `CUT (${BOUNCIE_LINK_ENV} is not "live")`}`;
  }
}

/** One sentence per state — §1B: none of these may read like another. */
export const POSITIONS_SAYS: Record<PositionsState, string> = {
  keys_missing: 'Bouncie is not set up on the server — BOUNCIE_CLIENT_ID and BOUNCIE_CLIENT_SECRET are missing. This is not "no trucks".',
  link_cut: 'Truck tracking is cut on purpose (ARBO_LINK_BOUNCIE is not "live"). Nothing is read while it is cut. This is not "no trucks".',
  not_connected: 'Bouncie is set up but not connected — connect it in Settings. This is not "no trucks".',
  token_expired: 'The Bouncie sign-in expired or was removed — reconnect it in Settings. This is not "no trucks".',
  unreadable: 'Arbo could not read Bouncie just now. This is not "no trucks".',
  no_trucks: 'Bouncie answered and lists no trucks on this account.',
  ok: 'Positions from Bouncie.',
};

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * The page Mike lands on after Bouncie's approval screen — never blank, and
 * never the code or state again. /app#settings is not a deep link in the
 * app, so this page says where to look instead of pretending to send him there.
 */
export function callbackPage(r: CallbackResult): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="referrer" content="no-referrer"><title>Arbo — Bouncie</title><style>@font-face{font-family:Fraunces;src:url(/fonts/fraunces.woff2) format('woff2');font-weight:300 800}@font-face{font-family:'Instrument Sans';src:url(/fonts/instrument-sans.woff2) format('woff2');font-weight:400 700}body{font-family:'Instrument Sans',system-ui,sans-serif;background:#F7F5F0;color:#13201A;max-width:520px;margin:0 auto;padding:56px 20px;line-height:1.6}h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:1.8rem;color:${r.ok ? '#1B4D3E' : '#8A3B12'}}p{color:#3B4A43}a.btn{display:inline-block;margin-top:12px;background:linear-gradient(180deg,#245F4D,#1B4D3E);color:#fff;text-decoration:none;font-weight:700;padding:15px 30px;border-radius:16px}@media (prefers-color-scheme:dark){body{background:#0B1512;color:#EAF1EC}h1{color:${r.ok ? '#5FB08F' : '#E8A07A'}}p{color:#C5D2CA}}</style></head><body><h1>${esc(r.title)}</h1><p>${esc(r.line)}</p><p>In Arbo: Settings (the gear at the top) → Bouncie (truck tracking) shows where it stands.</p><a class="btn" href="/app">Back to the app</a></body></html>`;
}
