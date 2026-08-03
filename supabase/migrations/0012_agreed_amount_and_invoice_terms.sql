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
-- =============================================================================
-- 0012 — the agreed figure, and payment terms on the invoice (§4.8, §3).
--
-- Arbo NEVER sets a price. Until now there was nowhere to record the number the
-- customer actually agreed to, which meant an invoice amount would have had to
-- be derived — exactly the thing §3 forbids. `estimate.agreed_amount` is that
-- number: a human writes it after the signed estimate, and the invoice draft
-- copies it verbatim. A job whose estimate has no agreed_amount produces NO
-- draft and says why (§1B).
--
-- `invoice.net_days` makes the payment clock explicit instead of implied, so
-- "overdue" is a computed fact rather than an assumption.
-- =============================================================================

alter table estimate
  add column if not exists agreed_amount numeric(12,2);

comment on column estimate.agreed_amount is
  'The figure the customer agreed to on the signed estimate. Written by a human; Arbo never derives it (§3 never-price).';

-- A signed figure is never zero or negative.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'estimate_agreed_amount_positive'
  ) then
    alter table estimate
      add constraint estimate_agreed_amount_positive
      check (agreed_amount is null or agreed_amount > 0);
  end if;
end $$;

alter table invoice
  add column if not exists net_days int not null default 14;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoice_net_days_sane'
  ) then
    alter table invoice
      add constraint invoice_net_days_sane
      check (net_days between 1 and 90);
  end if;
end $$;

comment on column invoice.net_days is
  'Days from sent_at until payment is due. Overdue is computed from this, never assumed.';
