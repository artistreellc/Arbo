// Thin client for the /api/crm/* endpoints. It attaches the signed-in user's
// Supabase JWT as a Bearer token; the serverless functions verify it and check
// the caller against the admin allowlist. No shared secret is baked into the
// bundle anymore.
import { supabase, AUTH_CONFIGURED } from '@/lib/supabaseClient';

async function authHeader() {
  if (!AUTH_CONFIGURED || !supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`/api/crm/${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

  const res = await fetch(url.toString().replace(window.location.origin, ''), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(await authHeader()),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const crmApi = {
  // Leads / inbox
  listLeads: (status = 'new') => request('leads', { params: { status } }),
  setLeadStatus: (id, status) => request('leads', { method: 'PATCH', body: { id, status } }),
  convertLead: (id, job = {}) => request('leads', { method: 'POST', body: { action: 'convert', id, job } }),

  // Jobs / pipeline
  listJobs: () => request('jobs'),
  getJob: (id) => request('jobs', { params: { id } }),
  createJob: (job) => request('jobs', { method: 'POST', body: job }),
  updateJob: (patch) => request('jobs', { method: 'PATCH', body: patch }),

  // Timeline
  addActivity: (activity) => request('activities', { method: 'POST', body: activity }),

  // Appointments (Calendar sync)
  createAppointment: (appt) => request('appointments', { method: 'POST', body: appt }),
  deleteAppointment: (id) => request('appointments', { method: 'DELETE', params: { id } }),

  // Settings / receptionist config
  getSettings: () => request('settings'),
  updateSettings: (patch) => request('settings', { method: 'PATCH', body: patch }),

  // Integrations status + manual triggers
  getIntegrations: () => request('integrations'),
  runGmailSync: () => request('sync/gmail', { method: 'POST' }),
};

export { AUTH_CONFIGURED as CRM_CONFIGURED };
