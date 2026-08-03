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
-- ARBOR data spine (brief §7). The clean model everything hangs off of.
-- Access model (§4.3): RLS enabled on every table with NO anon/authenticated
-- policies — only the service role (used by the ARBOR backend) can touch these.
-- Customer PII is never exposed to a public key.
--
-- Service area is enforced in the DATABASE: a CHECK constraint makes it
-- structurally impossible to store a property outside the four served cities
-- (Suffolk can never be inserted). Brief §2, §12.

create extension if not exists pgcrypto;

-- Reusable updated_at trigger.
create or replace function arbor_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ===========================================================================
-- PROPERTY — the twin, keyed by a normalized address so one property can never
-- become two twins (§12 address-matching risk).
-- ===========================================================================
create table if not exists property (
  id                  uuid primary key default gen_random_uuid(),
  address             text not null,                 -- as given / displayed
  normalized_address  text not null unique,          -- dedupe key (app-normalized)
  city                text not null,
  zip                 text,                          -- drives clustering (§5 #10)
  geo_lat             double precision,
  geo_lng             double precision,
  lot_notes           text,
  hazard_power_lines  boolean not null default false,
  hazard_structures   boolean not null default false,
  drive_folder_id     text,                          -- per-property Drive folder (§7 convention)
  first_seen          timestamptz not null default now(),
  last_serviced       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Service area is EXACTLY the four cities. Suffolk (or anything else) is rejected.
  constraint property_city_in_service_area
    check (city in ('Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth'))
);
create index if not exists property_zip_idx on property (zip);
create index if not exists property_city_idx on property (city);

-- ===========================================================================
-- CONTACT / CUSTOMER — people. Consent is a first-class, timestamped record
-- (§4.1). first_timer vs repeat drives how the AI talks (§3.2).
-- ===========================================================================
create table if not exists contact (
  id             uuid primary key default gen_random_uuid(),
  name           text,
  phones         text[] not null default '{}',
  emails         text[] not null default '{}',
  is_first_timer boolean not null default true,
  -- Consent (§4.1): captured when they call in / book. Opt-out is permanent.
  consent_source text,                               -- e.g. 'inbound_call','booked_estimate'
  consent_at     timestamptz,
  opted_out      boolean not null default false,
  opted_out_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists contact_phones_idx on contact using gin (phones);
create index if not exists contact_emails_idx on contact using gin (emails);

-- A contact can be linked to many properties and vice-versa (§7 linked[]).
create table if not exists contact_property (
  contact_id  uuid not null references contact(id) on delete cascade,
  property_id uuid not null references property(id) on delete cascade,
  role        text default 'owner',
  primary key (contact_id, property_id)
);

-- Global suppression list (§4.1): STOP honored permanently & system-wide.
create table if not exists suppression (
  id           uuid primary key default gen_random_uuid(),
  phone        text unique,
  email        text unique,
  reason       text not null default 'STOP',
  created_at   timestamptz not null default now()
);

-- ===========================================================================
-- TREE — child of Property. next_due_forecast is populated in Phase 8; the
-- column exists NOW so data is captured cleanly from day one (§6 build note).
-- ===========================================================================
create table if not exists tree (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references property(id) on delete cascade,
  species           text,
  size              text,
  location_on_lot   text,
  condition_notes   text,
  last_service_date date,
  next_due_forecast date,                            -- Phase 8 (predictive)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists tree_property_idx on tree (property_id);

-- ===========================================================================
-- LEAD — every inbound inquiry, any channel.
-- ===========================================================================
create table if not exists lead (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid references property(id) on delete set null,
  contact_id     uuid references contact(id) on delete set null,
  source         text not null default 'call'
                   check (source in ('call','text','email','photo','other')),
  details        text,
  qualification  jsonb,                              -- tree type/size, proximity, power lines…
  is_emergency   boolean not null default false,
  status         text not null default 'new'
                   check (status in ('new','qualified','emergency','converted','lost','spam')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists lead_status_idx on lead (status, created_at desc);

-- ===========================================================================
-- ESTIMATE — the scheduled in-person look. ZIP cluster tag drives routing.
-- ===========================================================================
create table if not exists estimate (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references property(id) on delete cascade,
  contact_id     uuid references contact(id) on delete set null,
  lead_id        uuid references lead(id) on delete set null,
  scheduled_slot timestamptz,
  zip_cluster    text,                               -- routing tag (§5 #10)
  visited        boolean,                            -- from geofence (§5 #21, Phase 6)
  outcome        text check (outcome in ('pending','won','lost','no_show')) default 'pending',
  follow_up_state text default 'none',               -- drives §5 #16 follow-ups
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists estimate_slot_idx on estimate (scheduled_slot);
create index if not exists estimate_zip_cluster_idx on estimate (zip_cluster);

-- ===========================================================================
-- JOB — booked work, tied to a Google Calendar event + color (§5 #9).
-- ===========================================================================
create table if not exists job (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references property(id) on delete cascade,
  contact_id        uuid references contact(id) on delete set null,
  estimate_id       uuid references estimate(id) on delete set null,
  calendar_event_id text,
  color_code        text,                            -- matches Mike's color-coding
  crew              text,
  materials         text,
  status            text not null default 'booked'
                      check (status in ('booked','in_progress','completed','paid','cancelled')),
  scheduled_for     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists job_status_idx on job (status);

-- ===========================================================================
-- CONTRACT — a signed-contract photo is a RECORD (not an e-signature, §4.5).
-- Its arrival converts an Estimate into a booked Job (§5 #14).
-- ===========================================================================
create table if not exists contract (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references property(id) on delete cascade,
  estimate_id   uuid references estimate(id) on delete set null,
  job_id        uuid references job(id) on delete set null,
  signed        boolean not null default false,
  drive_file_id text,                                -- Signed Contracts/ folder
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ===========================================================================
-- PHOTO — customer- or Mike-sent, linked to Job and/or Property (§5 #15).
-- ===========================================================================
create table if not exists photo (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references property(id) on delete cascade,
  job_id        uuid references job(id) on delete set null,
  source        text not null default 'customer'
                  check (source in ('customer','mike')),
  drive_file_id text,
  taken_at      timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists photo_property_idx on photo (property_id);

-- ===========================================================================
-- MESSAGE LOG — every text/email. Records that the legal gate ran (§4.1) so we
-- can prove consent + quiet-hours were checked before any outbound send.
-- ===========================================================================
create table if not exists message_log (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid references contact(id) on delete set null,
  channel            text not null check (channel in ('sms','email')),
  direction          text not null check (direction in ('inbound','outbound')),
  body               text,
  consent_checked    boolean,                        -- outbound gate result (§4.1)
  quiet_hours_checked boolean,
  created_at         timestamptz not null default now()
);
create index if not exists message_log_contact_idx on message_log (contact_id, created_at desc);

-- ===========================================================================
-- CALL LOG — feeds the human-in-the-loop review (§13). Guardrail flags let the
-- analyst spot where the AI stumbled.
-- ===========================================================================
create table if not exists call_log (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references contact(id) on delete set null,
  lead_id         uuid references lead(id) on delete set null,
  transcript      text,
  intent          text,
  outcome         text,
  guardrail_flags jsonb,
  created_at      timestamptz not null default now()
);

-- ===========================================================================
-- CLIENT MASTER DATABASE — the index that ties Drive files back to records
-- (§7). One row per filed artifact.
-- ===========================================================================
create table if not exists client_master_index (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references property(id) on delete cascade,
  entity_type   text not null check (entity_type in ('estimate','contract','photo','document')),
  entity_id     uuid,
  drive_file_id text,
  drive_folder  text,                                -- Estimates/ | Signed Contracts/ | Job Photos/ | Documents/
  created_at    timestamptz not null default now()
);
create index if not exists client_master_property_idx on client_master_index (property_id);

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['property','contact','tree','lead','estimate','job','contract']
  loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
       for each row execute function arbor_touch_updated_at();', t);
  end loop;
end $$;

-- ===========================================================================
-- Row Level Security: lock every table down (service role bypasses; no other
-- role gets a policy, so anon/authenticated are denied by default). §4.3.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['property','contact','contact_property','suppression','tree','lead',
                           'estimate','job','contract','photo','message_log','call_log','client_master_index']
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;
