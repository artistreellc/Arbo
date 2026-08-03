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

// The ARBOR backend talks to Supabase with the SERVICE ROLE key only (§4.3).
// The service role bypasses RLS; no other key can read customer PII. This key
// is server-side and never shipped to a client.

let _client: SupabaseClient | null = null;

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
 * To reconnect when the rough build is done: ARBO_DATA_LINKS=live
 */
export function dataLinksLive(): boolean {
  return process.env.ARBO_DATA_LINKS === 'live';
}

/**
 * True when the DB is configured AND the data link is open. Every repository
 * and every API handler gates on this, so one switch stops the whole app from
 * reaching real data.
 */
export function hasDb(): boolean {
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
  if (!dataLinksLive()) {
    throw new Error(
      'Data links are CUT (ARBO_DATA_LINKS is not "live"). The app is not reading or '
      + 'writing real data until the rough build is finished. Nothing was deleted.',
    );
  }
  if (!hasDb()) {
    throw new Error(
      'Supabase not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env',
    );
  }
  if (!_client) {
    _client = createClient(env.supabase.url as string, env.supabase.serviceRoleKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
