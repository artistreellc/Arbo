// /api/crm/leads — the lead inbox.
//   GET    ?status=new            list leads (optionally filtered by status)
//   PATCH  { id, status }          update a lead's inbox status
//   POST   { action: 'convert', id, job }  convert a lead into a pipeline job
import { getDb, requireAuth, parseBody, clip } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await requireAuth(req, res))) return;
  const db = getDb();

  try {
    if (req.method === 'GET') {
      const status = clip(req.query.status, 40);
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      let q = db.from('crm_leads').select('*').order('created_at', { ascending: false }).limit(limit);
      if (status && status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ leads: data });
    }

    if (req.method === 'PATCH') {
      const { id, status } = parseBody(req);
      if (!id) return res.status(400).json({ error: 'missing_id' });
      const { data, error } = await db
        .from('crm_leads')
        .update({ status: clip(status, 40) })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ lead: data });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      if (body.action !== 'convert') return res.status(400).json({ error: 'unknown_action' });
      const { id, job = {} } = body;
      if (!id) return res.status(400).json({ error: 'missing_id' });

      const { data: lead, error: le } = await db.from('crm_leads').select('*').eq('id', id).single();
      if (le) throw le;

      const { data: newJob, error: je } = await db
        .from('crm_jobs')
        .insert({
          contact_id: lead.contact_id,
          lead_id: lead.id,
          title: clip(job.title, 200) || lead.service_needed || 'New job',
          service_type: clip(job.service_type, 120) || lead.service_needed,
          description: clip(job.description, 5000) || lead.message,
          address: clip(job.address, 300) || lead.address,
          stage: 'new',
          priority: lead.urgency === 'emergency' ? 'emergency' : 'normal',
        })
        .select()
        .single();
      if (je) throw je;

      await db.from('crm_leads').update({ status: 'converted', job_id: newJob.id }).eq('id', id);
      await db.from('crm_activities').insert({
        contact_id: lead.contact_id,
        lead_id: lead.id,
        job_id: newJob.id,
        type: 'stage_change',
        subject: 'Lead converted to job',
        created_by: 'admin',
      });
      return res.status(200).json({ job: newJob });
    }

    res.setHeader('Allow', 'GET, PATCH, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[api/crm/leads]', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
