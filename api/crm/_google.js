// Google integration helper — shared by Gmail sync and Calendar sync.
//
// Auth model: a single Google account (the business's) authorizes this app once
// via OAuth, producing a long-lived refresh token. At runtime we exchange that
// refresh token for a short-lived access token and call the Gmail / Calendar
// REST APIs directly with fetch — no heavyweight SDK.
//
// Env:
//   GOOGLE_CLIENT_ID           OAuth client id
//   GOOGLE_CLIENT_SECRET       OAuth client secret
//   GOOGLE_REFRESH_TOKEN       Refresh token for the business Google account
//                              (scopes: gmail.modify + calendar.events)
//   GOOGLE_CALENDAR_ID         Target calendar (default "primary")
//   GMAIL_QUERY                Gmail search to treat as inbound inquiries
//                              (default: is:unread newer_than:7d in:inbox)
//   GMAIL_PROCESSED_LABEL      Label applied after import (default: Arbo/Processed)

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
export const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
export const GMAIL_QUERY = process.env.GMAIL_QUERY || 'is:unread newer_than:7d in:inbox';
export const GMAIL_PROCESSED_LABEL = process.env.GMAIL_PROCESSED_LABEL || 'Arbo/Processed';

export function googleConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

let _token = null;
let _expiresAt = 0;

// Exchange the refresh token for an access token, cached until ~1 min before it
// expires (module stays warm across invocations on the same instance).
export async function getAccessToken() {
  if (!googleConfigured()) throw new Error('google_not_configured');
  const now = Date.now();
  if (_token && now < _expiresAt - 60_000) return _token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`google_token ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  _token = data.access_token;
  _expiresAt = now + (data.expires_in || 3600) * 1000;
  return _token;
}

async function gapi(path, { method = 'GET', body, base = 'https://gmail.googleapis.com' } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`google_api ${method} ${path} ${res.status}: ${detail.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------
export async function gmailListMessages(query = GMAIL_QUERY, max = 25) {
  const data = await gapi(`/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  return data.messages || [];
}

export async function gmailGetMessage(id) {
  return gapi(`/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
}

// Ensure a label exists, returning its id (cached per instance).
const _labelCache = new Map();
export async function gmailEnsureLabel(name = GMAIL_PROCESSED_LABEL) {
  if (_labelCache.has(name)) return _labelCache.get(name);
  const { labels = [] } = await gapi('/gmail/v1/users/me/labels');
  let found = labels.find((l) => l.name === name);
  if (!found) {
    found = await gapi('/gmail/v1/users/me/labels', {
      method: 'POST',
      body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    });
  }
  _labelCache.set(name, found.id);
  return found.id;
}

// Mark a message imported: add the processed label and remove UNREAD.
export async function gmailMarkProcessed(id, labelId) {
  return gapi(`/gmail/v1/users/me/messages/${id}/modify`, {
    method: 'POST',
    body: { addLabelIds: [labelId], removeLabelIds: ['UNREAD'] },
  });
}

// Parse a raw "From" header into { name, email }.
export function parseFrom(header = '') {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?\s*$/.exec(header);
  if (!m) return { name: null, email: null };
  return { name: (m[1] || '').trim() || null, email: (m[2] || '').trim().toLowerCase() || null };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
const CAL_BASE = 'https://www.googleapis.com';

export async function calendarCreateEvent({ summary, description, location, start, end }) {
  const startISO = new Date(start).toISOString();
  const endISO = new Date(end || new Date(new Date(start).getTime() + 60 * 60 * 1000)).toISOString();
  const event = await gapi(`/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, {
    base: CAL_BASE,
    method: 'POST',
    body: {
      summary,
      description,
      location,
      start: { dateTime: startISO },
      end: { dateTime: endISO },
    },
  });
  return event; // { id, htmlLink, ... }
}

export async function calendarUpdateEvent(eventId, { summary, description, location, start, end }) {
  const patch = {};
  if (summary !== undefined) patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (location !== undefined) patch.location = location;
  if (start !== undefined) patch.start = { dateTime: new Date(start).toISOString() };
  if (end !== undefined) patch.end = { dateTime: new Date(end).toISOString() };
  return gapi(`/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${eventId}`, {
    base: CAL_BASE,
    method: 'PATCH',
    body: patch,
  });
}

export async function calendarDeleteEvent(eventId) {
  const token = await getAccessToken();
  const res = await fetch(
    `${CAL_BASE}/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${eventId}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }
  );
  // 410 = already gone; treat as success.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const detail = await res.text().catch(() => '');
    throw new Error(`google_api DELETE event ${res.status}: ${detail.slice(0, 200)}`);
  }
  return true;
}
