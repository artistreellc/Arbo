/*
  SLOW::ARBO — see src/assessment/utilityMarkings.ts for the full marker.

  Mike, 2026-08-03: "all that miss utitly marking would be store and though
  dtted its not to be treated as the same thing but itll let ya know if you
  really got to waste the time and call them gain casue tyou dont remember
  and the homeowner its a duts".

  So: remember everything, draw it dotted, and never let it stand in for a
  locate. These tests are pointed at that last clause.
*/
import { describe, it, expect } from 'vitest';

import {
  renderMarking, digStanding, assertNeverClearToDig,
  MARKING_RENDER, UTILITY_COLOR, UTILITY_LABEL,
  type UtilityMarking, type LocateTicket,
} from '../src/assessment/utilityMarkings.js';

const TODAY = '2026-08-03';

const mark = (over: Partial<UtilityMarking> = {}): UtilityMarking => ({
  id: 'm1', kind: 'gas_oil_steam', where: 'across the front lawn to the meter',
  markedOn: '2026-07-20', ticketNumber: 'A26-0712345', recordedBy: 'Mike',
  photoRefs: [], lat: null, lng: null, approxDepthInches: null, notes: null, ...over,
});

const ticket = (over: Partial<LocateTicket> = {}): LocateTicket => ({
  id: 'tk1', ticketNumber: 'A26-0712345', requestedOn: '2026-07-18',
  validThrough: null, requestedBy: 'Mike', notes: null, ...over,
});

describe('a remembered marking is always drawn dotted', () => {
  it('renders dotted and says out loud it is not a live locate', () => {
    const r = renderMarking(mark(), TODAY);
    expect(r.render).toBe(MARKING_RENDER);
    expect(r.render).toBe('historical_dotted');
    expect(r.line).toMatch(/Not a live locate/i);
  });

  it('carries the APWA colour so it matches what was on the ground', () => {
    expect(renderMarking(mark({ kind: 'electric' }), TODAY).color).toBe('red');
    expect(renderMarking(mark({ kind: 'communications' }), TODAY).color).toBe('orange');
    expect(renderMarking(mark({ kind: 'potable_water' }), TODAY).color).toBe('blue');
    expect(renderMarking(mark({ kind: 'sewer_drain' }), TODAY).color).toBe('green');
  });

  it('every kind has a label and a colour — no undefined on a screen', () => {
    for (const kind of Object.keys(UTILITY_LABEL) as Array<keyof typeof UTILITY_LABEL>) {
      expect(UTILITY_LABEL[kind]).toBeTruthy();
      expect(UTILITY_COLOR[kind]).toBeTruthy();
    }
  });

  it('shows the age, so a three-year-old paint line cannot pass for last week', () => {
    expect(renderMarking(mark({ markedOn: '2026-07-20' }), TODAY).ageDays).toBe(14);
    expect(renderMarking(mark({ markedOn: '2023-07-20' }), TODAY).ageDays).toBeGreaterThan(1000);
  });

  it('an undated marking says the date is missing rather than looking fresh', () => {
    const r = renderMarking(mark({ markedOn: null }), TODAY);
    expect(r.ageDays).toBeNull();
    expect(r.line).toMatch(/date not recorded/i);
  });

  it('an unidentified marking is still kept and still named', () => {
    // Mike's ask is to store ALL of it. A marking nobody could identify is
    // still worth remembering; it just cannot claim to be something.
    const r = renderMarking(mark({ kind: 'unknown' }), TODAY);
    expect(r.label).toBe('Unidentified marking');
    expect(r.color).toBe('unrecorded');
  });
});

describe('"do I really have to call them again?"', () => {
  it('nothing on file — call, and say there is nothing to go on', () => {
    const s = digStanding({ markings: [], tickets: [], todayEt: TODAY });
    expect(s.status).toBe('call_811');
    expect(s.line).toMatch(/Nothing remembered on this property/i);
  });

  it('markings but no ticket — call, and the memory is context for the call', () => {
    // This is the case Mike described: you cannot remember, the homeowner is
    // no help, but we know what is down there.
    const s = digStanding({ markings: [mark()], tickets: [], todayEt: TODAY });
    expect(s.status).toBe('call_811');
    expect(s.line).toMatch(/We remember 1 marking/i);
    expect(s.line).toMatch(/not a locate and they do not stand in for one/i);
    expect(s.reason).toMatch(/no ticket on file/i);
  });

  it('a ticket with NO validity date recorded does not count as live', () => {
    // Not knowing is not the same as being in date. Guessing a ticket's life
    // is how a crew ends up in a gas line.
    const s = digStanding({ markings: [mark()], tickets: [ticket()], todayEt: TODAY });
    expect(s.status).toBe('call_811');
    expect(s.reason).toMatch(/no validity date recorded/i);
  });

  it('an expired ticket does not count as live', () => {
    const s = digStanding({
      markings: [mark()], tickets: [ticket({ validThrough: '2026-07-25' })], todayEt: TODAY,
    });
    expect(s.status).toBe('call_811');
    expect(s.reason).toMatch(/run out/i);
  });

  it('a ticket in date is the ONLY softer answer, and it still says verify', () => {
    const s = digStanding({
      markings: [mark()], tickets: [ticket({ validThrough: '2026-08-15' })], todayEt: TODAY,
    });
    expect(s.status).toBe('ticket_on_file_verify');
    expect(s.verifyBeforeDigging).toBe(true);
    expect(s.line).toMatch(/Confirm it is still live/i);
    expect(s.line).toMatch(/not the one-call centre/i);
  });

  it('a ticket expiring today still counts as in date', () => {
    const s = digStanding({ markings: [], tickets: [ticket({ validThrough: TODAY })], todayEt: TODAY });
    expect(s.status).toBe('ticket_on_file_verify');
  });

  it('there is no third status meaning "you are fine"', () => {
    // Mirrors ScreenStatus having no 'clear' member. The type is the guard.
    const statuses = new Set<string>();
    for (const t of [[], [ticket()], [ticket({ validThrough: '2026-08-15' })], [ticket({ validThrough: '2020-01-01' })]]) {
      statuses.add(digStanding({ markings: [mark()], tickets: t, todayEt: TODAY }).status);
    }
    expect([...statuses].sort()).toEqual(['call_811', 'ticket_on_file_verify']);
  });

  it('puts the least trustworthy markings first', () => {
    const s = digStanding({
      markings: [
        mark({ id: 'recent', markedOn: '2026-08-01' }),
        mark({ id: 'undated', markedOn: null }),
        mark({ id: 'old', markedOn: '2024-01-01' }),
      ],
      tickets: [], todayEt: TODAY,
    });
    // Undated is the easiest to over-read, so it goes where it gets seen.
    expect(s.markings[0]!.id).toBe('undated');
    expect(s.markings[1]!.id).toBe('old');
    expect(s.markings[2]!.id).toBe('recent');
  });
});

describe('nothing here can ever authorise digging', () => {
  const everyCase = [
    digStanding({ markings: [], tickets: [], todayEt: TODAY }),
    digStanding({ markings: [mark()], tickets: [], todayEt: TODAY }),
    digStanding({ markings: [mark({ markedOn: null })], tickets: [ticket()], todayEt: TODAY }),
    digStanding({ markings: [mark()], tickets: [ticket({ validThrough: '2026-08-15' })], todayEt: TODAY }),
    digStanding({ markings: [mark()], tickets: [ticket({ validThrough: '2020-01-01' })], todayEt: TODAY }),
  ];

  it('passes the structural assertion in every reachable state', () => {
    for (const s of everyCase) {
      expect(() => assertNeverClearToDig(s)).not.toThrow();
      expect(s.verifyBeforeDigging).toBe(true);
    }
  });

  it('the assertion bites — it is not a no-op', () => {
    const base = digStanding({ markings: [mark()], tickets: [], todayEt: TODAY });
    expect(() => assertNeverClearToDig({ ...base, line: 'Safe to dig, already located.' })).toThrow(/permission to excavate/i);
    expect(() => assertNeverClearToDig({ ...base, line: "You're clear." })).toThrow(/forbidden/i);
    expect(() => assertNeverClearToDig({ ...base, line: 'No need to call.' })).toThrow(/permission to excavate/i);
  });

  it('a marking that claims to be current is rejected outright', () => {
    const base = digStanding({ markings: [mark()], tickets: [], todayEt: TODAY });
    const tampered = {
      ...base,
      markings: [{ ...base.markings[0]!, render: 'solid_current' as unknown as typeof MARKING_RENDER }],
    };
    expect(() => assertNeverClearToDig(tampered)).toThrow(/must render dotted/i);
  });

  it('no reachable line ever says the word combination that would get someone hurt', () => {
    for (const s of everyCase) {
      for (const line of [s.line, ...s.markings.map((m) => m.line)]) {
        expect(line).not.toMatch(/safe to dig|clear to dig|no need to call|already located/i);
      }
    }
  });
});
