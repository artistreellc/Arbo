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
-- =============================================================================
-- 0015 — Suffolk is a MARKETING boundary, not a licensing one.
--
-- Owner ruling (Mike, 2026-08-02): "we're just not advertising there for the
-- season, too much work closer to home." Arbo had been reading the four-city
-- service area as a hard limit and REJECTING Suffolk addresses at intake
-- (OutOfServiceAreaError), which silently binned real leads for work he would
-- happily take. That is the expensive direction of a wrong guess.
--
-- Suffolk becomes an accepted, FLAGGED city. It is deliberately NOT promoted
-- to a core service city: each of the four core cities has a permit ruleset
-- behind it, and screening a Suffolk property against Virginia Beach rules
-- would produce a confident wrong answer on a compliance surface. Off-focus
-- cities are reported as unscreenable instead (§1B) — "no ruleset on file,
-- verify with the city" rather than a fabricated result.
-- =============================================================================

alter table property drop constraint if exists property_city_check;
alter table property add constraint property_city_check
  check (city in ('Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth', 'Suffolk'));

comment on column property.city is
  'Core service cities have permit rulesets. Suffolk is workable but off-marketing-focus this season: accept and flag, never auto-reject, and never screen it against another city''s permit rules.';
