// /api/crm/appointments — schedule estimates & jobs, mirrored to Google Calendar.
//   POST   { job_id?, contact_id?, kind, title?, location?, starts_at, ends_at?, notes? }
//   DELETE ?id=<uuid>
import { getDb, requireAuth, parseBody, clip } from './_lib.js';
import { upsertAppointmentEvent, deleteAppointmentEvent } from './_calendar.js';

const KINDS = ['estimate', 'job', 'follow_up'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await requireAuth(req, res))) return;
  const db = getDb();

  try {
    if (req.method === 'POST') {
      const b = parseBody(req);
      if (!b.starts_at) return res.status(400).json({ error: 'missing_starts_at' });

      const { data: appt, error } = await db
        .from('crm_appointments')
        .insert({
          job_id: b.job_id || null,
          contact_id: b.contact_id || null,
          kind: KINDS.includes(b.kind) ? b.kind : 'estimate',
          title: clip(b.title, 300),
          location: clip(b.location, 300),
          starts_at: new Date(b.starts_at).toISOString(),
          ends_at: b.ends_at ? new Date(b.ends_at).toISOString() : null,
          notes: clip(b.notes, 2000),
          sync_status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;

      // Load job + contact for a richer calendar event, then sync.
      const [{ data: job }, { data: contact }] = await Promise.all([
        appt.job_id ? db.from('crm_jobs').select('*').eq('id', appt.job_id).single() : Promise.resolve({ data: null }),
        appt.contact_id ? db.from('crm_contacts').select('*').eq('id', appt.contact_id).single() : Promise.resolve({ data: null }),
      ]);
      const synced = await upsertAppointmentEvent(db, appt, { job, contact });

      if (appt.job_id) {
        await db.from('crm_activities').insert({
          job_id: appt.job_id,
          contact_id: appt.contact_id,
          type: 'appointment',
          subject: `${synced.kind} scheduled for ${new Date(synced.starts_at).toLocaleString()}`,
          created_by: 'admin',
        });
      }

      return res.status(200).json({ appointment: synced, calendar_synced: synced.sync_status === 'synced' });
    }

    if (req.method === 'DELETE') {
      const id = clip(req.query.id, 60);
      if (!id) return res.status(400).json({ error: 'missing_id' });
      const { data: appt } = await db.from('crm_appointments').select('*').eq('id', id).single();
      if (appt) {
        await deleteAppointmentEvent(appt);
        await db.from('crm_appointments').delete().eq('id', id);
      }
      return res.status(200).json({ deleted: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[api/crm/appointments]', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
