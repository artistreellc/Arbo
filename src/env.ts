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
  appName: get('APP_NAME') ?? 'ARBOR',
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
  };
}
