-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
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
--
-- Remember the marker: SLOW::ARBO
-- 0007: follow-up & outreach tracking (§5A #16–20).
-- The engine (src/ops/followUps.ts) is pure; these columns are the state it
-- reads: cadence anchors on estimates, review-request bookkeeping on jobs.
-- Roll-forward, idempotent.

alter table estimate add column if not exists last_follow_up_at timestamptz;
alter table estimate add column if not exists follow_up_count int not null default 0;

alter table job add column if not exists completed_at timestamptz;
alter table job add column if not exists paid_at timestamptz;
alter table job add column if not exists review_requested_at timestamptz;

comment on column estimate.last_follow_up_at is 'When the last §16 follow-up actually went out (Mike-approved send)';
comment on column estimate.follow_up_count is 'How many §16 follow-ups have gone out (first one carries proof of insurance, §17)';
comment on column job.review_requested_at is 'When the §18 review request went out — once, ever';
