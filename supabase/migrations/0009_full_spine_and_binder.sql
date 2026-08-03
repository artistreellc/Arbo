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
-- Arbo full data spine + the binder (live brief §7 entities 12–27, §8A.6, §4.6,
-- §4.8, §6E2.4, §6J2.4, §8C groundwork). Same access model as 0001: RLS enabled
-- on every table with NO anon/authenticated policies — service role only.
-- Legal gates are encoded as constraints/triggers wherever the database can
-- carry the law itself; everything else is enforced by the policy engine.

-- ===========================================================================
-- §7 #12 CREW MEMBER
-- ===========================================================================
create table if not exists crew_member (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  role             text not null default 'groundie',
  hire_date        date,
  languages        text[] not null default '{}',
  phone            text,
  competency_level int not null default 1,
  -- per-man weak/strong topics (6M.5) — admin-only by RLS posture
  training_profile jsonb not null default '{}'::jsonb,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ===========================================================================
-- §7 #13 CERTIFICATION — expiry nudges BEFORE lapse (6M.9)
-- ===========================================================================
create table if not exists certification (
  id             uuid primary key default gen_random_uuid(),
  crew_member_id uuid not null references crew_member(id) on delete cascade,
  type           text not null check (type in ('first_aid','cpr','aerial_rescue','tree_rescue','cdl','other')),
  issued_at      date,
  expires_at     date,
  document_file  text,
  nudge_state    text not null default 'none' check (nudge_state in ('none','upcoming','urgent','lapsed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists certification_expiry_idx on certification (expires_at);

-- ===========================================================================
-- §4.6 TIME ENTRY — training/quiz time is COMPENSABLE. Every gate completion
-- writes one of these. Payable by design; never docked.
-- ===========================================================================
create table if not exists time_entry (
  id             uuid primary key default gen_random_uuid(),
  crew_member_id uuid not null references crew_member(id) on delete cascade,
  kind           text not null check (kind in ('training','work','briefing')),
  started_at     timestamptz not null,
  ended_at       timestamptz,
  minutes        numeric(8,2),
  payable        boolean not null default true,
  source         text,                    -- e.g. 'clock_in_gate','friday_questionnaire'
  created_at     timestamptz not null default now()
);
create index if not exists time_entry_crew_idx on time_entry (crew_member_id, started_at);

-- ===========================================================================
-- §7 #14 TRAINING ITEM — every piece of teachable content. §4.7: nothing
-- publishes unvetted (published requires vetted_by/vetted_at — CHECK below).
-- Near-miss-derived items are excluded from the individual's scored record
-- (blameless loop, 6M.10) — trigger forces the flag.
-- ===========================================================================
create table if not exists training_item (
  id                   uuid primary key default gen_random_uuid(),
  type                 text not null check (type in ('quiz_question','lesson','reference_entry','tailgate_brief')),
  topic                text not null,
  body                 jsonb not null,     -- question/options/answer or lesson body
  difficulty           int not null default 1,
  source               text not null,      -- 'z133','vosha_packet','mike_capture','event_generated'
  origin_near_miss_id  uuid,               -- set when generated from a near miss
  exclude_from_scoring boolean not null default false,
  vetted_by            text,
  vetted_at            timestamptz,
  published            boolean not null default false,
  version              int not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- §4.7 life-safety vetting: cannot publish without a named human vetter.
  constraint training_item_vetted_before_publish
    check (published = false or (vetted_by is not null and vetted_at is not null))
);

create or replace function arbor_training_item_blameless()
returns trigger language plpgsql
security definer set search_path = public
as $$
begin
  if new.origin_near_miss_id is not null then
    new.exclude_from_scoring := true;   -- blameless: near-miss lessons never score a man
  end if;
  return new;
end; $$;
drop trigger if exists training_item_blameless on training_item;
create trigger training_item_blameless
  before insert or update on training_item
  for each row execute function arbor_training_item_blameless();

-- ===========================================================================
-- §7 #15 TRAINING EVENT — an attempt/completion. Carries its payable time
-- entry (§4.6). Context enumerates the real gates.
-- ===========================================================================
create table if not exists training_event (
  id             uuid primary key default gen_random_uuid(),
  crew_member_id uuid not null references crew_member(id) on delete cascade,
  item_ids       uuid[] not null default '{}',
  context        text not null check (context in ('clock_in_gate','clock_out_gate','friday_questionnaire','tailgate_ack','micro_lesson')),
  answers        jsonb,
  score          numeric(5,2),
  started_at     timestamptz not null,
  completed_at   timestamptz,
  time_entry_id  uuid references time_entry(id),
  created_at     timestamptz not null default now()
);
create index if not exists training_event_crew_idx on training_event (crew_member_id, started_at);

-- ===========================================================================
-- §7 #16 NEAR MISS / INCIDENT — blameless by design (6M.10).
-- ===========================================================================
create table if not exists near_miss (
  id                          uuid primary key default gen_random_uuid(),
  reported_by                 uuid references crew_member(id),
  job_id                      uuid references job(id),
  occurred_on                 date not null default current_date,
  description                 text not null,
  hazard_category             text,
  generated_training_item_id  uuid references training_item(id),
  blameless                   boolean not null default true,
  created_at                  timestamptz not null default now()
);

-- ===========================================================================
-- §7 #17 REFERENCE ENTRY — the Field Reference Library (6M.12): how-to +
-- pros/cons + "won't work when". Standards cited by clause, never reproduced.
-- ===========================================================================
create table if not exists reference_entry (
  id             uuid primary key default gen_random_uuid(),
  technique_name text not null,
  skill_level    int not null default 1,
  how_to         text not null,
  pros           text[] not null default '{}',
  cons           text[] not null default '{}',
  wont_work_when text,
  source_link    text,
  standard_refs  text[] not null default '{}',  -- clause citations only (6U.3)
  vetted_by      text,
  vetted_at      timestamptz,
  published      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint reference_entry_vetted_before_publish
    check (published = false or (vetted_by is not null and vetted_at is not null))
);

-- ===========================================================================
-- §7 #18 NEIGHBORHOOD / AREA + #19 AREA PERFORMANCE (6N). Internal only.
-- ===========================================================================
create table if not exists neighborhood_area (
  id                   uuid primary key default gen_random_uuid(),
  area_key             text not null unique,          -- normalized area key
  street_segment       text,
  city                 text not null check (city in ('Virginia Beach','Norfolk','Chesapeake','Portsmouth')),
  avg_household_income numeric(12,2),
  canopy_pct           numeric(5,2),
  lot_characteristics  jsonb not null default '{}'::jsonb,
  data_source          text,
  refreshed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists area_performance (
  id                   uuid primary key default gen_random_uuid(),
  area_id              uuid not null references neighborhood_area(id) on delete cascade,
  period_start         date not null,
  period_end           date not null,
  job_ids              uuid[] not null default '{}',
  quoted_total         numeric(12,2),
  actual_total         numeric(12,2),
  margin               numeric(12,2),
  -- 6N.3 analytical guardrail: rate AFTER controlling for job factors —
  -- never a naive average. The normalization inputs ride along for audit.
  normalized_rate      numeric(10,2),
  normalization_inputs jsonb not null default '{}'::jsonb,
  underbid_delta       numeric(10,2),
  created_at           timestamptz not null default now()
);

-- ===========================================================================
-- §7 #20 BEHAVIOR PROFILE (6P) — how a lead BUYS. Admin-only; never surfaces
-- to a customer, never changes price or treatment.
-- ===========================================================================
create table if not exists behavior_profile (
  id                uuid primary key default gen_random_uuid(),
  contact_id        uuid not null references contact(id) on delete cascade,
  urgency_signal    text,
  price_sensitivity text,
  decisiveness      text,
  responsiveness    text,
  derived_segment   text,
  outcomes          jsonb not null default '{}'::jsonb,  -- booked/upsell/margin/payment_ease/hassle
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ===========================================================================
-- §7 #21 CAMPAIGN + #22 KEYWORD/PHRASE (6O). Cost per BOOKED JOB, not per lead.
-- ===========================================================================
create table if not exists campaign (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null check (type in ('flyer','ads','seasonal','neighbor_around_job')),
  target_areas        uuid[] not null default '{}',
  tracking_number     text,
  cost                numeric(12,2),
  sent_at             timestamptz,
  attributed_lead_ids uuid[] not null default '{}',
  cost_per_booked_job numeric(12,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists keyword_phrase (
  id             uuid primary key default gen_random_uuid(),
  phrase         text not null,
  frequency      int not null default 1,
  source_channel text,
  intent_tag     text,
  converted      boolean,
  negative_flag  boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ===========================================================================
-- §7 #23 SITE CONDITION RECORD (6Q.1 liability armor) — documented BEFORE work.
-- ===========================================================================
create table if not exists site_condition_record (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references job(id) on delete cascade,
  arrival_timestamp  timestamptz not null,
  photo_files        text[] not null default '{}',
  preexisting_notes  text,
  ground_condition   text,
  crane_decision     text,
  documented_by      text,
  created_at         timestamptz not null default now()
);

-- ===========================================================================
-- §7 #24 CHANGE ORDER (6Q.3) — verbal add-ons logged the moment agreed.
-- ===========================================================================
create table if not exists change_order (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references job(id) on delete cascade,
  description text not null,
  amount      numeric(12,2),
  agreed_at   timestamptz not null default now(),
  agreed_by   text,
  approved    boolean not null default false,
  invoiced    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ===========================================================================
-- 6E EQUIPMENT UNIT (VIN/serial-keyed fleet) + 6E2 TOOL (separate inventory —
-- "two inventories, never merged") + shared MAINTENANCE TASK with the 6E2.4
-- law: closing requires a PHOTO, never a checkbox (CHECK constraint).
-- 7A names Equipment Unit as a core object; §7 #25 conflated them — built here
-- as the features actually require.
-- ===========================================================================
create table if not exists equipment_unit (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  kind           text not null,            -- chip truck / grapple / crane / chipper / ...
  vin_or_serial  text not null unique,
  make           text,
  model          text,
  year           int,
  status         text not null default 'up' check (status in ('up','down','maintenance','retired')),
  -- 6M2.4 truck-aware routing profiles (safety-critical; null = unknown → conservative)
  height_inches  int,
  weight_lbs_empty  int,
  weight_lbs_loaded int,
  length_inches  int,
  docs           jsonb not null default '{}'::jsonb,   -- registration/insurance/manual refs
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists equipment_part (
  id             uuid primary key default gen_random_uuid(),
  unit_id        uuid not null references equipment_unit(id) on delete cascade,
  part_number    text not null,
  cross_refs     text[] not null default '{}',
  supplier       text,
  last_price     numeric(10,2),
  shared_fitment text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists tool (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'hand' check (category in ('hand','power','rigging')),
  serial        text,
  status        text not null default 'up' check (status in ('up','down','retired')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists maintenance_task (
  id               uuid primary key default gen_random_uuid(),
  unit_id          uuid references equipment_unit(id) on delete cascade,
  tool_id          uuid references tool(id) on delete cascade,
  description      text not null,
  cycle            text,                    -- mileage/hours/date rule, human-readable
  due_at           timestamptz,
  status           text not null default 'open' check (status in ('open','done','skipped')),
  proof_photo_file text,
  completed_by     text,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- exactly one owner: a unit task or a tool task
  constraint maintenance_task_one_owner check (num_nonnulls(unit_id, tool_id) = 1),
  -- §6E2.4 LAW: a task cannot close without photo proof. Never a checkbox.
  constraint maintenance_task_photo_proof
    check (status <> 'done' or proof_photo_file is not null)
);
create index if not exists maintenance_task_due_idx on maintenance_task (status, due_at);

-- ===========================================================================
-- 6J2.4 LEAKAGE EVENT — every unplanned repair/damage, split by cause. Feeds
-- the continuously re-derived bid load (never a fixed markup).
-- ===========================================================================
create table if not exists leakage_event (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references job(id),
  unit_id     uuid references equipment_unit(id),
  kind        text not null check (kind in ('equipment_repair','property_damage')),
  cause       text,
  cost        numeric(12,2) not null,
  occurred_on date not null default current_date,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists leakage_event_date_idx on leakage_event (occurred_on);

-- ===========================================================================
-- 6F WORK ORDER — the crew-facing job sheet (admin data structurally excluded:
-- the payload is BUILT crew-safe; nothing admin-priced is ever written here).
-- ===========================================================================
create table if not exists work_order (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references job(id) on delete cascade,
  route_order  int,
  crew_payload jsonb not null default '{}'::jsonb,  -- address/scope/photos/safety brief ONLY
  pushed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ===========================================================================
-- §4.8 INVOICE — late fee is structurally capped at the VA-safe 5%.
-- ===========================================================================
create table if not exists invoice (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references job(id) on delete cascade,
  amount       numeric(12,2) not null,
  surcharge_pct numeric(4,2) not null default 0,
  late_fee_pct numeric(4,2) not null default 5.00,
  status       text not null default 'draft' check (status in ('draft','sent','paid','overdue','void')),
  sent_at      timestamptz,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- §4.8: never above 5% (the 20% paper-terms figure is unlawful to charge)
  constraint invoice_late_fee_va_cap check (late_fee_pct <= 5.00)
);

-- ===========================================================================
-- §8C GROUNDWORK — app_user: role on the user, extensible. RLS policies that
-- make "admin-only" real arrive with the auth wiring; service-role-only until.
-- ===========================================================================
create table if not exists app_user (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique,               -- links to auth.users when 8C wires up
  role           text not null default 'crew' check (role in ('admin','crew')),
  crew_member_id uuid references crew_member(id),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ===========================================================================
-- §8A.6b THE EVENT BUS — the durable spine. Agents do not talk to each other;
-- they share state and events (8A.1). bigserial gives strict ordering;
-- consumers track their own cursor (no delivery framework — deliberately boring).
-- ===========================================================================
create table if not exists event (
  seq        bigserial primary key,
  id         uuid not null default gen_random_uuid() unique,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  source     text not null,                 -- which module/agent emitted
  emitted_at timestamptz not null default now()
);
create index if not exists event_type_idx on event (type, seq);

create table if not exists event_cursor (
  consumer   text primary key,
  last_seq   bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- §7 #26 / §8A.6g AGENT RUN — the audit log of every agent decision.
-- ===========================================================================
create table if not exists agent_run (
  id             uuid primary key default gen_random_uuid(),
  agent          text not null,
  trigger_event  uuid references event(id),
  model_used     text,
  prompt_version text,
  tools_called   jsonb not null default '[]'::jsonb,
  policy_blocks  jsonb not null default '[]'::jsonb,
  output_summary text,
  status         text not null default 'running' check (status in ('running','ok','error','blocked')),
  duration_ms    int,
  cost_usd       numeric(10,6),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists agent_run_agent_idx on agent_run (agent, started_at);

-- ===========================================================================
-- Touch triggers + RLS (service-role only, same as the whole spine).
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'crew_member','certification','time_entry','training_item','training_event',
    'near_miss','reference_entry','neighborhood_area','area_performance',
    'behavior_profile','campaign','keyword_phrase','site_condition_record',
    'change_order','equipment_unit','equipment_part','tool','maintenance_task',
    'leakage_event','work_order','invoice','app_user','event','event_cursor','agent_run'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'crew_member','certification','training_item','reference_entry',
    'neighborhood_area','behavior_profile','campaign','keyword_phrase',
    'equipment_unit','equipment_part','tool','maintenance_task','work_order',
    'invoice','app_user'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format(
      'create trigger %I before update on %I for each row execute function arbor_touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;
