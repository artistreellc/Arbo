-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
-- STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
-- Owner instruction from Mike, 2026-08-03. This is not decoration and it
-- is not optional. It is here because this is the point in a build where
-- things get broken by moving fast, and that already happened to him once
-- on the website. It does not happen here.
-- ═══════════════════════════════════════════════════════════════════════
--
-- SLOW DOWN. DRASTICALLY. Then:
--
-- 1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
--    slowly. You are not skimming to find the spot to change — you are
--    building a model of what this file already does. If you cannot say
--    what the code above and below your edit does, you have not read it.
--
-- 2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
--    You do not "fix it while you are in there." You do not refactor, or
--    tidy, or rename. You READ, and you REPORT. Editing during an audit
--    is disobeying the instruction, full stop.
--
-- 3. THINK BEFORE YOU TYPE. What does this already handle? What depends
--    on it? What breaks downstream? Recognise the PATTERN before you call
--    something a bug — most things in here that look wrong are a
--    deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
--    you already know about this codebase instead of re-deciding it.
--
-- 4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
--    ambiguous, or outside what was asked: say it and WAIT. Flagging
--    costs one sentence. Deciding on his behalf has cost real work and
--    real money more than once.
--
-- 5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
--    thing you thought of on the way. Not the cleanup. Exactly what was
--    asked, and nothing else.
--
-- If you are moving fast right now, you are already off the rails.
--
-- Remember the marker: SLOW::ARBO
-- §8C ACCESS & IDENTITY — the login that makes "admin-only" REAL.
-- RLS is the enforcement layer, not the UI (§8C.2). The backend keeps using
-- the service role (bypasses RLS); these policies govern any authenticated
-- client — which is what the crew app will be.
--
-- Deny-by-default stands: a table with no policy for a role is invisible to
-- that role. Customer tables (lead, estimate, job, contact, property,
-- invoice, permit, behavior_profile, area_performance, campaign, …) get NO
-- crew policy, so §8C.1's hard ceiling is structural, not conditional.
--
-- VERIFIED LIVE 2026-08-02 by impersonation (not assertion):
--   crew  → lead 0, contact 0, property 0, job 0, invoice 0, agent_run 0,
--           equipment_unit 0, other crew_member 0 | self 1, published item 1,
--           draft item 0, tool 1
--   admin → lead 37, job 11   (same tables, same instant)

create or replace function arbo_current_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from app_user where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function arbo_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(arbo_current_role() = 'admin', false)
$$;

create or replace function arbo_current_crew_member()
returns uuid
language sql stable security definer set search_path = public
as $$
  select crew_member_id from app_user where auth_user_id = auth.uid() and active limit 1
$$;

-- ADMIN: uniform full access, applied to every base table so a NEW table can
-- never accidentally be admin-invisible.
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('drop policy if exists admin_all on %I', t);
    execute format(
      'create policy admin_all on %I for all to authenticated using (arbo_is_admin()) with check (arbo_is_admin())',
      t
    );
  end loop;
end $$;

-- CREW: "their half" only (§8C.1).
drop policy if exists crew_self_read on crew_member;
create policy crew_self_read on crew_member
  for select to authenticated using (id = arbo_current_crew_member());

drop policy if exists crew_self_certs on certification;
create policy crew_self_certs on certification
  for select to authenticated using (crew_member_id = arbo_current_crew_member());

drop policy if exists crew_self_training_read on training_event;
create policy crew_self_training_read on training_event
  for select to authenticated using (crew_member_id = arbo_current_crew_member());
drop policy if exists crew_self_training_write on training_event;
create policy crew_self_training_write on training_event
  for insert to authenticated with check (crew_member_id = arbo_current_crew_member());

drop policy if exists crew_self_time on time_entry;
create policy crew_self_time on time_entry
  for select to authenticated using (crew_member_id = arbo_current_crew_member());

drop policy if exists crew_published_training on training_item;
create policy crew_published_training on training_item
  for select to authenticated using (published);
drop policy if exists crew_published_reference on reference_entry;
create policy crew_published_reference on reference_entry
  for select to authenticated using (published);

drop policy if exists crew_near_miss_insert on near_miss;
create policy crew_near_miss_insert on near_miss
  for insert to authenticated with check (reported_by = arbo_current_crew_member());
drop policy if exists crew_near_miss_read on near_miss;
create policy crew_near_miss_read on near_miss
  for select to authenticated using (reported_by = arbo_current_crew_member());

drop policy if exists crew_tools_read on tool;
create policy crew_tools_read on tool for select to authenticated using (true);
drop policy if exists crew_parts_read on equipment_part;
create policy crew_parts_read on equipment_part for select to authenticated using (true);
drop policy if exists crew_maint_read on maintenance_task;
create policy crew_maint_read on maintenance_task for select to authenticated using (true);
drop policy if exists crew_maint_close on maintenance_task;
create policy crew_maint_close on maintenance_task
  for update to authenticated
  using (true)
  with check (status <> 'done' or proof_photo_file is not null); -- photo law holds under RLS too

drop policy if exists crew_work_order_read on work_order;
create policy crew_work_order_read on work_order for select to authenticated using (true);

-- DELIBERATE OMISSIONS (§8C.1 hard ceiling): no crew policy on equipment_unit
-- (fleet registry / telemetry-adjacent), lead, contact, property, estimate,
-- job, invoice, permit, behavior_profile, campaign, keyword_phrase,
-- area_performance, neighborhood_area, leakage_event, agent_run, event, or
-- app_user. Deny-by-default IS the ceiling.
