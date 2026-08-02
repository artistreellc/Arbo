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
