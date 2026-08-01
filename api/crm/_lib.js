// Shared server-side helpers for the CRM API.
// Files starting with "_" are ignored by Vercel's filesystem router, so this is
// a library, not an endpoint.
//
// Required env vars (Vercel Project Settings -> Environment Variables):
//   SUPABASE_URL                 https://<project>.supabase.co  (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY    Service role key (SERVER ONLY — never expose)
//   SUPABASE_ANON_KEY            Anon/publishable key, used to verify user JWTs
//   CRM_ADMIN_EMAILS             Comma-separated allowlist of admin emails
// Optional:
//   ANTHROPIC_API_KEY            For the AI receptionist
//   RESEND_API_KEY               For new-lead email notifications
//   GOOGLE_* / *_REFRESH_TOKEN   For Gmail + Calendar sync (see _google.js)

import { createClient } from '@supabase/supabase-js';
import { notifyNewLead } from './_notify.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

let _db = null;
let _auth = null;

// Service-role client for all data access. Returns null if unconfigured so
// callers can degrade gracefully instead of throwing at import time.
export function getDb() {
  if (!SERVICE_KEY || !SUPABASE_URL) return null;
  if (!_db) {
    _db = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _db;
}

// Anon client used only to validate a user's JWT (auth.getUser(token)).
function getAuthClient() {
  if (!ANON_KEY || !SUPABASE_URL) return null;
  if (!_auth) {
    _auth = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _auth;
}

function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function envAdminEmails() {
  return (process.env.CRM_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Is this email an authorized admin? Union of env allowlist and crm_admins.
async function isAdminEmail(email) {
  if (!email) return false;
  const norm = email.toLowerCase();
  if (envAdminEmails().includes(norm)) return true;
  const db = getDb();
  if (!db) return false;
  const { data } = await db.from('crm_admins').select('email').eq('email', norm).maybeSingle();
  return Boolean(data);
}

// Real auth gate. Verifies the caller's Supabase JWT and confirms they are an
// admin. On success returns the user object; otherwise sends the response and
// returns null. Fails closed when nothing is configured.
export async function requireAuth(req, res) {
  if (!getDb()) {
    res.status(503).json({ error: 'not_configured', message: 'CRM database is not configured.' });
    return null;
  }
  const auth = getAuthClient();
  const token = bearer(req);
  if (!auth || !token) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const { data, error } = await auth.auth.getUser(token);
  const user = data?.user;
  if (error || !user) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  if (!(await isAdminEmail(user.email))) {
    res.status(403).json({ error: 'forbidden', message: 'Not an authorized admin.' });
    return null;
  }
  return user;
}

// Allow Vercel Cron (or any trusted scheduler) to call sync endpoints without a
// user JWT. Vercel automatically sends "Authorization: Bearer $CRON_SECRET" when
// CRON_SECRET is set; we also accept an x-cron-secret header for manual curls.
export function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${secret}` || req.headers['x-cron-secret'] === secret;
}

export function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  return body || {};
}

export const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

export function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function clientIp(req) {
  return (
    req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Core intake used by the website form, the AI receptionist, Gmail sync, and
// manual entry. Normalizes a payload into a lead, links/creates a contact, logs
// an activity, and fires a best-effort notification. Returns { lead, contact,
// deduped }. When external_id collides with an existing lead of the same source
// (e.g. a Gmail message already imported), it returns that lead with
// deduped:true instead of inserting a duplicate.
// ---------------------------------------------------------------------------
export async function captureLead(input = {}) {
  const db = getDb();
  if (!db) throw new Error('crm_not_configured');

  const externalId = clip(input.external_id || input.externalId, 300);
  const source = clip(input.source, 40) || 'other';

  // Dedup guard for channel syncs.
  if (externalId) {
    const { data: existing } = await db
      .from('crm_leads')
      .select('*')
      .eq('source', source)
      .eq('external_id', externalId)
      .limit(1);
    if (existing && existing[0]) return { lead: existing[0], contact: null, deduped: true };
  }

  const lead = {
    name: clip(input.name, 120),
    email: clip(input.email, 200),
    phone: clip(input.phone, 40),
    address: clip(input.address, 300),
    service_needed: clip(input.service_needed || input.serviceNeeded, 120),
    message: clip(input.message, 5000),
    urgency: clip(input.urgency, 60),
    source,
    source_detail: clip(input.source_detail || input.sourceDetail, 300),
    external_id: externalId,
    status: 'new',
    raw: input.raw || input,
  };

  // Best-effort contact matching by phone or email, else create one.
  let contact = null;
  if (lead.phone || lead.email) {
    const orParts = [];
    if (lead.phone) orParts.push(`phone.eq.${lead.phone}`);
    if (lead.email) orParts.push(`email.eq.${lead.email}`);
    const { data: found } = await db.from('crm_contacts').select('*').or(orParts.join(',')).limit(1);
    contact = found && found[0];
  }
  if (!contact) {
    const { data: created } = await db
      .from('crm_contacts')
      .insert({ name: lead.name, email: lead.email, phone: lead.phone, address: lead.address })
      .select()
      .single();
    contact = created;
  }

  lead.contact_id = contact ? contact.id : null;

  const { data: savedLead, error } = await db.from('crm_leads').insert(lead).select().single();
  if (error) throw error;

  await db.from('crm_activities').insert({
    contact_id: lead.contact_id,
    lead_id: savedLead.id,
    type: lead.source === 'receptionist' ? 'receptionist' : 'note',
    direction: 'inbound',
    subject: `New lead from ${lead.source}`,
    body: lead.message || lead.service_needed || null,
    created_by: 'system',
  });

  // Best-effort notification — never let it break intake.
  try {
    await notifyNewLead(savedLead);
  } catch (e) {
    console.error('[captureLead] notify failed', e?.message);
  }

  return { lead: savedLead, contact, deduped: false };
}
