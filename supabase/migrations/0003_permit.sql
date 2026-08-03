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
-- Permit entity (brief §7 + §6B). Persists the CBPA/RPA + overlay screen so a
-- result lives on the property/job and no crew starts protected work without
-- clearance (§6B.3). Same access model as the rest of the spine: RLS on,
-- service-role only (§4.3).
--
-- The screen STATUS mirrors the code type exactly and is deliberately missing
-- any bare "clear": screen_status is one of PERMIT_LIKELY / REVIEW_NEEDED /
-- NO_OVERLAY_VERIFY, enforced by a CHECK so a false "clear" is unstorable, the
-- same philosophy as the receptionist output guard (§6B.3, §12).

-- ===========================================================================
-- PERMIT — one screen/permit track per property (+ optional job).
-- ===========================================================================
create table if not exists permit (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references property(id) on delete cascade,
  job_id               uuid references job(id) on delete set null,
  city                 text not null
                         check (city in ('Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth')),
  -- Result of the screen (§6B.1). NO 'clear'/'none' value exists — the safe
  -- floor is NO_OVERLAY_VERIFY ("verify with city").
  screen_status        text not null
                         check (screen_status in ('PERMIT_LIKELY','REVIEW_NEEDED','NO_OVERLAY_VERIFY')),
  in_rpa               boolean not null default false,  -- inside a CBPA/RPA buffer
  overlay_source       jsonb,                           -- the OverlayHit[] that produced the status
  form_ref             text,                            -- e.g. VB PPR record # (YYYY-DSC-######)
  labeled_map_file     text,                            -- Drive file id of the 6B.2 site map
  packet_file          text,                            -- Drive file id of the assembled packet
  -- Lifecycle status (§6B.3). 'not_required_verified' is only reachable after a
  -- human confirmed with the city — never inferred from the screen alone.
  status               text not null default 'needed'
                         check (status in ('needed','applied','approved','not_required_verified')),
  city_contact         jsonb,                           -- the city office contact used
  ruleset_last_verified date,                           -- the per-city config date at screen time
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists permit_property_idx on permit (property_id);
create index if not exists permit_job_idx on permit (job_id);
create index if not exists permit_status_idx on permit (status);

-- updated_at trigger (reuses the pinned-search_path function from 0001/0002).
drop trigger if exists trg_permit_updated on permit;
create trigger trg_permit_updated before update on permit
  for each row execute function arbor_touch_updated_at();

-- Lock it down: RLS on, no anon/authenticated policy (service-role only, §4.3).
alter table permit enable row level security;
