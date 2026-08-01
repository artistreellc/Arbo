// /api/crm/jobs — the pipeline board.
//   GET                      list all jobs (grouped client-side by stage)
//   GET   ?id=<uuid>         one job + its contact + activity timeline + appts
//   POST  { ...fields }      create a job
//   PATCH { id, ...fields }  update a job (stage moves, amounts, schedule…)
//
// Calendar hook: when a job is moved into a scheduling stage with a
// scheduled_for date, we ensure a matching Google Calendar appointment exists
// (created/updated), so the crew's calendar always reflects the pipeline.
import { getDb, requireAuth, parseBody, clip } from './_lib.js';
import { upsertAppointmentEvent } from './_calendar.js';

const STAGES = ['new', 'estimate_scheduled', 'estimate_sent', 'won', 'scheduled', 'in_progress', 'completed', 'paid', 'lost'];
const SCHEDULING_STAGES = ['estimate_scheduled', 'scheduled', 'in_progress'];
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));

// Ensure the job has a synced calendar appointment at scheduled_for. Reuses the
// job's existing appointment if there is one; otherwise creates it.
async function ensureJobAppointment(db, job) {
  if (!job?.scheduled_for) return;
  const kind = job.stage === 'estimate_scheduled' ? 'estimate' : 'job';
  const { data: existing } = await db
    .from('crm_appointments')
    .select('*')
    .eq('job_id', job.id)
    .in('kind', ['estimate', 'job'])
    .order('created_at', { ascending: true })
    .limit(1);

  let appt = existing && existing[0];
  if (appt) {
    // Update time/kind if the schedule moved.
    const changed = appt.starts_at !== job.scheduled_for || appt.kind !== kind;
    if (!changed) return;
    const { data } = await db
      .from('crm_appointments')
      .update({ starts_at: job.scheduled_for, kind })
      .eq('id', appt.id)
      .select()
      .single();
    appt = data;
  } else {
    const { data } = await db
      .from('crm_appointments')
      .insert({
        job_id: job.id,
        contact_id: job.contact_id,
        kind,
        title: `${kind === 'estimate' ? 'Estimate' : 'Job'} — ${job.title || 'Tree work'}`,
        location: job.address,
        starts_at: job.scheduled_for,
        sync_status: 'pending',
      })
      .select()
      .single();
    appt = data;
  }

  const { data: contact } = job.contact_id
    ? await db.from('crm_contacts').select('*').eq('id', job.contact_id).single()
    : { data: null };
  await upsertAppointmentEvent(db, appt, { job, contact });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await requireAuth(req, res))) return;
  const db = getDb();

  try {
    if (req.method === 'GET') {
      const id = clip(req.query.id, 60);
      if (id) {
        const { data: job, error } = await db.from('crm_jobs').select('*').eq('id', id).single();
        if (error) throw error;
        const [{ data: contact }, { data: activities }, { data: appts }] = await Promise.all([
          job.contact_id ? db.from('crm_contacts').select('*').eq('id', job.contact_id).single() : Promise.resolve({ data: null }),
          db.from('crm_activities').select('*').eq('job_id', id).order('created_at', { ascending: false }),
          db.from('crm_appointments').select('*').eq('job_id', id).order('starts_at', { ascending: true }),
        ]);
        return res.status(200).json({ job, contact, activities: activities || [], appointments: appts || [] });
      }
      const { data, error } = await db
        .from('crm_jobs')
        .select('*, contact:crm_contacts(name, phone, email)')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ jobs: data, stages: STAGES });
    }

    if (req.method === 'POST') {
      const b = parseBody(req);
      const { data, error } = await db
        .from('crm_jobs')
        .insert({
          contact_id: b.contact_id || null,
          lead_id: b.lead_id || null,
          title: clip(b.title, 200) || 'New job',
          service_type: clip(b.service_type, 120),
          description: clip(b.description, 5000),
          address: clip(b.address, 300),
          stage: STAGES.includes(b.stage) ? b.stage : 'new',
          estimate_amount: num(b.estimate_amount),
          priority: clip(b.priority, 20) || 'normal',
        })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ job: data });
    }

    if (req.method === 'PATCH') {
      const b = parseBody(req);
      if (!b.id) return res.status(400).json({ error: 'missing_id' });

      const { data: prev } = await db.from('crm_jobs').select('stage, scheduled_for').eq('id', b.id).single();

      const patch = {};
      if (b.title !== undefined) patch.title = clip(b.title, 200);
      if (b.service_type !== undefined) patch.service_type = clip(b.service_type, 120);
      if (b.description !== undefined) patch.description = clip(b.description, 5000);
      if (b.address !== undefined) patch.address = clip(b.address, 300);
      if (b.stage !== undefined && STAGES.includes(b.stage)) patch.stage = b.stage;
      if (b.priority !== undefined) patch.priority = clip(b.priority, 20);
      if (b.estimate_amount !== undefined) patch.estimate_amount = num(b.estimate_amount);
      if (b.final_amount !== undefined) patch.final_amount = num(b.final_amount);
      if (b.scheduled_for !== undefined) patch.scheduled_for = b.scheduled_for || null;
      if (b.lost_reason !== undefined) patch.lost_reason = clip(b.lost_reason, 300);
      if (b.position !== undefined) patch.position = parseInt(b.position, 10) || 0;

      const { data, error } = await db.from('crm_jobs').update(patch).eq('id', b.id).select().single();
      if (error) throw error;

      if (patch.stage && prev && patch.stage !== prev.stage) {
        await db.from('crm_activities').insert({
          job_id: b.id,
          contact_id: data.contact_id,
          type: 'stage_change',
          subject: `Stage: ${prev.stage} → ${patch.stage}`,
          created_by: 'admin',
        });
      }

      // Keep Google Calendar in step when the job is in a scheduling stage and
      // has a date. Best-effort — never fail the save over a calendar hiccup.
      try {
        const scheduleTouched = patch.scheduled_for !== undefined || patch.stage !== undefined;
        if (scheduleTouched && data.scheduled_for && SCHEDULING_STAGES.includes(data.stage)) {
          await ensureJobAppointment(db, data);
        }
      } catch (e) {
        console.error('[api/crm/jobs] calendar sync', e?.message);
      }

      return res.status(200).json({ job: data });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[api/crm/jobs]', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
