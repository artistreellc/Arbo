// Practice data for Today's stops (R35, Mike 2026-10-20: "so its automated and
// when i select a name in my schedule it asks if i want to open google maps").
// In simulation mode (ARBO_DATA_LINKS=sim) the Calendar tab's Today's stops
// show these instead of reading Google — §3's simulation convention: SIM-
// names, 757-555-01xx numbers, streets that do not exist. One event has no
// location, so the "no address on the event" row has something to render.
// Nothing here is ever sent to TomTom or Google: practice plans by ZIP only.

import type { CalendarEvent } from '../integrations/calendar.js';
import { etInstant } from '../lib/etDay.js';

export function simTodayEvents(day: string): CalendarEvent[] {
  const at = (h: number, m = 0) => etInstant(day, h * 60 + m).toISOString();
  return [
    { id: 'SIM-ev-1', summary: 'Estimate - SIM-Alder, Test - 757-555-0101', startIso: at(16), endIso: at(16, 20), location: '101 Simulation Row, Virginia Beach, VA 23451' },
    { id: 'SIM-ev-2', summary: 'Estimate - SIM-Birch, Test - 757-555-0102', startIso: at(16, 45), endIso: at(17, 5), location: '202 Placeholder Way, Norfolk, VA 23503' },
    { id: 'SIM-ev-3', summary: 'Estimate - SIM-Cedar, Test - 757-555-0103', startIso: at(17, 30), endIso: at(17, 50), location: '303 Fictional Court, Chesapeake, VA 23320' },
    { id: 'SIM-ev-4', summary: 'SIM-Dogwood, Test - call back about the oak', startIso: at(18, 15), endIso: at(18, 30) },
  ];
}
