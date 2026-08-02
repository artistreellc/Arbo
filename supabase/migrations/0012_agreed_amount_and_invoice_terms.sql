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
