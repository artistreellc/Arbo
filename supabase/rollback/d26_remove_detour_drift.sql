-- D26 drift rollback (DECISIONS.md). Removes the two detour migrations'
-- objects from the live `arbor` project, restoring exact parity with
-- supabase/migrations/. DESTRUCTIVE — run only with Mike's approval.
--
-- Approved by Mike ("do it all", 2026-08-01); execution from the build
-- environment was blocked by tooling policy, so run this by hand:
-- Supabase Dashboard → arbor project → SQL Editor → paste → Run.
--
-- Safety notes:
--   * Verified 2026-08-01: no code in this repo references any of these
--     objects (grep for app_settings / app_admins / app_activity /
--     external_id — zero hits).
--   * job.calendar_event_id is legitimate (migration 0001) and is NOT touched.
--   * estimate.calendar_event_id is NOT dropped: originally detour drift, it
--     became legitimate via migration 0004 (Sage won-recolor, D36). Its drift
--     migration ROW is still deleted below; 0004 is its proper provenance.
--   * app_settings had 1 row, app_admins 1 row, app_activity 0 rows as of
--     2026-08-01 — detour seed data, nothing production.

begin;

drop table if exists app_activity;
drop table if exists app_admins;
drop table if exists app_settings;

alter table lead drop column if exists external_id;

delete from supabase_migrations.schema_migrations
 where name in ('app_support', 'estimate_calendar');

commit;

-- Expected after running: supabase_migrations.schema_migrations lists exactly
-- data_spine, harden_function_search_path, permit, estimate_calendar_event.
