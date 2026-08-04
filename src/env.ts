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
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Central, typed view of environment configuration. Secrets are read here and
// nowhere else, so it's easy to audit what the app touches. Values are never
// logged (§4.3) — only booleans about whether a group is configured.

// Deployment-carried config (D46): a `private/deploy.config.json` shipped only
// inside a private deployment upload (NEVER in the repo — gitignored). It fills
// in values that are missing from env, and backstops Supabase credentials when
// the env copy is MALFORMED — phone-pasted JWTs pick up mid-string line breaks,
// and health checks that only test presence can't see that.
let carried: Record<string, string> = {};
try {
  const here = dirname(fileURLToPath(import.meta.url));
  carried = JSON.parse(readFileSync(resolve(here, '..', 'private', 'deploy.config.json'), 'utf8')) as Record<string, string>;
} catch {
  // No carried config — env only. Normal in dev/CI/repo checkouts.
}

// Values are TRIMMED: dashboard copy-pastes love to smuggle a trailing newline
// into a key, which then silently poisons an Authorization header.
const get = (k: string): string | undefined => {
  const v = (process.env[k] ?? carried[k])?.trim();
  return v && v !== '' ? v : undefined;
};

// Supabase credentials get shape validation: whitespace anywhere is stripped
// (JWTs and URLs never legitimately contain it), and a value that still isn't
// credential-shaped yields to a well-formed carried value instead of silently
// failing every query.
const SHAPES: Record<string, RegExp> = {
  SUPABASE_URL: /^https:\/\/[a-z0-9-]+\.supabase\.co$/,
  SUPABASE_SERVICE_ROLE_KEY: /^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+)$/,
};
const getShaped = (k: string): string | undefined => {
  const norm = (s?: string) => s?.replace(/\s+/g, '').replace(/\/+$/, '') || undefined;
  const envV = norm(process.env[k]);
  if (envV && SHAPES[k]!.test(envV)) return envV;
  const carr = norm(carried[k]);
  if (carr && SHAPES[k]!.test(carr)) return carr;
  return envV ?? carr; // both odd-shaped: keep the env value so the failure stays loud
};

export const env = {
  nodeEnv: get('NODE_ENV') ?? 'development',
  appName: get('APP_NAME') ?? 'ARBO',
  supabase: {
    url: getShaped('SUPABASE_URL'),
    anonKey: get('SUPABASE_ANON_KEY'),
    serviceRoleKey: getShaped('SUPABASE_SERVICE_ROLE_KEY'),
  },
  vapi: { apiKey: get('VAPI_API_KEY') },
  elevenlabs: {
    apiKey: get('ELEVENLABS_API_KEY'),
    /** Shared secret ElevenLabs sends to our custom-LLM bridge (we mint it). */
    bridgeSecret: get('ELEVENLABS_BRIDGE_SECRET'),
  },
  anthropic: { apiKey: get('ANTHROPIC_API_KEY') },
  /** Access key for the ops app + /api routes (§8 admin-only surface). */
  appAccessKey: get('APP_ACCESS_KEY'),
  twilio: {
    accountSid: get('TWILIO_ACCOUNT_SID'),
    authToken: get('TWILIO_AUTH_TOKEN'),
    phoneNumber: get('TWILIO_PHONE_NUMBER'),
  },
  google: {
    projectId: get('GOOGLE_PROJECT_ID'),
    clientEmail: get('GOOGLE_CLIENT_EMAIL'),
    privateKey: get('GOOGLE_PRIVATE_KEY'),
    mapsApiKey: get('GOOGLE_MAPS_API_KEY'),
    driveRootFolderId: get('ARBOR_DRIVE_ROOT_FOLDER_ID'),
  },
  /**
   * Signs customer portal sessions (task #35). Unset means the portal cannot
   * mint OR verify a session, so nobody gets in — see src/portal/session.ts.
   * Fails closed on purpose: a portal that cannot sign must never fall back
   * to trusting an unsigned token.
   */
  portalSessionSecret: get('PORTAL_SESSION_SECRET'),
  ownerAlertPhone: get('OWNER_ALERT_PHONE'),
} as const;

/** Which integration groups have real credentials present (booleans only). */
export function integrationStatus(): Record<string, boolean> {
  return {
    supabase: Boolean(env.supabase.url && env.supabase.serviceRoleKey),
    vapi: Boolean(env.vapi.apiKey),
    twilio: Boolean(env.twilio.accountSid && env.twilio.authToken && env.twilio.phoneNumber),
    google: Boolean(env.google.clientEmail && env.google.privateKey),
    googleMaps: Boolean(env.google.mapsApiKey),
    ownerAlerts: Boolean(env.ownerAlertPhone),
    portalSessions: Boolean(env.portalSessionSecret),
  };
}
