-- Review finding (cycle 4): five crew policies in 0010 were `using (true)`,
-- which in Supabase means EVERY `authenticated` principal — including a
-- DEACTIVATED crew member whose JWT is still valid, and any signed-up account
-- with no app_user row. Deactivation is the schema's revocation mechanism
-- (both identity helpers filter on `active`), so those policies ignored it.
--
-- VERIFIED LIVE 2026-08-02 after this migration, by impersonation:
--   deactivated crew → tool 0, work_order 0, equipment_part 0, maintenance_task 0
--   active crew      → tool 1, work_order 1

create or replace function arbo_is_active_crew()
returns boolean
language sql stable security definer set search_path = public
as $$
  select arbo_current_crew_member() is not null
$$;

drop policy if exists crew_tools_read on tool;
create policy crew_tools_read on tool
  for select to authenticated using (arbo_is_active_crew());

drop policy if exists crew_parts_read on equipment_part;
create policy crew_parts_read on equipment_part
  for select to authenticated using (arbo_is_active_crew());

drop policy if exists crew_maint_read on maintenance_task;
create policy crew_maint_read on maintenance_task
  for select to authenticated using (arbo_is_active_crew());

drop policy if exists crew_maint_close on maintenance_task;
create policy crew_maint_close on maintenance_task
  for update to authenticated
  using (arbo_is_active_crew())
  with check (arbo_is_active_crew() and (status <> 'done' or proof_photo_file is not null));

drop policy if exists crew_work_order_read on work_order;
create policy crew_work_order_read on work_order
  for select to authenticated using (arbo_is_active_crew());

-- Briefing acknowledgment idempotency: the ack writes a payable time entry and
-- a training event non-atomically, so a retry on flaky field signal could mint
-- duplicate PAID rows. One ack per crew member per start instant per source.
create unique index if not exists time_entry_ack_once
  on time_entry (crew_member_id, source, started_at)
  where source is not null;
