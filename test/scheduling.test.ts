import { describe, it, expect } from 'vitest';
import { freeSlots, isFree, overlaps } from '../src/scheduling/availability.js';
import { clusterScore, groupByZip } from '../src/scheduling/clustering.js';
import { recommendSlots, bookApproved, ApprovalRequiredError, DoubleBookingError } from '../src/scheduling/scheduler.js';
import { CALENDAR_COLORS, DEFAULT_SCHEDULING } from '../src/scheduling/config.js';
import type { CalendarApi, CalendarEvent, CalendarEventInput } from '../src/integrations/calendar.js';

// Fixed week: 2026-08-03 is a Monday (America/New_York). Use 13:00Z = 9am EDT.
const MON = '2026-08-03';
const at = (day: string, hourZ: number, min = 0) => `${day}T${String(hourZ).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`;

describe('availability — working hours + no double-booking', () => {
  it('overlap + isFree basics', () => {
    const a = { startIso: at(MON, 14), endIso: at(MON, 15) };
    const b = { startIso: at(MON, 14, 30), endIso: at(MON, 15, 30) };
    expect(overlaps(a, b)).toBe(true);
    expect(isFree(a, [b])).toBe(false);
    expect(isFree(a, [{ startIso: at(MON, 16), endIso: at(MON, 17) }])).toBe(true);
  });

  it('generates only in-hours slots and skips busy times', () => {
    const busy = [{ startIso: at(MON, 14), endIso: at(MON, 16) }]; // 10am–12pm EDT
    const slots = freeSlots(at(MON, 12), at(MON, 21), busy, 30); // 8am–5pm EDT window
    expect(slots.length).toBeGreaterThan(0);
    // none overlap the busy block
    expect(slots.every((s) => isFree(s, busy))).toBe(true);
    // all start at/after 8am EDT (12:00Z) and end by 5pm EDT (21:00Z)
    expect(slots.every((s) => Date.parse(s.startIso) >= Date.parse(at(MON, 12)))).toBe(true);
    expect(slots.every((s) => Date.parse(s.endIso) <= Date.parse(at(MON, 21)))).toBe(true);
  });

  it('does not schedule on Sunday (2026-08-02)', () => {
    const slots = freeSlots(at('2026-08-02', 12), at('2026-08-02', 21), [], 30);
    expect(slots).toHaveLength(0);
  });
});

describe('ZIP clustering', () => {
  it('groups by zip', () => {
    const g = groupByZip([{ zip: '23451' }, { zip: '23451' }, { zip: '23505' }]);
    expect(g.get('23451')).toHaveLength(2);
    expect(g.get('23505')).toHaveLength(1);
  });

  it('scores same-ZIP same-day work higher', () => {
    const slot = { startIso: at(MON, 18), endIso: at(MON, 18, 30) };
    const sameZip = [{ startIso: at(MON, 15), endIso: at(MON, 16), zip: '23451' }];
    const otherZip = [{ startIso: at(MON, 15), endIso: at(MON, 16), zip: '23505' }];
    expect(clusterScore(slot, '23451', sameZip)).toBeGreaterThan(clusterScore(slot, '23451', otherZip));
  });
});

describe('scheduler — recommend, never auto-commit (§5A #11)', () => {
  it('recommends slots ranked by clustering, all flagged requiresApproval', () => {
    const existing = [{ startIso: at(MON, 15), endIso: at(MON, 16), zip: '23451' }];
    const suggestions = recommendSlots(
      { kind: 'estimate', zip: '23451', fromIso: at(MON, 12), toIso: at(MON, 21) },
      existing,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => s.requiresApproval === true)).toBe(true);
    expect(suggestions[0]!.colorId).toBe(CALENDAR_COLORS.estimate);
    // top suggestion should be the same day as the same-ZIP work (clustered)
    expect(suggestions[0]!.startIso.slice(0, 10)).toBe(MON);
  });

  it('refuses to book without explicit approval', async () => {
    const api = fakeCalendar();
    await expect(
      bookApproved(api.api, {
        calendarId: 'primary', summary: 'Estimate', kind: 'estimate',
        slot: { startIso: at(MON, 18), endIso: at(MON, 18, 30) },
        approved: false, existingBusy: [],
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(api.created).toHaveLength(0);
  });

  it('books an approved slot with the right color, and blocks double-booking', async () => {
    const api = fakeCalendar();
    const slot = { startIso: at(MON, 18), endIso: at(MON, 18, 30) };

    const ev = await bookApproved(api.api, {
      calendarId: 'primary', summary: 'Estimate — 742 Evergreen', kind: 'estimate',
      zip: '23451', slot, approved: true, existingBusy: [],
    });
    expect(ev.id).toBeTruthy();
    expect(api.created[0]!.colorId).toBe(CALENDAR_COLORS.estimate);

    // now that slot is busy — a second booking must be refused
    await expect(
      bookApproved(api.api, {
        calendarId: 'primary', summary: 'Another', kind: 'job',
        slot, approved: true, existingBusy: [slot],
      }),
    ).rejects.toBeInstanceOf(DoubleBookingError);
  });
});

function fakeCalendar() {
  const created: CalendarEventInput[] = [];
  const api: CalendarApi = {
    async listEvents(): Promise<CalendarEvent[]> {
      return [];
    },
    async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
      created.push(input);
      return { id: `evt_${created.length}`, summary: input.summary, startIso: input.startIso, endIso: input.endIso, colorId: input.colorId };
    },
  };
  return { api, created };
}

// Sanity: config uses non-payment colors.
describe('calendar colors avoid the payment red (11)', () => {
  it('estimate/job/emergency are not Tomato', () => {
    for (const k of ['estimate', 'job', 'emergency', 'follow_up'] as const) {
      expect(CALENDAR_COLORS[k]).not.toBe('11');
    }
    expect(DEFAULT_SCHEDULING.workingDays).not.toContain(0); // no Sundays
  });
});

describe('estimates are afternoon-only (§3.11 — mornings protected for crew jobs)', () => {
  it('never suggests a morning estimate slot', () => {
    // Offer the whole working day 8am–6pm EDT (12:00Z–22:00Z); estimates must
    // only land in the afternoon window (12pm–5pm EDT = 16:00Z–21:00Z).
    const suggestions = recommendSlots(
      { kind: 'estimate', zip: '23464', fromIso: at(MON, 12), toIso: at(MON, 22) },
      [],
      undefined,
      20,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(Date.parse(s.startIso)).toBeGreaterThanOrEqual(Date.parse(at(MON, 16))); // >= 12pm EDT
      expect(Date.parse(s.endIso)).toBeLessThanOrEqual(Date.parse(at(MON, 21))); // <= 5pm EDT
    }
  });
});
