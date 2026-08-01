import { createClient } from '@supabase/supabase-js';

// Browser Supabase client — anon/publishable key only. It is used solely for
// AUTH (sign in/out, session, JWT). It never reads CRM tables directly: those
// are locked by RLS and only reachable through the /api/crm/* serverless
// functions (which hold the service-role key). The user's JWT from this client
// is what those functions verify.
//
// Configure via Vite env at build time:
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
const url = import.meta.env.VITE_SUPABASE_URL || '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const AUTH_CONFIGURED = Boolean(url && anonKey);

// When unconfigured we still export a client-shaped stub so imports don't throw;
// AUTH_CONFIGURED gates the UI onto a setup notice instead.
export const supabase = AUTH_CONFIGURED
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
