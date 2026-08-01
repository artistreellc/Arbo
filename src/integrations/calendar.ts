// Google Calendar filing (brief §5A #9). Auth-agnostic, like the Drive module:
// pass a CalendarApi implementation (live Google API in prod, a fake in tests).
// ARBOR books estimates/jobs with the correct colorId and never double-books.

export interface CalendarEventInput {
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
  // City color for visits (D34); omitted = calendar default (jobs/admin).
  colorId?: string;
  // Stored so route-clustering and geofencing can find the property later.
  zip?: string;
  propertyId?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  startIso: string;
  endIso: string;
  colorId?: string;
  zip?: string;
}

export interface CalendarApi {
  listEvents(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<CalendarEvent[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  /** Recolor an existing event — the Sage "job won" flip (D36) uses this. */
  updateEventColor(calendarId: string, eventId: string, colorId: string): Promise<void>;
}

const BASE = 'https://www.googleapis.com/calendar/v3';

/** Live Google Calendar implementation. `getAccessToken` injected at deploy. */
export function createGoogleCalendarApi(getAccessToken: () => Promise<string>): CalendarApi {
  const auth = async () => ({ Authorization: `Bearer ${await getAccessToken()}` });

  return {
    async listEvents(calendarId, timeMinIso, timeMaxIso) {
      const params = new URLSearchParams({
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });
      const res = await fetch(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
        headers: { ...(await auth()) },
      });
      if (!res.ok) throw new Error(`Calendar listEvents failed: ${res.status}`);
      const data = (await res.json()) as { items?: GoogleEvent[] };
      return (data.items ?? []).map(fromGoogle);
    },
    async createEvent(input) {
      const body = {
        summary: input.summary,
        description: input.description,
        location: input.location,
        colorId: input.colorId,
        start: { dateTime: input.startIso },
        end: { dateTime: input.endIso },
        extendedProperties: { private: { zip: input.zip ?? '', propertyId: input.propertyId ?? '', arbor: '1' } },
      };
      const res = await fetch(`${BASE}/calendars/${encodeURIComponent(input.calendarId)}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await auth()) },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Calendar createEvent failed: ${res.status}`);
      return fromGoogle((await res.json()) as GoogleEvent);
    },
    async updateEventColor(calendarId, eventId, colorId) {
      const res = await fetch(
        `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...(await auth()) },
          body: JSON.stringify({ colorId }),
        },
      );
      if (!res.ok) throw new Error(`Calendar updateEventColor failed: ${res.status}`);
    },
  };
}

interface GoogleEvent {
  id: string;
  summary?: string;
  colorId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

function fromGoogle(e: GoogleEvent): CalendarEvent {
  return {
    id: e.id,
    summary: e.summary ?? '',
    startIso: e.start?.dateTime ?? e.start?.date ?? '',
    endIso: e.end?.dateTime ?? e.end?.date ?? '',
    colorId: e.colorId,
    zip: e.extendedProperties?.private?.zip || undefined,
  };
}
