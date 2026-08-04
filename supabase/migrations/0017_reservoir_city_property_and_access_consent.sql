-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
-- STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
-- ═══════════════════════════════════════════════════════════════════════
--
-- 0017 — RESERVOIR EDGE, CITY-OWNED TREES, AND NEIGHBOUR ACCESS CONSENT.
--
-- Mike, 2026-08-03: "itll show the if the proerty is in the cbpa or flood
-- zone or if it on the edge of a resivor, if the tree rests on city property
-- … there will be a bo[tt]on that leads to a pre written private property
-- acces letter that all the neiighbor has to do is gve email and press
-- accept".
--
-- WHAT IS NOT HERE, AND WHY. There is no column for the CBPA or flood
-- finding. The `permit` table (0003) already stores overlay_source — the
-- OverlayHit[] the screen produced — with created_at as when it ran, and
-- src/portal/propertyFlags.ts reads the portal flags straight off that. A
-- second copy of a screen result is two sources of truth that will disagree,
-- and the one on the customer's screen would be the stale one.
--
-- WHY EVERY NEW BOOLEAN IS NULLABLE WITH A SEPARATE DATE. Same reasoning as
-- 0016. A boolean defaulting to false stores "no" and "nobody looked" as the
-- same value; on "is this tree the city's?" that is the difference between a
-- normal job and cutting a city tree without permission. NULL means nobody
-- has determined it, and the *_checked_at date is what turns a FALSE from a
-- default into somebody's finding.

alter table property
  -- No GIS layer screens for reservoir watersheds yet (see
  -- src/permitting/gis/layers.ts — no city has a RESERVOIR_WATERSHED entry),
  -- so this is a human observation, not a screen result.
  add column if not exists near_reservoir            boolean,
  add column if not exists near_reservoir_checked_at timestamptz;

comment on column property.near_reservoir is
  'Human observation: does this property sit on or near a reservoir edge? NULL = nobody has looked. No GIS layer answers this yet.';
comment on column property.near_reservoir_checked_at is
  'When a person determined near_reservoir. NULL with near_reservoir=false means it is a guess, not a finding.';

alter table tree
  -- Parcel ownership at the curb strip is exactly where GIS is least
  -- trustworthy, so this is deliberately NOT screened — a person decides it.
  add column if not exists on_city_property         boolean,
  add column if not exists city_property_checked_at timestamptz;

comment on column tree.on_city_property is
  'Human determination: does this tree stand on city property / in the right-of-way? NULL = not determined. Never inferred from GIS.';
comment on column tree.city_property_checked_at is
  'When a person determined on_city_property. NULL with false means nobody stood behind it.';

-- ===========================================================================
-- PROPERTY_ACCESS_CONSENT — the neighbour said yes, and to exactly these words.
-- ===========================================================================
-- letter_sha256 is the point of this table. "They accepted" without recording
-- WHAT they accepted is worth nothing the day it matters, and it would let an
-- edit to the letter template retroactively put different words in their
-- mouth. The hash pins the text that was on the screen.
--
-- Arbo does not send this letter. There is no sent_at column and there should
-- not be one: "Never send email. Ever." (CLAUDE.md), and R7 keeps Resend and
-- the website out of scope. The two channels below are the two that exist —
-- the crew member's phone, and an approval page opened from a link somebody
-- else carried.
create table if not exists property_access_consent (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references job(id) on delete cascade,
  -- The neighbour is not a customer and gets no row anywhere else. This is
  -- PII (§4.3): counts and ids in logs, never this column.
  neighbor_email text not null,
  -- sha256 hex of the exact letter text displayed at acceptance.
  letter_sha256  text not null check (char_length(letter_sha256) = 64),
  channel        text not null check (channel in ('crew_device','approval_page')),
  -- Required on crew_device: on that route the crew member IS the witness, so
  -- an unattributed acceptance is not a record of anything. Enforced here as
  -- well as in src/legal/propertyAccess.ts so a direct insert cannot skip it.
  crew_member_id uuid references crew_member(id) on delete set null,
  accepted_at    timestamptz not null default now(),
  -- Consent is withdrawable and the letter says so out loud. Recorded, never
  -- deleted — the fact that permission existed and was pulled is itself the
  -- thing a crew needs to know.
  withdrawn_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint access_consent_crew_witness
    check (channel <> 'crew_device' or crew_member_id is not null)
);
create index if not exists access_consent_job_idx on property_access_consent (job_id);

-- Service-role only, same as the rest of the spine (§4.3).
alter table property_access_consent enable row level security;
