// Email notifications via Resend.
// Sends the owner a heads-up the moment a new lead lands — with an EMERGENCY
// subject when the lead is urgent. Fully best-effort and no-op when unconfigured
// (so intake never breaks just because email isn't set up).
//
// Env:
//   RESEND_API_KEY     Resend API key
//   NOTIFY_FROM        Verified sender, e.g. "Arbo CRM <crm@yourdomain.com>"
//   NOTIFY_TO          Fallback recipient if crm_settings.notify_email is unset
//   APP_URL            Base URL of this app, used to build a link back to the lead

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_FROM = process.env.NOTIFY_FROM || 'Arbo CRM <onboarding@resend.dev>';
const NOTIFY_TO_FALLBACK = process.env.NOTIFY_TO || 'artistreeofvirginia@gmail.com';
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

export function notifyConfigured() {
  return Boolean(RESEND_API_KEY);
}

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Resolve the recipient: prefer the owner's configured notify_email, then env.
async function resolveRecipient(getDb) {
  try {
    const db = getDb?.();
    if (db) {
      const { data } = await db.from('crm_settings').select('notify_email').eq('id', 1).single();
      if (data?.notify_email) return data.notify_email;
    }
  } catch {
    /* fall through to env */
  }
  return NOTIFY_TO_FALLBACK;
}

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: NOTIFY_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`resend ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

// Fire a new-lead notification. Imported lazily inside captureLead to avoid a
// circular import with _lib.js.
export async function notifyNewLead(lead) {
  if (!RESEND_API_KEY || !lead) return { sent: false, reason: 'not_configured' };

  // Lazy import keeps _lib <-> _notify decoupled at module load.
  const { getDb } = await import('./_lib.js');
  const to = await resolveRecipient(getDb);

  const isEmergency = (lead.urgency || '').toLowerCase() === 'emergency';
  const who = lead.name || lead.phone || lead.email || 'Unknown contact';
  const subject = `${isEmergency ? '🚨 EMERGENCY lead' : 'New lead'}: ${who}`;
  const link = APP_URL ? `${APP_URL}/inbox` : null;

  const rows = [
    ['Name', lead.name],
    ['Phone', lead.phone],
    ['Email', lead.email],
    ['Address', lead.address],
    ['Service', lead.service_needed],
    ['Urgency', lead.urgency],
    ['Source', lead.source],
    ['Message', lead.message],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;color:#0f172a">${esc(v)}</td></tr>`
    )
    .join('');

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:${isEmergency ? '#b91c1c' : '#1B4D3E'};color:#fff;padding:16px 20px;border-radius:12px 12px 0 0">
      <div style="font-size:18px;font-weight:600">${isEmergency ? '🚨 Emergency lead' : 'New lead in your inbox'}</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:20px">
      <table style="border-collapse:collapse;font-size:14px;width:100%">${rows}</table>
      ${link ? `<div style="margin-top:20px"><a href="${esc(link)}" style="background:#1B4D3E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open the inbox →</a></div>` : ''}
    </div>
  </div>`;

  await sendEmail({ to, subject, html });
  return { sent: true, to };
}
