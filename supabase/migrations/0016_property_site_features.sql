-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
-- STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
-- ═══════════════════════════════════════════════════════════════════════
--
-- 0016 — SITE FEATURES FOR THE CUSTOMER PORTAL (§8C third door).
--
-- Mike, 2026-08-03: "the portal will have all the relative information such
-- as power lines and water meter cap location with a note on how to find the
-- water meter's path."
--
-- WHY THESE ARE NULLABLE TEXT AND NOT BOOLEANS. property.hazard_power_lines
-- is a boolean defaulting to FALSE, which means "no power lines here" and
-- "nobody has looked yet" are stored as the same value. On a crew-safety
-- field that is the §1B failure exactly. These new columns are nullable so
-- NULL means "not recorded" and can never be read as "not present" — and
-- power_lines_checked_at gives the existing boolean the same honesty without
-- changing its meaning or breaking anything that reads it.

alter table property
  add column if not exists water_meter_location  text,
  add column if not exists water_meter_path_note text,
  -- Null until somebody actually looked. Then the boolean above means
  -- something; before that it is a default, not an observation.
  add column if not exists power_lines_checked_at timestamptz,
  add column if not exists site_features_note     text;

comment on column property.water_meter_location is
  'Where the meter cap is, in plain words. NULL = not recorded, never "no meter".';
comment on column property.water_meter_path_note is
  'How to find the run from the cap. NULL = not recorded.';
comment on column property.power_lines_checked_at is
  'When somebody actually checked for power lines. NULL means hazard_power_lines=false is a DEFAULT, not an observation.';
