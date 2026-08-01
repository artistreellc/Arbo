// /api/crm/integrations — report which optional integrations are configured, so
// the Settings screen can show honest "Connected / Not connected" status. Never
// returns secrets — only booleans derived from env presence.
import { requireAuth } from './_lib.js';
import { googleConfigured } from './_google.js';
import { notifyConfigured } from './_notify.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await requireAuth(req, res))) return;

  const google = googleConfigured();
  return res.status(200).json({
    gmail: { connected: google },
    calendar: { connected: google, calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary' },
    resend: { connected: notifyConfigured() },
  });
}
