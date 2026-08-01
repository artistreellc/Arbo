// /api/crm/intake — the universal front door for leads.
// PUBLIC endpoint (no admin token) so a website form and other channels can
// POST here. Protected by a honeypot + light validation. Every lead from every
// avenue should ultimately flow through captureLead().
//
// POST { name, email, phone, address, service_needed, message, urgency,
//        source, source_detail, company (honeypot) }
import { captureLead, parseBody, getDb, isEmail } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!getDb()) {
    // CRM not wired up yet — don't hard-fail the caller (e.g. a website form
    // may still succeed via its own email path); just report it wasn't stored.
    return res.status(200).json({ stored: false, reason: 'not_configured' });
  }

  const body = parseBody(req);

  // Honeypot: bots fill hidden fields.
  if ((body.company || '').trim() !== '') return res.status(200).json({ stored: true });

  const name = (body.name || '').trim();
  const phone = (body.phone || '').trim();
  const email = (body.email || '').trim();
  if (!name && !phone && !email) return res.status(400).json({ error: 'insufficient_contact' });
  if (email && !isEmail(email)) return res.status(400).json({ error: 'bad_email' });

  try {
    const { lead, contact } = await captureLead({ ...body, source: body.source || 'website_form' });
    return res.status(200).json({ stored: true, lead_id: lead.id, contact_id: contact?.id });
  } catch (err) {
    console.error('[api/crm/intake]', err);
    return res.status(500).json({ error: 'server_error' });
  }
}
