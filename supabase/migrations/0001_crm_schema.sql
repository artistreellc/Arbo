-- Arbo CRM — core schema
-- ---------------------------------------------------------------------------
-- A dedicated CRM for the tree service, kept in its own `crm_`-prefixed tables.
--
-- Access model: the browser app NEVER talks to these tables with the public
-- anon key. All reads/writes go through the /api/crm/* serverless functions
-- using the SERVICE ROLE key, so customer PII is never exposed to the client.
-- RLS is therefore enabled with NO anon/authenticated policies — the service
-- role bypasses RLS, everyone else is denied by default. Admin identity is
-- enforced in the API layer against the crm_admins allowlist (see 0002).
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- Reusable "touch updated_at" trigger function.
create or replace function crm_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contacts — a person/property owner. One contact can have many jobs.
-- ---------------------------------------------------------------------------
create table if not exists crm_contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  email         text,
  phone         text,
  address       text,
  city          text,
  notes         text,
  tags          text[] default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists crm_contacts_phone_idx on crm_contacts (phone);
create index if not exists crm_contacts_email_idx on crm_contacts (email);

-- ---------------------------------------------------------------------------
-- Leads — every inbound inquiry, from any channel, lands here first.
-- ---------------------------------------------------------------------------
create table if not exists crm_leads (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references crm_contacts(id) on delete set null,
  name            text,
  email           text,
  phone           text,
  address         text,
  service_needed  text,
  message         text,
  urgency         text,                        -- emergency | soon | flexible
  -- website_form | phone | gmail | receptionist | google | facebook | referral | manual | other
  source          text not null default 'other',
  source_detail   text,                        -- free text (campaign, caller id, thread id…)
  external_id     text,                        -- provider id for dedup (e.g. gmail message id)
  -- Inbox workflow: new | contacted | qualified | converted | archived | spam
  status          text not null default 'new',
  raw             jsonb,                        -- original payload for auditing
  job_id          uuid,                         -- set once converted into a job
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists crm_leads_status_idx on crm_leads (status, created_at desc);
create index if not exists crm_leads_source_idx on crm_leads (source);
-- Dedup guard for channel syncs (Gmail, etc). Partial so multiple NULLs are fine.
create unique index if not exists crm_leads_external_id_idx
  on crm_leads (source, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- Jobs — the pipeline. A lead becomes a job once you decide to work it.
-- ---------------------------------------------------------------------------
create table if not exists crm_jobs (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references crm_contacts(id) on delete set null,
  lead_id         uuid references crm_leads(id) on delete set null,
  title           text,
  service_type    text,
  description      text,
  address         text,
  stage           text not null default 'new',
  estimate_amount numeric(10,2),
  final_amount    numeric(10,2),
  scheduled_for   timestamptz,
  priority        text default 'normal',        -- emergency | high | normal | low
  lost_reason     text,
  position        int default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists crm_jobs_stage_idx on crm_jobs (stage, position);
create index if not exists crm_jobs_contact_idx on crm_jobs (contact_id);

alter table crm_leads
  drop constraint if exists crm_leads_job_id_fkey,
  add constraint crm_leads_job_id_fkey
    foreign key (job_id) references crm_jobs(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Activities — the timeline.
-- ---------------------------------------------------------------------------
create table if not exists crm_activities (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid references crm_contacts(id) on delete cascade,
  job_id       uuid references crm_jobs(id) on delete cascade,
  lead_id      uuid references crm_leads(id) on delete cascade,
  -- note | call | email | sms | stage_change | appointment | receptionist
  type         text not null default 'note',
  direction    text,                            -- inbound | outbound | null
  subject      text,
  body         text,
  meta         jsonb,
  created_by   text default 'system',
  created_at   timestamptz not null default now()
);
create index if not exists crm_activities_job_idx on crm_activities (job_id, created_at desc);
create index if not exists crm_activities_contact_idx on crm_activities (contact_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Appointments — estimates & scheduled jobs; mirrors to Google Calendar.
-- ---------------------------------------------------------------------------
create table if not exists crm_appointments (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid references crm_jobs(id) on delete cascade,
  contact_id         uuid references crm_contacts(id) on delete set null,
  kind               text not null default 'estimate',  -- estimate | job | follow_up
  title              text,
  location           text,
  starts_at          timestamptz not null,
  ends_at            timestamptz,
  notes              text,
  google_event_id    text,                      -- set once synced to Google Calendar
  sync_status        text default 'pending',    -- pending | synced | failed | local
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists crm_appointments_starts_idx on crm_appointments (starts_at);

-- ---------------------------------------------------------------------------
-- Settings — single-row config for the business + AI receptionist persona.
-- ---------------------------------------------------------------------------
create table if not exists crm_settings (
  id                    int primary key default 1,
  business_name         text default 'Art-is-Tree LLC',
  business_phone        text default '(757) 319-5131',
  business_email        text default 'artistreeofvirginia@gmail.com',
  receptionist_persona  text default '',
  receptionist_greeting text default 'Thanks for calling Art-is-Tree, this is the front desk — how can I help with your trees today?',
  booking_rules         text default '',
  auto_create_jobs      boolean default true,
  notify_email          text default 'artistreeofvirginia@gmail.com',
  updated_at            timestamptz not null default now(),
  constraint crm_settings_singleton check (id = 1)
);
insert into crm_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_crm_contacts_updated on crm_contacts;
create trigger trg_crm_contacts_updated before update on crm_contacts
  for each row execute function crm_set_updated_at();

drop trigger if exists trg_crm_leads_updated on crm_leads;
create trigger trg_crm_leads_updated before update on crm_leads
  for each row execute function crm_set_updated_at();

drop trigger if exists trg_crm_jobs_updated on crm_jobs;
create trigger trg_crm_jobs_updated before update on crm_jobs
  for each row execute function crm_set_updated_at();

drop trigger if exists trg_crm_appointments_updated on crm_appointments;
create trigger trg_crm_appointments_updated before update on crm_appointments
  for each row execute function crm_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: lock everything down. Service role (used by the API)
-- bypasses RLS; no policies means anon/authenticated get nothing.
-- ---------------------------------------------------------------------------
alter table crm_contacts     enable row level security;
alter table crm_leads        enable row level security;
alter table crm_jobs         enable row level security;
alter table crm_activities   enable row level security;
alter table crm_appointments enable row level security;
alter table crm_settings     enable row level security;
