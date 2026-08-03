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
