import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';

// The ARBOR backend talks to Supabase with the SERVICE ROLE key only (§4.3).
// The service role bypasses RLS; no other key can read customer PII. This key
// is server-side and never shipped to a client.

let _client: SupabaseClient | null = null;

/** True when the DB is configured (URL + service role key present). */
export function hasDb(): boolean {
  return Boolean(env.supabase.url && env.supabase.serviceRoleKey);
}

/** Get the service-role Supabase client, or throw a clear error if unconfigured. */
export function getDb(): SupabaseClient {
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
