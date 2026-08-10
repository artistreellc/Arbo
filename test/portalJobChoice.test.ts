// Which job the customer portal shows (task #35, cycle 11).
//
// customerView renders exactly ONE job, so something has to choose, and the
// wrong choice hides work or hides money. These tests pin the order down, and
// one of them is a regression test for a bug found reviewing my own diff
// before it shipped.

import { describe, it, expect } from 'vitest';
import { chooseJob, type JobRow } from '../src/db/portalRepo.js';

function job(over: Partial<JobRow>): JobRow {
  return {
    id: 'j1',
    status: 'booked',
    scheduled_for: null,
    completed_at: null,
    materials: null,
    estimate_id: null,
    agreedAmount: null,
    paid: false,
    paidAmount: null,
    ...over,
  };
}

const NOW = Date.UTC(2026, 7, 11, 9, 0, 0); // 2026-08-11T09:00:00Z

describe('chooseJob', () => {
  it('has nothing to show for a property with no jobs', () => {
    expect(chooseJob([], NOW)).toBeNull();
  });

  it('puts an unpaid finished job ahead of an upcoming booking', () => {
    // The customer may be trying to pay it. Burying it behind the next
    // booking means they cannot.
    const chosen = chooseJob([
      job({ id: 'upcoming', scheduled_for: '2026-08-20T14:00:00+00:00' }),
      job({ id: 'unpaid', completed_at: '2026-08-01T18:00:00+00:00', paid: false }),
    ], NOW);
    expect(chosen?.id).toBe('unpaid');
  });

  it('does not resurface a finished job that is already paid', () => {
    const chosen = chooseJob([
      job({ id: 'upcoming', scheduled_for: '2026-08-20T14:00:00+00:00' }),
      job({ id: 'settled', completed_at: '2026-08-01T18:00:00+00:00', paid: true, paidAmount: 900 }),
    ], NOW);
    expect(chosen?.id).toBe('upcoming');
  });

  it('shows the SOONEST booking ahead, not the furthest', () => {
    const chosen = chooseJob([
      job({ id: 'later', scheduled_for: '2026-09-01T14:00:00+00:00' }),
      job({ id: 'sooner', scheduled_for: '2026-08-14T14:00:00+00:00' }),
    ], NOW);
    expect(chosen?.id).toBe('sooner');
  });

  it('ignores a booking that has already passed when picking "upcoming"', () => {
    const chosen = chooseJob([
      job({ id: 'past', scheduled_for: '2026-08-01T14:00:00+00:00' }),
    ], NOW);
    // Falls through to "most recent thing that happened" rather than claiming
    // a past date is what to plan around.
    expect(chosen?.id).toBe('past');
  });

  // ── REGRESSION ───────────────────────────────────────────────────────────
  // Found reviewing this cycle's own diff. The first version compared
  // `scheduled_for >= new Date().toISOString()` as STRINGS. Postgres returns
  // `+00:00` offsets and toISOString() produces `Z`, so the two sort by
  // accident of formatting rather than by time. A booking at 08:00-04:00 is
  // 12:00Z — three hours in the future — but the string '...T08:00:00-04:00'
  // compares LESS than '...T09:00:00.000Z', so it was silently dropped from
  // "upcoming" and the customer's next visit vanished off their page.
  it('treats an offset timestamp as an instant, not as text', () => {
    const chosen = chooseJob([
      job({ id: 'offset-booking', scheduled_for: '2026-08-11T08:00:00-04:00' }),
    ], NOW);
    expect(chosen?.id).toBe('offset-booking');

    // And prove the comparison genuinely used the instant: the same wall-clock
    // string in a different zone is in the PAST and must not be picked as the
    // soonest upcoming when a real upcoming one exists.
    const mixed = chooseJob([
      job({ id: 'actually-past', scheduled_for: '2026-08-11T08:00:00+04:00' }), // 04:00Z, past
      job({ id: 'actually-future', scheduled_for: '2026-08-11T08:00:00-04:00' }), // 12:00Z, future
    ], NOW);
    expect(mixed?.id).toBe('actually-future');
  });
});
