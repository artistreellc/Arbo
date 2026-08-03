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
