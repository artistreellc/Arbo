// /api/crm/sync/calendar — reconcile appointments to Google Calendar.
//
// Most calendar events are created inline when an appointment or job schedule is
// saved. This endpoint is the safety net: it retries any upcoming appointment
// still marked 'pending' or 'failed' (e.g. Google was briefly down, or was
// connected after the appointment was created). Runs via Vercel Cron
// (CRON_SECRET) or an admin session.
import { getDb, requireAuth, isCron } from '../_lib.js';
import { googleConfigured } from '../_google.js';
import { upsertAppointmentEvent } from '../_calendar.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isCron(req)) {
    if (!(await requireAuth(req, res))) return;
  }

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'not_configured' });
  if (!googleConfigured()) {
    return res.status(200).json({ ok: true, configured: false, synced: 0 });
  }

  try {
    const { data: pending, error } = await db
      .from('crm_appointments')
      .select('*')
      .in('sync_status', ['pending', 'failed'])
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    let synced = 0;
    for (const appt of pending || []) {
      const [{ data: job }, { data: contact }] = await Promise.all([
        appt.job_id ? db.from('crm_jobs').select('*').eq('id', appt.job_id).single() : Promise.resolve({ data: null }),
        appt.contact_id ? db.from('crm_contacts').select('*').eq('id', appt.contact_id).single() : Promise.resolve({ data: null }),
      ]);
      const updated = await upsertAppointmentEvent(db, appt, { job, contact });
      if (updated.sync_status === 'synced') synced += 1;
    }

    return res.status(200).json({ ok: true, configured: true, considered: (pending || []).length, synced });
  } catch (err) {
    console.error('[sync/calendar]', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
