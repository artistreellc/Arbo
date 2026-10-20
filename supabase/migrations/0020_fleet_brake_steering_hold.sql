-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
-- STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
-- ═══════════════════════════════════════════════════════════════════════
--
-- 0020 — THE BRAKE/STEERING HOLD (R26, Mike 2026-10-20).
--
-- Approved on the pre-deploy review: "A brake or steering defect keeps a
-- unit off the schedule until signed back on." Default (R26): Mike signs it
-- back on, with the owner key; no designate.
--
-- Two changes to equipment_unit, nothing else:
--
--   1. A fifth status, 'held'. A brake or steering field report sets it
--      whatever the severity, and isSchedulable() rejects it. Before this, a
--      brake report that was not "immobilized" went to 'maintenance', which
--      the scheduler treats as usable.
--   2. Who signed a held unit back on, and when. The sign-back route is the
--      only writer of these, and it only moves a unit that is still held.
--
-- Both columns are NULLABLE with no default: NULL means nobody has signed
-- this unit back on, never "signed by nobody". No existing row changes —
-- every current status is still allowed, and no unit is moved to 'held'.
--
-- No crew policy is added. equipment_unit stays admin-only (§8C.1, and
-- test/accessControl.test.ts holds that line), so a crew login cannot sign
-- a unit back on through the database either.
--
-- ───────────────────────────────────────────────────────────────────────
-- NOT APPLIED LIVE. §3.
-- ───────────────────────────────────────────────────────────────────────
-- Committed, not applied — same as 0016, 0017 and 0018. The data links are
-- cut and schema changes on Mike's live database are his call. It MUST be
-- applied before the equipment link opens: without it the live CHECK refuses
-- 'held', and a brake report would fail to save instead of holding the unit.

alter table equipment_unit drop constraint if exists equipment_unit_status_check;
alter table equipment_unit add constraint equipment_unit_status_check
  check (status in ('up','down','maintenance','held','retired'));

alter table equipment_unit add column if not exists signed_back_by text;
alter table equipment_unit add column if not exists signed_back_at timestamptz;
