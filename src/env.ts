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
    /** HMAC secret for the post-call transcript webhook (ElevenLabs mints it). */
    postCallSecret: get('ELEVENLABS_POSTCALL_SECRET'),
  },
  // R19 webhooks. The Resend API key is for READING sent form emails only —
  // Arbo never sends email (hard boundary), and the one client that holds
  // this key has exactly one GET method.
  resend: {
    apiKey: get('RESEND_API_KEY'),
    /** Svix signing secret (whsec_…) for the Resend webhook endpoint. */
    webhookSecret: get('RESEND_WEBHOOK_SECRET'),
  },
  /** Shared key in the Railway deploy-webhook URL (we mint it). */
  railwayWebhookKey: get('RAILWAY_WEBHOOK_KEY'),
  /**
   * Quo (Sona's phone) API key — Arbo registers its own webhooks and reads
   * conversations with it, and (R22, the one outbound path) sends the
   * "still interested in a quote?" text through src/integrations/quoSend.ts.
   */
  quoApiKey: get('QUO_API_KEY'),
  /** R22: exactly 'live' turns on the AUTOMATIC 48-hour follow-up texts. Anything else = off. */
  outreachAuto: get('ARBO_OUTREACH') === 'live',
  /** R22: exactly 'live' runs the one-time past-week catch-up at boot (Mike's tap in the app does the same). */
  outreachCatchupAtBoot: get('ARBO_OUTREACH_CATCHUP') === 'live',
  /** Shared key in the Twilio incoming-text webhook URL (we mint it). */
  twilioSmsWebhookKey: get('TWILIO_SMS_WEBHOOK_KEY'),
  anthropic: { apiKey: get('ANTHROPIC_API_KEY') },
  /** Access key for the ops app + /api routes (§8 admin-only surface). */
  appAccessKey: get('APP_ACCESS_KEY'),
  /**
   * R25: the CREW door's own key. Opens /api/crew/* ONLY — never Mike's
   * routes. Unset = the crew door answers 401 'crew_key_not_set' and the
   * page says the key isn't set up yet (Mike's own key still opens it).
   */
  crewAccessKey: get('CREW_ACCESS_KEY'),
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
    // Consumer-Gmail OAuth (backlog #36): minted by Mike's one-time consent
    // to gmail.readonly, nothing wider. All three or the reader stays null.
    gmailOauthClientId: get('GMAIL_OAUTH_CLIENT_ID'),
    gmailOauthClientSecret: get('GMAIL_OAUTH_CLIENT_SECRET'),
    gmailOauthRefreshToken: get('GMAIL_OAUTH_REFRESH_TOKEN'),
  },
  ownerAlertPhone: get('OWNER_ALERT_PHONE'),
  // R15: home ZIP only — never the address, never in config, never in a prompt.
  ownerHomeZip: get('OWNER_HOME_ZIP'),
  // R31 (Mike, 2026-10-20: "why dont you build and then i add later"):
  // Bouncie truck tracking. The client pair signs Arbo in (Bouncie developer
  // portal → the app); the webhook key is one Mike makes up and types into
  // both the portal and Railway. Positions stay off until ARBO_LINK_BOUNCIE
  // is exactly 'live' — read at call time in src/integrations/bouncie.ts.
  // BOUNCIE_API_KEY (Mike's spec, 2026-10-20) is PRESENCE ONLY. Mike, the
  // same day: it is the portal's per-user Authorization Code (Users & Devices
  // → Authorize My Devices). Arbo does not need it — Connect Bouncie gets its
  // own code — so only a yes/no is kept here: the value never sits in this
  // object, so it can never be sent, logged or shown (docs/BOUNCIE.md).
  bouncie: {
    clientId: get('BOUNCIE_CLIENT_ID'),
    clientSecret: get('BOUNCIE_CLIENT_SECRET'),
    webhookKey: get('BOUNCIE_WEBHOOK_KEY'),
    apiKeySet: get('BOUNCIE_API_KEY') !== undefined,
  },
} as const;

/**
 * R28 (Mike, 2026-10-20: "Make it safe, then set it up" / "put it in the arbo
 * app"): the business assistant — a Claude Managed Agent Mike creates in the
 * Claude Console; Arbo starts its sessions and carries its approvals.
 *
 * Read at CALL time, never cached, so a restart or a test sees the truth.
 * The switch is exactly like ARBO_DATA_LINKS: ARBO_AGENT must be exactly
 * 'live', read raw — 'LIVE', 'true', ' live' or unset all leave it OFF.
 * The key is the same ANTHROPIC_API_KEY through the same accessor as
 * env.anthropic.apiKey. Values are never logged — only which NAMES are missing.
 */
export function assistantEnv(): {
  on: boolean;
  apiKey: string | undefined;
  agentId: string | undefined;
  environmentId: string | undefined;
  vaultId: string | undefined;
  /** Whole cents; null when the variable is set but is not a dollar amount above 0. */
  budgetCents: number | null;
} {
  const rawBudget = get('ARBO_AGENT_SESSION_BUDGET_USD');
  const budgetCents = rawBudget === undefined
    ? 300
    : /^\d+(\.\d{1,2})?$/.test(rawBudget) && Number(rawBudget) > 0 ? Math.round(Number(rawBudget) * 100) : null;
  return {
    on: process.env.ARBO_AGENT === 'live',
    apiKey: get('ANTHROPIC_API_KEY'),
    agentId: get('ARBO_AGENT_ID'),
    environmentId: get('ARBO_AGENT_ENVIRONMENT_ID'),
    vaultId: get('ARBO_AGENT_VAULT_ID'),
    budgetCents,
  };
}

/** Which integration groups have real credentials present (booleans only). */
export function integrationStatus(): Record<string, boolean> {
  return {
    supabase: Boolean(env.supabase.url && env.supabase.serviceRoleKey),
    vapi: Boolean(env.vapi.apiKey),
    twilio: Boolean(env.twilio.accountSid && env.twilio.authToken && env.twilio.phoneNumber),
    google: Boolean(env.google.clientEmail && env.google.privateKey),
    googleMaps: Boolean(env.google.mapsApiKey),
    gmailInbox: Boolean(env.google.gmailOauthClientId && env.google.gmailOauthClientSecret && env.google.gmailOauthRefreshToken),
    ownerAlerts: Boolean(env.ownerAlertPhone),
    bouncie: Boolean(env.bouncie.clientId && env.bouncie.clientSecret),
  };
}
