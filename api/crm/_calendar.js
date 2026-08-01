// Bridges a crm_appointments row to a Google Calendar event and keeps the two
// in step. Degrades gracefully: with Google unconfigured, appointments still
// save locally (sync_status = 'local'); a transient Google error marks the row
// 'failed' without breaking the request.
import {
  googleConfigured,
  calendarCreateEvent,
  calendarUpdateEvent,
  calendarDeleteEvent,
} from './_google.js';

function buildEvent(appt, { job, contact }) {
  const kindLabel = appt.kind === 'estimate' ? 'Estimate' : appt.kind === 'follow_up' ? 'Follow-up' : 'Job';
  const summary = appt.title || `${kindLabel} — ${job?.title || contact?.name || 'Tree work'}`;
  const descLines = [
    job?.title ? `Job: ${job.title}` : null,
    job?.service_type ? `Service: ${job.service_type}` : null,
    contact?.name ? `Customer: ${contact.name}` : null,
    contact?.phone ? `Phone: ${contact.phone}` : null,
    contact?.email ? `Email: ${contact.email}` : null,
    appt.notes || null,
    '',
    'Scheduled via Arbo CRM',
  ].filter((l) => l !== null);
  const start = appt.starts_at;
  const end = appt.ends_at || new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  return {
    summary,
    description: descLines.join('\n'),
    location: appt.location || job?.address || contact?.address || undefined,
    start,
    end,
  };
}

// Create or update the calendar event for an appointment row, then persist the
// resulting google_event_id / sync_status back to the DB. Returns the updated
// appointment row.
export async function upsertAppointmentEvent(db, appt, { job = null, contact = null } = {}) {
  let patch;
  if (!googleConfigured()) {
    patch = { sync_status: 'local' };
  } else {
    try {
      const payload = buildEvent(appt, { job, contact });
      let eventId = appt.google_event_id;
      if (eventId) {
        await calendarUpdateEvent(eventId, payload);
      } else {
        const created = await calendarCreateEvent(payload);
        eventId = created.id;
      }
      patch = { google_event_id: eventId, sync_status: 'synced' };
    } catch (e) {
      console.error('[calendar] upsert failed', e?.message);
      patch = { sync_status: 'failed' };
    }
  }
  const { data } = await db.from('crm_appointments').update(patch).eq('id', appt.id).select().single();
  return data || { ...appt, ...patch };
}

// Remove the calendar event backing an appointment (best-effort).
export async function deleteAppointmentEvent(appt) {
  if (!appt?.google_event_id || !googleConfigured()) return;
  try {
    await calendarDeleteEvent(appt.google_event_id);
  } catch (e) {
    console.error('[calendar] delete failed', e?.message);
  }
}
