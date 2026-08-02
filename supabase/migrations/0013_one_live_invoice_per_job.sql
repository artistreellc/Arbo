-- =============================================================================
-- 0013 — one LIVE invoice per job (§4.8).
--
-- The draft path reads "does this job have an invoice?" and then writes. Two
-- rapid clicks (or a retried request) can both pass that read and bill the same
-- job twice — a customer receiving two invoices for one job is a trust failure,
-- not a bookkeeping annoyance. The database is the only place that can settle
-- the race, so it settles it.
--
-- The index is PARTIAL: voided invoices are excluded, so a mistaken invoice can
-- be voided and the job re-billed correctly.
-- =============================================================================

create unique index if not exists invoice_one_live_per_job
  on invoice (job_id)
  where status <> 'void';

comment on index invoice_one_live_per_job is
  'One non-void invoice per job. Voiding releases the slot so a job can be re-billed (§4.8).';
