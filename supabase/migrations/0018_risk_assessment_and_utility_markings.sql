-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
-- STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
-- ═══════════════════════════════════════════════════════════════════════
--
-- 0018 — THE RISK ASSESSMENT: tree care log, customer context, geo, AR
--        capture, prune estimates, prune plans, and Miss Utility markings.
--
-- Mike, 2026-08-03, across several messages:
--   "the pruning plan it going to be apart of the RA as is an estimate tool
--    and a rough guess of the limbs coming off of a nieghbors over hangeing
--    tree the actual prune plan needs to be made be the foreman or onwer or
--    isa certified arborist on site"
--   "the whole point of this is logging has much tree care data as possible"
--   "as much custmer data as possible and as much geo data as possible"
--   "also the video caoturing that happens during AR"
--   "all that miss utitly marking would be store and though dtted its not to
--    be treated as the same thing"
--
-- ───────────────────────────────────────────────────────────────────────
-- WHY SO MANY NULLABLE COLUMNS, AND WHY THAT IS THE POINT
-- ───────────────────────────────────────────────────────────────────────
-- Mike's ask is maximum logging. The failure mode of maximum logging is a
-- wide table full of defaults that READ like observations — a `boolean not
-- null default false` on "deadwood noted" says "no deadwood" about every
-- tree nobody has looked at.
--
-- So every observation column here is NULLABLE with NO DEFAULT. NULL means
-- nobody recorded it. FALSE means somebody looked and did not see it. Those
-- are different facts about a tree and the schema keeps them different.
-- Same law as 0016 and 0017.
--
-- ───────────────────────────────────────────────────────────────────────
-- NOT APPLIED LIVE. §3.
-- ───────────────────────────────────────────────────────────────────────
-- Committed, not applied — same as 0016 and 0017. The data links are cut and
-- schema changes on Mike's live database are his call, not an optimisation
-- to make quietly. Nothing reads these tables until he says the rough build
-- is done.

-- ===========================================================================
-- RISK_ASSESSMENT — one per tree, accumulating over every visit.
-- ===========================================================================
create table if not exists risk_assessment (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references tree(id) on delete cascade,
  property_id uuid not null references property(id) on delete cascade,

  -- ── The tree care log. Who wrote it down, and when. NULL observed_by means
  --    an unattributed record: kept, but weaker, and the app says so.
  observed_by text,
  observed_at timestamptz,

  species_guess              text,
  dbh_inches_guess           numeric,
  height_feet_guess          numeric,
  canopy_spread_feet_guess   numeric,

  -- Tri-state on purpose. NULL = not looked at. FALSE = looked, not present.
  deadwood_noted                 boolean,
  cavity_or_decay_noted          boolean,
  lean_noted                     boolean,
  included_bark_noted            boolean,
  prior_topping_noted            boolean,
  root_plate_disturbance_noted   boolean,

  targets_beneath    text,
  utility_proximity  text,
  access_notes       text,
  photo_refs         text[] not null default '{}',
  observation_notes  text,

  -- ── Customer context (§3: this is the AI assistant's context, and VA brief
  --    §5.9 makes it binding on every future contact). PII: stored here,
  --    NEVER in logs or chat output (§4.3).
  contact_instructions text,
  access_window_notes  text,
  caller_is_owner      boolean,
  owner_name_on_file   boolean,
  site_entry_notes     text,
  pets_on_site         text,
  stated_concern       text,
  prior_job_ids        uuid[] not null default '{}',
  customer_notes       text,

  -- ── Geo. accuracy_meters is its own column because a point with no
  --    accuracy figure looks exactly as authoritative as a good fix and is
  --    not — D37 (Circle Drive) is the evidence.
  captured_lat  double precision,
  captured_lng  double precision,
  accuracy_meters numeric,
  tree_lat      double precision,
  tree_lng      double precision,
  fix_source    text check (fix_source is null or fix_source in
                  ('gps','ar_placement','manual_pin','geocoded_address')),
  elevation_meters numeric,
  heading_degrees  numeric,
  position_on_lot  text,
  distance_to_structure_feet     numeric,
  distance_to_property_line_feet numeric,
  distance_to_road_feet          numeric,
  parcel_id      text,
  city_at_capture text,
  geo_notes      text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tree_id)
);
create index if not exists risk_assessment_property_idx on risk_assessment (property_id);

comment on table risk_assessment is
  'The accumulating tree care record. Every observation column is nullable with no default: NULL = nobody recorded it, FALSE = somebody looked and did not see it. Never collapse the two.';
comment on column risk_assessment.contact_instructions is
  'Customer PII. Stored here on purpose (§3); never appears in logs or chat output (§4.3).';

drop trigger if exists trg_risk_assessment_updated on risk_assessment;
create trigger trg_risk_assessment_updated before update on risk_assessment
  for each row execute function arbor_touch_updated_at();

-- ===========================================================================
-- AR_CAPTURE_SESSION — the video/LiDAR run behind an estimate.
-- ===========================================================================
-- Media is stored as REFERENCES ONLY. A video of somebody's back garden is
-- customer data the same as their phone number; the bytes live in Drive.
create table if not exists ar_capture_session (
  id          uuid primary key default gen_random_uuid(),
  risk_assessment_id uuid not null references risk_assessment(id) on delete cascade,
  started_at  timestamptz not null,
  ended_at    timestamptz,
  duration_seconds integer,
  video_refs      text[] not null default '{}',
  keyframe_refs   text[] not null default '{}',
  depth_scan_refs text[] not null default '{}',
  device_model text,
  os_version   text,
  ar_framework text check (ar_framework is null or ar_framework in ('realitykit','arkit','other')),
  tracking_quality text check (tracking_quality is null or tracking_quality in ('good','poor','lost')),
  has_lidar boolean,
  -- Filming over a neighbour's line is the case that needs asking about.
  -- NULL consent is NOT consent, and the app renders it as a gap.
  covered_neighbor_property boolean,
  recorded_with_consent     boolean,
  consent_note text,
  created_at timestamptz not null default now()
);
create index if not exists ar_session_ra_idx on ar_capture_session (risk_assessment_id);

comment on column ar_capture_session.recorded_with_consent is
  'NULL means nobody wrote it down. That is not consent and must never render as yes.';

-- ===========================================================================
-- PRUNE_ESTIMATE — the tool's ROUGH GUESS. Not a plan. Never a plan.
-- ===========================================================================
create table if not exists prune_estimate (
  id        uuid primary key default gen_random_uuid(),
  risk_assessment_id uuid not null references risk_assessment(id) on delete cascade,
  tree_id   uuid not null references tree(id) on delete cascade,
  ar_session_id uuid references ar_capture_session(id) on delete set null,
  scope     text not null default 'neighbor_overhang' check (scope in ('neighbor_overhang')),
  source    text not null check (source in ('camera_ar','manual')),
  captured_at timestamptz not null,
  -- THE §1B COLUMN PAIR. limbs NULL = the capture could not read the tree.
  -- limbs '[]' = it read the tree and found no overhanging limbs. A CHECK
  -- makes the two states impossible to blur: unreadable must carry a reason,
  -- and a readable estimate must not claim one.
  limbs        jsonb,
  not_readable text,
  constraint prune_estimate_readable_xor check (
    (limbs is null and not_readable is not null) or
    (limbs is not null and not_readable is null)
  ),
  created_at timestamptz not null default now()
);
create index if not exists prune_estimate_ra_idx on prune_estimate (risk_assessment_id);

comment on table prune_estimate is
  'A ROUGH GUESS for estimating, per Mike 2026-08-03. Not a prune plan and never to be rendered as one — see prune_plan, which requires a named human on site.';

-- ===========================================================================
-- PRUNE_PLAN — a named human's decision, made on site.
-- ===========================================================================
-- Mike: "the actual prune plan needs to be made be the foreman or onwer or
-- isa certified arborist on site". Every clause of that is a constraint here,
-- so a direct INSERT cannot bypass what the code enforces.
create table if not exists prune_plan (
  id        uuid primary key default gen_random_uuid(),
  risk_assessment_id uuid not null references risk_assessment(id) on delete cascade,
  tree_id   uuid not null references tree(id) on delete cascade,
  -- Provenance only. An estimate contributes a reference and nothing else;
  -- a person still writes every cut.
  from_estimate_id uuid references prune_estimate(id) on delete set null,

  author_id   uuid references crew_member(id) on delete set null,
  author_name text not null check (btrim(author_name) <> ''),
  author_role text not null check (author_role in ('foreman','owner','isa_certified_arborist')),
  -- "Never claim a credential the company doesn't hold", enforced both ways:
  -- an ISA-authored plan must carry a number, and nothing else may.
  isa_certification_number text,
  constraint prune_plan_isa_number_matches_role check (
    (author_role =  'isa_certified_arborist' and isa_certification_number is not null)
    or
    (author_role <> 'isa_certified_arborist' and isa_certification_number is null)
  ),

  -- Mike said on site and meant it. A plan written in the truck is the
  -- failure this ruling exists to prevent, so FALSE is unstorable.
  authored_on_site boolean not null default true check (authored_on_site),
  authored_at timestamptz not null,

  cuts jsonb not null default '[]',
  no_cuts_needed boolean not null default false,
  -- "Nothing comes off" has to be said on purpose, not left as an empty form.
  constraint prune_plan_cuts_or_deliberate_none check (
    (no_cuts_needed and jsonb_array_length(cuts) = 0) or
    (not no_cuts_needed and jsonb_array_length(cuts) > 0)
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prune_plan_ra_idx on prune_plan (risk_assessment_id);

drop trigger if exists trg_prune_plan_updated on prune_plan;
create trigger trg_prune_plan_updated before update on prune_plan
  for each row execute function arbor_touch_updated_at();

-- ===========================================================================
-- UTILITY_MARKING / LOCATE_TICKET — remembered, dotted, never a live locate.
-- ===========================================================================
-- Mike: "though dtted its not to be treated as the same thing but itll let ya
-- know if you really got to waste the time and call them gain".
--
-- These hang off the PROPERTY, not the tree: what is buried in the front lawn
-- is a fact about the lot, and it is still true next time regardless of which
-- tree the visit was about.
create table if not exists locate_ticket (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references property(id) on delete cascade,
  ticket_number text not null,
  requested_on  date not null,
  -- NULLABLE AND NEVER COMPUTED. Ticket life is the one-call centre's rule,
  -- not ours; guessing an expiry is how a crew ends up in a gas line. NULL
  -- means we do not know, and the app treats not-knowing as "call again".
  valid_through date,
  requested_by  text,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (property_id, ticket_number)
);
create index if not exists locate_ticket_property_idx on locate_ticket (property_id);

comment on column locate_ticket.valid_through is
  'Read off the real ticket by a person. NEVER derived. NULL = unknown, which the app treats as "call Miss Utility again".';

create table if not exists utility_marking (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references property(id) on delete cascade,
  locate_ticket_id uuid references locate_ticket(id) on delete set null,
  -- APWA uniform colour code — the vocabulary that is actually on the ground.
  kind text not null check (kind in (
    'electric','gas_oil_steam','communications','potable_water',
    'reclaimed_water','sewer_drain','survey','proposed_excavation','unknown')),
  where_text text not null,
  -- NULL = we kept the marking but not the date. Rendered as "date not
  -- recorded", which must look WORSE than an old date, not better.
  marked_on   date,
  recorded_by text,
  photo_refs  text[] not null default '{}',
  lat double precision,
  lng double precision,
  approx_depth_inches numeric,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists utility_marking_property_idx on utility_marking (property_id);

comment on table utility_marking is
  'Remembered Miss Utility markings. Rendered DOTTED and never as a live locate (Mike, 2026-08-03). Nothing in this table authorises excavation; see src/assessment/utilityMarkings.ts, which has no "clear to dig" state.';

-- Service-role only, same as the rest of the spine (§4.3).
alter table risk_assessment    enable row level security;
alter table ar_capture_session enable row level security;
alter table prune_estimate     enable row level security;
alter table prune_plan         enable row level security;
alter table locate_ticket      enable row level security;
alter table utility_marking    enable row level security;
