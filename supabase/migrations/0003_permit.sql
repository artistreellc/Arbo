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
