-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
-- STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
-- ═══════════════════════════════════════════════════════════════════════
--
-- 0021 — ARBO'S OWN SIGN-INS, SEALED (R31 amended, Mike 2026-10-20).
--
-- Mike's spec for Bouncie: "exchange it for tokens using Bouncie's OAuth
-- flow ... and store the tokens server-side in Supabase."
--
-- One table, one row per outside service Arbo signs in to. Today only
-- Bouncie. It holds NO company data — no customer, lead, job, call or truck
-- position — only a token pair, sealed before it leaves the server:
--
--   ciphertext / iv / tag   AES-256-GCM. The key is derived (HKDF-SHA256)
--                           from the provider's client secret, which lives
--                           only on Railway. Reading this table — even with
--                           the service-role key — does not open the tokens.
--   key_version             which derivation sealed the row (1 today).
--   updated_at              when Arbo last saved it.
--
-- Who can reach it:
--   * RLS is ON with NO policies, and every grant is revoked from anon and
--     authenticated. Only the service role (the server) reads or writes it.
--     The revoke matters: 0010's admin_all loop adds a policy to every
--     public table that exists when it runs, and a revoked grant keeps a
--     re-run of that loop from opening this one to a signed-in user.
--   * In the server, ONE door reaches it — src/db/credentialStore.ts — and
--     that door reaches nothing else. The table is in no data link
--     (src/db/links.ts), so getDb() refuses it by name.
--
-- A new provider needs a new migration: the CHECK allows only 'bouncie'.
--
-- ───────────────────────────────────────────────────────────────────────
-- NOT APPLIED LIVE. It is applied only on Mike's go (docs/BOUNCIE.md), and
-- it must be in place BEFORE Connect Bouncie: until then Settings says
-- "the sign-in table isn't in Supabase (migration 0021 not applied)" and
-- the sign-in refuses to start rather than lose a token.
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.integration_credential (
  provider    text primary key check (provider in ('bouncie')),
  ciphertext  text not null,
  iv          text not null,
  tag         text not null,
  key_version smallint not null default 1,
  updated_at  timestamptz not null default now()
);

comment on table public.integration_credential is
  'Arbo''s own sign-ins to outside services (R31: Bouncie), sealed with AES-256-GCM under a key derived from the provider''s client secret. Server only: RLS on, no policies, no anon/authenticated grants. No company data.';

alter table public.integration_credential enable row level security;

revoke all on table public.integration_credential from anon, authenticated;
