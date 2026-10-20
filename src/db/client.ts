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
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { linkForTable, linkOpen, LinkCutError, ReadOnlyError } from './links.js';

// The ARBOR backend talks to Supabase with the SERVICE ROLE key only (§4.3).
// The service role bypasses RLS; no other key can read customer PII. This key
// is server-side and never shipped to a client.

let _client: SupabaseClient | null = null;
let _guarded: SupabaseClient | null = null;
// Read-only mode never shares the live client: its own client, its own fetch
// (GET/HEAD only), its own door. See readOnlyDb() below.
let _roClient: SupabaseClient | null = null;
let _roGuarded: SupabaseClient | null = null;

/**
 * THE DATA LINK SWITCH — owner instruction, 2026-08-03. Mike: "cut all data
 * links to the app till we finish the rough build."
 *
 * While this is OFF the app touches NOTHING real: no read, no write, no
 * agent sweep. The rows stay exactly where they are — this cuts the link,
 * it does not delete anything, and it is one environment variable to undo.
 *
 * It is deliberately OPT-IN. A missing or misspelled value leaves the link
 * CUT, because the failure that costs something is the app quietly reaching
 * live customer data before it is finished, not a screen saying it cannot
 * see. Every surface already reports "not connected" honestly (§1B), so
 * cutting the link degrades the app into telling the truth.
 *
 * To reconnect (R19, Mike 2026-09-24: "one by one after a multiple step
 * verification process"): ARBO_DATA_LINKS=live opens the MASTER only. Each
 * named link then needs its own ARBO_LINK_<NAME>=live after its verification
 * passes — see src/db/links.ts and docs/DATA_LINKS.md. Master cut = all cut.
 */
export function dataLinksLive(): boolean {
  return process.env.ARBO_DATA_LINKS === 'live';
}

/**
 * SIMULATION mode — the app runs on in-memory fake records and never opens a
 * database connection at all. Mike: "you can make simulations to test
 * connections."
 *
 * Mutually exclusive with live by construction: 'live' and 'sim' are
 * different strings, so a value can only ever be one of them. There is no
 * combination of settings that puts simulated rows next to real ones, which
 * is the failure that would make the two indistinguishable.
 */
export function dataLinksSim(): boolean {
  return process.env.ARBO_DATA_LINKS === 'sim';
}

/**
 * READ-ONLY mode (R32). Mike, 2026-10-20, verbatim: "give arbo and its
 * agents read only data access and run systems checks every couple hours
 * while you contuin to build".
 *
 * Exactly 'readonly' and nothing else — 'READONLY', ' readonly', 'read-only'
 * leave the link CUT, the same fail-closed rule as 'live'. 'live', 'sim' and
 * 'readonly' are three different strings, so a value is only ever one of
 * them: read-only can never be taken for live, and never sits beside fake rows.
 *
 * In read-only Arbo READS the named links (every one except READ_ONLY_KEPT_CUT
 * in links.ts) through the same one door, and every WRITE is refused at that
 * door by name (ReadOnlyError) — see getDb() and readOnlyDb().
 */
export function dataLinksReadOnly(): boolean {
  return process.env.ARBO_DATA_LINKS === 'readonly';
}

/**
 * True when the DB is configured AND the master lets Arbo READ it — exactly
 * 'live' or exactly 'readonly'. Every repository and every API handler gates
 * on this, so one switch stops the whole app from reaching real data.
 *
 * This is "can read", not "can write". A WRITER checks canWrite(): in
 * read-only mode hasDb() is true and canWrite() is false. (hasDb() must stay
 * true in read-only: the /api gate opens without a key only while it is
 * false — server.ts apiAuthorized — and real rows must never be keyless.)
 */
export function hasDb(): boolean {
  if (!dataLinksLive() && !dataLinksReadOnly()) return false;
  return Boolean(env.supabase.url && env.supabase.serviceRoleKey);
}

/**
 * True only when Arbo may WRITE: the master exactly 'live' and the DB
 * configured. Read-only, simulation and cut are never writable. A background
 * writer checks this and degrades to a named "not saved — read-only" state
 * (src/db/notSaved.ts) instead of meeting the door; a writer that forgets is
 * refused at the door anyway.
 */
export function canWrite(): boolean {
  if (!dataLinksLive()) return false;
  return Boolean(env.supabase.url && env.supabase.serviceRoleKey);
}

/** Configured, regardless of the switch — for boot output that must not lie. */
export function dbConfigured(): boolean {
  return Boolean(env.supabase.url && env.supabase.serviceRoleKey);
}

/** Get the service-role Supabase client, or throw a clear error if unconfigured. */
export function getDb(): SupabaseClient {
  // The switch is enforced HERE as well as in hasDb(), because this is the
  // only door to a real table. A caller that forgets to check hasDb() must
  // still be unable to reach live data by accident — and the message says
  // which of the two reasons it was, never a vague failure.
  if (!dataLinksLive() && !dataLinksReadOnly()) {
    throw new Error(
      'Data links are CUT (ARBO_DATA_LINKS is not "live" or "readonly"). The app is not reading or '
      + 'writing real data until the rough build is finished. Nothing was deleted.',
    );
  }
  if (!hasDb()) {
    throw new Error(
      'Supabase not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env',
    );
  }
  // R32: read-only takes its own door and never the live client below.
  // Checked BEFORE the live client is even built, so in read-only mode a
  // writable client does not exist in this process to be reached by accident.
  if (dataLinksReadOnly()) return readOnlyDb();
  if (!_client) {
    _client = createClient(env.supabase.url as string, env.supabase.serviceRoleKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  // THE THIRD DOOR (R19, 2026-09-24): every table access goes through
  // `.from(table)`, so the per-link switch is enforced here — once, for every
  // repository present or future. A cut link refuses BY NAME (LinkCutError)
  // before any query is built; an unmapped table refuses too (fails closed).
  // No source file touches .rpc/.storage/.channel, so `from` is the whole
  // surface — if that ever changes, the new door gets the same guard.
  if (!_guarded) {
    const raw = _client;
    _guarded = new Proxy(raw, {
      get(target, prop) {
        // A handle taken while 'live' must not outlive 'live' (R32 door
        // review): once the master is anything else it answers to the door in
        // force NOW — read-only's door, or getDb()'s own "CUT" refusal. In live
        // this is always false, so live behaves exactly as before.
        if (!dataLinksLive()) return Reflect.get(getDb(), prop) as unknown;
        if (prop === 'from') {
          return (table: string) => {
            const link = linkForTable(table);
            if (!link || !linkOpen(link)) throw new LinkCutError(table, link);
            return target.from(table);
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as SupabaseClient;
  }
  return _guarded;
}

/**
 * THE READ-ONLY DOOR (R32). Three layers, so a caller that forgets to
 * check canWrite() still cannot write — the guard lives here, like the link
 * guard, not in each caller:
 *
 *  1. The client hands out `from` and nothing else. rpc, schema, storage,
 *     functions, channel/realtime, auth, rest — every other property is
 *     refused by name (ReadOnlyError).
 *  2. A table passes the SAME per-link check as live (linkOpen — in read-only
 *     that is every link except READ_ONLY_KEPT_CUT), then hands out `select`
 *     and nothing else: insert / upsert / update / delete are refused by
 *     name. Every table a select EMBEDS passes the link check too, so a link
 *     kept cut stays cut inside another link's read (jobs:job(count)).
 *  3. The wire: this client's fetch lets only GET and HEAD leave. A write
 *     path nobody thought of is refused before any request goes out.
 */
function readOnlyDb(): SupabaseClient {
  if (!_roClient) {
    _roClient = createClient(env.supabase.url as string, env.supabase.serviceRoleKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: readOnlyFetch },
    });
  }
  if (!_roGuarded) {
    const raw = _roClient;
    _roGuarded = new Proxy(raw, {
      get(target, prop) {
        if (prop === 'from') return (table: string) => readOnlyTable(target, table);
        // Not doors: await asks for `then`, inspection asks for symbols.
        // Answering undefined keeps the client from posing as a promise and opens nothing.
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        throw new ReadOnlyError(String(prop));
      },
    }) as SupabaseClient;
  }
  return _roGuarded;
}

/** One table, read-only: the link check, then `select` only. */
function readOnlyTable(client: SupabaseClient, table: string) {
  const link = linkForTable(table);
  if (!link || !linkOpen(link)) throw new LinkCutError(table, link);
  const builder = client.from(table);
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'select') {
        return (...args: unknown[]) => {
          assertEmbedsReadable(args[0]);
          return Reflect.apply(target.select, target, args) as unknown;
        };
      }
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      throw new ReadOnlyError(String(prop), table, link);
    },
  });
}

// An embedded resource in a select: `name(`, `alias:name(`, `name!hint(`.
// PostgREST names it by its table (jobs:job(count)) or by the foreign-key
// column that points at it (property:property_id(zip) → property).
const EMBED = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:![A-Za-z0-9_]+)?\s*\(/g;

/**
 * Every embedded table must be readable too. A name this cannot map to a
 * linked table is refused — fails closed, exactly like an unmapped root table.
 */
function assertEmbedsReadable(columns: unknown): void {
  // Not a plain string (a String object, an array …): the wire check reads
  // the select PostgREST will actually get (readOnlyFetch), so it is checked there.
  if (typeof columns !== 'string') return;
  // A quoted name is still a name: "job"(id) embeds job.
  for (const m of columns.replace(/"/g, '').matchAll(EMBED)) {
    const relation = m[1] as string;
    // A known table stays itself; a foreign-key column (`property_id`) names the table it points at.
    const table = (linkForTable(relation) !== null || !relation.endsWith('_id')) ? relation : relation.slice(0, -3);
    const link = linkForTable(table);
    if (!link || !linkOpen(link)) throw new LinkCutError(table, link);
  }
}

/**
 * The wire, read-only: GET and HEAD go out; every other method is refused before it leaves.
 * And a GET/HEAD is an ALLOW-LIST, not a pass: it may only read `/rest/v1/<a readable table>`
 * on this project's own host, and every embed in the select PostgREST will actually get
 * (after any chained .select(), quotes and all) must be readable too — so a builder that
 * was re-pointed, or a select the door above could not see, still cannot leave.
 */
function readOnlyFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  // The method from init, else from a Request object, else GET (a bare URL or string is a GET).
  const fromRequest = typeof input === 'object' && input !== null && 'method' in input ? input.method : undefined;
  const method = String(init?.method ?? fromRequest ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return Promise.reject(new ReadOnlyError(`HTTP ${method}`));
  try {
    assertReadableUrl(input);
  } catch (err) {
    // A refused READ answers as a 403 at once. Not a rejection: postgrest-js
    // retries a rejected GET three times (seconds of waiting for a sure "no").
    const message = err instanceof Error ? err.message : 'Read refused at the read-only door.';
    return Promise.resolve(new Response(JSON.stringify({ code: 'ARBO_LINK_CUT', message }), {
      status: 403, headers: { 'content-type': 'application/json' },
    }));
  }
  return fetch(input, init);
}

/** Throws (LinkCutError) unless this URL reads a readable table, with readable embeds, on our own host. */
function assertReadableUrl(input: Parameters<typeof fetch>[0]): void {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw);
  const base = new URL(env.supabase.url as string);
  const onRest = url.origin === base.origin && url.pathname.startsWith('/rest/v1/');
  const table = onRest ? url.pathname.slice('/rest/v1/'.length) : '';
  const link = linkForTable(table);
  if (!link || !linkOpen(link)) throw new LinkCutError(table || 'not a table', link);
  for (const select of url.searchParams.getAll('select')) assertEmbedsReadable(select);
}
