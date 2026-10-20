// H3 (audit 2026-10-20): a requested-time hold lands on the caller's
// America/New_York day, whatever the UTC clock says. The bug: the target
// day came from the UTC calendar date of now + N×24h, so any call after
// 8pm EDT / 7pm EST put the hold one day late on Mike's real calendar.
// The fix reads the ET day from the shared helper (src/lib/etDay.ts) and
// adds days by calendar label — no second clock, no 24h-of-milliseconds.
import { describe, it, expect } from 'vitest';
import { parseRequestedWindow } from '../src/ops/requestedWindow.js';

const start = (text: string, nowIso: string) => parseRequestedWindow(text, new Date(nowIso))?.startIso ?? null;

describe('requested-time holds land on the ET day the caller meant (H3)', () => {
  // Mon Oct 19 2026 — EDT (UTC−4).
  it('evening calls in EDT: 8pm, 9pm and 11:59pm all mean the same tomorrow', () => {
    for (const nowIso of ['2026-10-20T00:00:00Z', '2026-10-20T01:00:00Z', '2026-10-20T03:59:00Z']) {
      expect(start('tomorrow morning', nowIso), nowIso).toBe('2026-10-20T13:00:00.000Z'); // Tue Oct 20, 9:00 EDT
      expect(start('wednesday after 4', nowIso), nowIso).toBe('2026-10-21T20:00:00.000Z'); // Wed Oct 21, 16:00 EDT
      expect(start('friday afternoon', nowIso), nowIso).toBe('2026-10-23T18:00:00.000Z'); // Fri Oct 23, 14:00 EDT
      expect(start('today evening', nowIso), nowIso).toBe('2026-10-19T21:00:00.000Z'); // still Mon Oct 19 in ET
    }
  });

  it('the same weekday said on that weekday evening means next week, not the day after', () => {
    expect(start('monday morning', '2026-10-20T01:00:00Z')).toBe('2026-10-26T13:00:00.000Z'); // Mon Oct 26, 9:00 EDT
  });

  // Mon Dec 7 2026 — EST (UTC−5): the bad window opened at 7pm.
  it('evening calls in EST: 7pm, 7:30pm and 11:30pm all mean the same tomorrow', () => {
    for (const nowIso of ['2026-12-08T00:00:00Z', '2026-12-08T00:30:00Z', '2026-12-08T04:30:00Z']) {
      expect(start('tomorrow morning', nowIso), nowIso).toBe('2026-12-08T14:00:00.000Z'); // Tue Dec 8, 9:00 EST
      expect(start('thursday at 10 am', nowIso), nowIso).toBe('2026-12-10T15:00:00.000Z'); // Thu Dec 10, 10:00 EST
    }
  });

  it('across fall-back: Sat Oct 31 at 11pm EDT, "sunday morning" is Nov 1 at 9:00 EST', () => {
    expect(start('sunday morning', '2026-11-01T03:00:00Z')).toBe('2026-11-01T14:00:00.000Z');
  });

  it('across spring-forward: Sat Mar 13 2027 at 10pm EST, "tomorrow morning" is Mar 14 at 9:00 EDT', () => {
    expect(start('tomorrow morning', '2027-03-14T03:00:00Z')).toBe('2027-03-14T13:00:00.000Z');
  });

  it('daytime calls are unchanged (the original pins still hold)', () => {
    const tue11 = '2026-09-22T15:00:00Z'; // Tue Sep 22, 11:00 EDT
    expect(start('tomorrow morning?', tue11)).toBe('2026-09-23T13:00:00.000Z');
    expect(start('Is he available Wednesday after 4:00?', tue11)).toBe('2026-09-23T20:00:00.000Z');
    expect(start('tuesday morning works', tue11)).toBe('2026-09-29T13:00:00.000Z');
  });

  it('the hold label carries the absolute ET date, so a hold can be checked against the call', () => {
    const w = parseRequestedWindow('tomorrow morning', new Date('2026-10-20T01:00:00Z'))!;
    expect(w.label).toBe('tomorrow morning (Tue Oct 20)');
    expect(parseRequestedWindow('sunday morning', new Date('2026-11-01T03:00:00Z'))!.label).toBe('sunday morning (Sun Nov 1)');
  });
});
