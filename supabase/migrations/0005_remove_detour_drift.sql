-- Remove the parked generic-CRM detour's drift objects (D26 — approved by
-- Mike 2026-08-01). Roll-forward migration: history stays append-only, no
-- surgical edits to schema_migrations. The two detour migration rows
-- (app_support, estimate_calendar) remain in the DB's history as a record of
-- what happened; every drop here is `if exists`, so replaying 0001→0005 on a
-- fresh database (without the detour rows) produces the identical schema.
--
-- NOT dropped: estimate.calendar_event_id — legitimized by migration 0004
-- (Sage won-recolor, D36). job.calendar_event_id was always legitimate (0001).

drop table if exists app_activity;
drop table if exists app_admins;
drop table if exists app_settings;

alter table lead drop column if exists external_id;
