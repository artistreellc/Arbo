// /api/crm/settings — business + AI receptionist configuration (single row).
//   GET                     read settings
//   PATCH { ...fields }     update settings
import { getDb, requireAuth, parseBody, clip } from './_lib.js';

const FIELDS = {
  business_name: 200,
  business_phone: 40,
  business_email: 200,
  receptionist_persona: 8000,
  receptionist_greeting: 1000,
  booking_rules: 8000,
  notify_email: 200,
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await requireAuth(req, res))) return;
  const db = getDb();

  try {
    if (req.method === 'GET') {
      const { data, error } = await db.from('crm_settings').select('*').eq('id', 1).single();
      if (error) throw error;
      return res.status(200).json({ settings: data });
    }

    if (req.method === 'PATCH') {
      const b = parseBody(req);
      const patch = {};
      for (const [k, max] of Object.entries(FIELDS)) {
        if (b[k] !== undefined) patch[k] = clip(b[k], max);
      }
      if (b.auto_create_jobs !== undefined) patch.auto_create_jobs = !!b.auto_create_jobs;
      patch.updated_at = new Date().toISOString();

      const { data, error } = await db.from('crm_settings').update(patch).eq('id', 1).select().single();
      if (error) throw error;
      return res.status(200).json({ settings: data });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[api/crm/settings]', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
