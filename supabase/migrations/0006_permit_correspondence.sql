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
