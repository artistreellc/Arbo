-- Permit correspondence index (brief §5A #35): past city-permit email indexed
-- so recurring contacts and cases attach to properties and prior filings are
-- reusable. One row per relevant thread/case reference. RLS on, service-role
-- only (§4.3) — homeowner details live in the linked property/contact rows,
-- not duplicated here.

create table if not exists permit_correspondence (
  id             uuid primary key default gen_random_uuid(),
  city           text not null
                   check (city in ('Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth')),
  kind           text not null
                   check (kind in ('ppr_review','cbpa_case','intake_request','duplicate_warning','payment','other_city_mail')),
  case_ref       text,                        -- e.g. 2025-DSC-021566 / J04-021654-RPA
  subject        text,
  address_text   text,                        -- address as it appeared in the mail
  property_id    uuid references property(id) on delete set null,
  permit_id      uuid references permit(id) on delete set null,
  gmail_thread_id text,                       -- source thread for drill-down
  city_contacts  jsonb,                       -- gov addresses on the thread
  received_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists permit_corr_case_idx on permit_correspondence (case_ref);
create index if not exists permit_corr_property_idx on permit_correspondence (property_id);

alter table permit_correspondence enable row level security;
