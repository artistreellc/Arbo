-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
-- STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
-- ═══════════════════════════════════════════════════════════════════════
--
-- 0019 — CLOSE THE PUBLIC DOOR ON THE SECURITY DEFINER HELPERS.
--
-- R19, Mike 2026-09-24: "make sure its using supabase the correct way."
-- Supabase's security advisor (lints 0028/0029) flagged five SECURITY
-- DEFINER functions executable by `anon` — i.e. callable by anyone on the
-- internet at /rest/v1/rpc/<name> with only the publishable key.
--
-- WHY THIS IS SAFE — checked against the live catalogue before writing:
-- every one of the 55 RLS policies in `public` targets the `authenticated`
-- role and nothing else. No policy is ever evaluated as `anon`, so no policy
-- loses a function it calls. `authenticated` KEEPS execute on the four
-- helpers because the policies call them.
--
-- The fifth, arbor_training_item_blameless, RETURNS trigger. Postgres checks
-- EXECUTE on a trigger function when the trigger is CREATED, not when it
-- FIRES, so revoking every direct caller changes nothing about the trigger
-- and removes the RPC surface entirely.
--
-- The app itself talks with the service role (§4.3), which is untouched.

revoke execute on function public.arbo_current_crew_member() from public, anon;
revoke execute on function public.arbo_current_role()        from public, anon;
revoke execute on function public.arbo_is_active_crew()      from public, anon;
revoke execute on function public.arbo_is_admin()            from public, anon;

revoke execute on function public.arbor_training_item_blameless() from public, anon, authenticated;
