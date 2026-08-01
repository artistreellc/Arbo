import 'dotenv/config';

// Central, typed view of environment configuration. Secrets are read here and
// nowhere else, so it's easy to audit what the app touches. Values are never
// logged (§4.3) — only booleans about whether a group is configured.

const get = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== '' ? v : undefined;
};

export const env = {
  nodeEnv: get('NODE_ENV') ?? 'development',
  appName: get('APP_NAME') ?? 'ARBOR',
  supabase: {
    url: get('SUPABASE_URL'),
    anonKey: get('SUPABASE_ANON_KEY'),
    serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY'),
  },
  vapi: { apiKey: get('VAPI_API_KEY') },
  elevenlabs: {
    apiKey: get('ELEVENLABS_API_KEY'),
    /** Shared secret ElevenLabs sends to our custom-LLM bridge (we mint it). */
    bridgeSecret: get('ELEVENLABS_BRIDGE_SECRET'),
  },
  anthropic: { apiKey: get('ANTHROPIC_API_KEY') },
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
