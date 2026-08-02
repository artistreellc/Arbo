-- 0008: location intelligence + review loop (§5A #21–24, #29).
-- Roll-forward, idempotent. RLS on, zero policies (D11: service-role only).

-- Mike's OWN location pings — never customer data. §24 is enforced in code
-- (pings are rejected when tracking is off or outside working hours) AND by
-- retention: the repo deletes pings older than 72 hours on every insert.
create table if not exists location_ping (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  at timestamptz not null default now()
);
alter table location_ping enable row level security;
create index if not exists location_ping_at on location_ping (at desc);

-- Tiny ops key-value store: today just the tracking master switch (§24 —
-- clear ON/OFF; defaults OFF until Mike flips it in the app).
create table if not exists ops_setting (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table ops_setting enable row level security;

-- §29: every voice conversation logged (one row per call session) so the
-- human-in-the-loop review has a real backlog. Transcript text lives ONLY
-- here, RLS-locked — never in server logs (§4.3).
create table if not exists conversation_log (
  id uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  channel text not null default 'voice' check (channel in ('voice', 'sms', 'web')),
  started_at timestamptz not null default now(),
  last_turn_at timestamptz not null default now(),
  turns jsonb not null default '[]'::jsonb,
  reviewed boolean not null default false
);
alter table conversation_log enable row level security;
create index if not exists conversation_log_started on conversation_log (started_at desc);

-- #21/#22: when a geofence pass actually saw Mike at the estimate's property.
alter table estimate add column if not exists visited_at timestamptz;

comment on table location_ping is 'Owner phone pings, §24-gated in code; 72h retention';
comment on table conversation_log is '§29 review-loop backlog; transcripts stay RLS-locked here';
comment on column estimate.visited_at is 'Geofence-confirmed arrival at the estimate stop (§5A #21/#22)';
