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
