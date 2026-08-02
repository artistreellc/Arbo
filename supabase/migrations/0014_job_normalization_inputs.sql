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
