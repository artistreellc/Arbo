// /api/crm/activities — append to a job/contact timeline (notes, call logs, etc).
//   POST { job_id?, contact_id?, lead_id?, type, direction?, subject?, body }
import { getDb, requireAuth, parseBody, clip } from './_lib.js';

const TYPES = ['note', 'call', 'email', 'sms', 'appointment', 'receptionist', 'stage_change'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await requireAuth(req, res))) return;
  const db = getDb();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const b = parseBody(req);
  if (!b.job_id && !b.contact_id && !b.lead_id) {
    return res.status(400).json({ error: 'missing_target' });
  }

  try {
    const { data, error } = await db
      .from('crm_activities')
      .insert({
        job_id: b.job_id || null,
        contact_id: b.contact_id || null,
        lead_id: b.lead_id || null,
        type: TYPES.includes(b.type) ? b.type : 'note',
        direction: clip(b.direction, 20),
        subject: clip(b.subject, 300),
        body: clip(b.body, 5000),
        created_by: clip(b.created_by, 120) || 'admin',
      })
      .select()
      .single();
    if (error) throw error;
    return res.status(200).json({ activity: data });
  } catch (err) {
    console.error('[api/crm/activities]', err);
    return res.status(500).json({ error: 'server_error' });
  }
}
