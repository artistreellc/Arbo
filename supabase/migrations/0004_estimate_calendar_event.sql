-- estimate.calendar_event_id (§5A #14 + D36). When a signed contract flips an
-- estimate to a booked job, ARBOR recolors the ORIGINAL estimate calendar
-- event to Sage (colorId 2) — Mike's real "job won" convention, learned from
-- the live calendar and confirmed by Mike (O5). Recoloring needs the event id
-- stored on the estimate.
--
-- Provenance note: the parked generic-CRM detour once added this same column
-- as unrecorded drift (D26). This migration adds it LEGITIMATELY, with the
-- brief-aligned use case; `if not exists` makes it safe in either order
-- relative to the D26 rollback.

alter table estimate add column if not exists calendar_event_id text;
