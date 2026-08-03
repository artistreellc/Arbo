-- ═══════════════════════════════════════════════════════════════════════
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
-- =============================================================================
-- 0014 — §6N.3 normalization inputs on the job.
--
-- The area-performance table (0009) carries a `normalized_rate` column and a
-- comment demanding a rate computed "AFTER controlling for job factors — never
-- a naive average". The factors themselves had nowhere to live, so any area
-- comparison would have collapsed back into revenue-per-job, which rewards job
-- MIX rather than how well work was priced and run: a neighbourhood of large
-- removals beats a neighbourhood of small prunings no matter who did better.
--
-- hours × crew_size gives the crew-hours denominator that makes areas
-- comparable. NULL hours are excluded from the benchmark AND counted in the
-- report — never silently treated as zero (§1B).
-- =============================================================================

alter table job add column if not exists truck_to_truck_hours numeric(6,2);
alter table job add column if not exists crew_size int;
alter table job add column if not exists job_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_type_known') then
    alter table job add constraint job_type_known
      check (job_type is null or job_type in ('removal','pruning','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_hours_sane') then
    alter table job add constraint job_hours_sane
      check (truck_to_truck_hours is null or (truck_to_truck_hours > 0 and truck_to_truck_hours <= 24));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_crew_size_sane') then
    alter table job add constraint job_crew_size_sane
      check (crew_size is null or (crew_size >= 1 and crew_size <= 20));
  end if;
end $$;

comment on column job.truck_to_truck_hours is
  'Actual truck-to-truck hours (§6J2). Null = not recorded; the area report EXCLUDES and counts these rather than treating them as zero.';
comment on column job.crew_size is
  'Crew on the job. With hours, gives the crew-hours denominator that normalizes an area rate (§6N.3).';
