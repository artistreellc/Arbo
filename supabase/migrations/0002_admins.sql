-- Arbo CRM — admin allowlist for real Supabase Auth.
-- ---------------------------------------------------------------------------
-- With real auth turned on, every /api/crm/* admin request carries the signed-
-- in user's JWT. The API verifies that token with Supabase, then confirms the
-- user is an authorized admin. Authorization is the UNION of two sources:
--   1. The CRM_ADMIN_EMAILS env var (comma-separated) — quickest to set.
--   2. This crm_admins table — manageable without a redeploy.
-- A user needs to appear in EITHER to get in. If neither is configured, the
-- API fails closed (no access), so the CRM is never accidentally left open.
--
-- Creating the actual login: add the user in Supabase Dashboard → Authentication
-- → Users (or let them sign up if you enable it), then add their email here or
-- to CRM_ADMIN_EMAILS.
-- ---------------------------------------------------------------------------

create table if not exists crm_admins (
  email       text primary key,
  name        text,
  created_at  timestamptz not null default now()
);

-- Seed the owner. Adjust/add rows as needed.
insert into crm_admins (email, name)
values ('artistreeofvirginia@gmail.com', 'Owner')
on conflict (email) do nothing;

-- Locked down like the rest — only the service-role API reads it.
alter table crm_admins enable row level security;
