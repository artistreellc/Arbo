// /api/crm/sync/gmail — pull inquiry emails from the business inbox into the CRM.
//
// Runs two ways:
//   • Vercel Cron (scheduled in vercel.json) — authorized via CRON_SECRET.
//   • The "Sync now" button in Settings — authorized via the admin JWT.
//
// For each matching message it captures a lead (deduped by Gmail message id via
// captureLead's external_id guard) and labels the message processed so it won't
// be imported again. Fully no-op when Google isn't configured.
import { getDb, requireAuth, isCron, captureLead } from '../_lib.js';
import {
  googleConfigured,
  gmailListMessages,
  gmailGetMessage,
  gmailEnsureLabel,
  gmailMarkProcessed,
  parseFrom,
  GMAIL_QUERY,
} from '../_google.js';

function header(msg, name) {
  const h = (msg?.payload?.headers || []).find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Auth: cron secret OR an admin session.
  if (!isCron(req)) {
    if (!(await requireAuth(req, res))) return;
  }

  if (!getDb()) return res.status(503).json({ error: 'not_configured' });
  if (!googleConfigured()) {
    return res.status(200).json({ ok: true, configured: false, scanned: 0, captured: 0 });
  }

  try {
    const labelId = await gmailEnsureLabel();
    const messages = await gmailListMessages(GMAIL_QUERY, 25);

    let captured = 0;
    const results = [];
    for (const { id } of messages) {
      try {
        const msg = await gmailGetMessage(id);
        const from = parseFrom(header(msg, 'From'));
        const subject = header(msg, 'Subject');
        const snippet = msg.snippet || '';

        const { deduped } = await captureLead({
          name: from.name,
          email: from.email,
          message: snippet,
          service_needed: subject,
          source: 'gmail',
          source_detail: subject?.slice(0, 200),
          external_id: id, // Gmail message id → dedup guard
          raw: { gmail_id: id, thread_id: msg.threadId, subject, from: header(msg, 'From') },
        });

        if (!deduped) captured += 1;
        // Label as processed regardless, so a re-run won't reconsider it.
        await gmailMarkProcessed(id, labelId);
        results.push({ id, deduped, subject });
      } catch (e) {
        console.error('[sync/gmail] message failed', id, e?.message);
        results.push({ id, error: e?.message });
      }
    }

    return res.status(200).json({ ok: true, configured: true, scanned: messages.length, captured, results });
  } catch (err) {
    console.error('[sync/gmail]', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
