-- ═══════════════════════════════════════════════════════════════════════
-- SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
--              it applies: in a file, a commit, a doc, or from Mike.
-- STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
-- ═══════════════════════════════════════════════════════════════════════
--
-- 0020 — THE KNOWLEDGE HUB: where the training library actually lives.
--
-- Mike, 2026-08-04:
--   "these are supposed to be training programs for basic operations of tree
--    work and a knowledge center from recommended professionals, people i
--    approve of. i want every single piece gone through and flagged for
--    approval. if it doesnt meet my safety or knowledge standards..."
--   "i want these knowledges to be expansive. a true hub of knowledge, an
--    industry leading hub for clips and articles that help better peoples
--    careers."
--   "if they are not a isa certified arborist, that doesnt stop us from
--    learning from them but they need to show in video or picture that they
--    are a safe production climber."
--
-- src/safety/curation.ts has carried all of this since cycle 31 and had
-- NOWHERE TO PUT IT. Same hole the portal had in 0019: a fully built, fully
-- tested gate with no table behind it. This is the table half.
--
-- ───────────────────────────────────────────────────────────────────────
-- THE GATES ARE IN THE SCHEMA, NOT ONLY IN THE CODE
-- ───────────────────────────────────────────────────────────────────────
-- Every rule below is already enforced in curation.ts. It is repeated here
-- in CHECK constraints on purpose, because a rule that lives only in one
-- TypeScript function survives exactly until somebody writes a row from a
-- script, a backfill, or the Supabase table editor at midnight. The three
-- that matter:
--
--   1. A SOURCE CANNOT BE APPROVED WITHOUT A DEMONSTRATION. Not a
--      certificate — footage or photographs that a named person watched.
--      `mayApproveSource()` says it; `knowledge_source_demonstrated_to_approve`
--      makes the database refuse the row.
--
--   2. A REJECTION MUST NAME WHICH BAR IT FAILED and give a reason. Mike's
--      three bars are safe / smart / fast and they fail independently. A
--      rejection naming none of them is a shrug, not a judgement — and the
--      rejection reasons ARE the written record of his standard, because he
--      said the standard is learned as this is built, not written down in
--      prose up front.
--
--   3. AN APPROVAL CARRIES A NAME. `decided_by` is not null on anything that
--      is not queued. "The office approved it" is not an approval.
--
-- ───────────────────────────────────────────────────────────────────────
-- WHY THERE IS NO `views`, `rating`, OR `score` COLUMN
-- ───────────────────────────────────────────────────────────────────────
-- Popularity is not one of the three bars. A clip with fifty thousand views
-- showing a climber single-tied is still a rejection, and a column that
-- ranked material by engagement would quietly become a fourth standard
-- nobody agreed to. What ranks material here is Mike's judgement and
-- nothing else.
--
-- ───────────────────────────────────────────────────────────────────────
-- LINKS ONLY. NO COPIES.
-- ───────────────────────────────────────────────────────────────────────
-- There is no column here that could hold video or article BODY. The hub
-- points at the publisher's own hosting so the creator keeps their view,
-- their attribution and their control, and so Art-is-Tree is never
-- redistributing somebody else's work. §6U.3 already forbids reproducing
-- ANSI text; this is the same principle applied to the whole library.
--
-- ───────────────────────────────────────────────────────────────────────
-- NOT APPLIED LIVE. §3.
-- ───────────────────────────────────────────────────────────────────────
-- Committed, not applied — same as 0016 through 0019. The data links are cut
-- and schema changes on Mike's live database are his call. Nothing reads
-- these tables until he says the rough build is done.
-- ═══════════════════════════════════════════════════════════════════════

-- ===========================================================================
-- KNOWLEDGE SOURCE — gate one. A professional whose material may even be
-- CONSIDERED. Approving somebody here does not approve their back catalogue.
-- ===========================================================================
create table if not exists knowledge_source (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (btrim(name) <> ''),
  -- The three trades Mike named. Closed list; material from outside these is
  -- not tree-work material, whatever else it might be.
  discipline          text not null check (discipline in ('climber', 'arborist', 'logger')),
  -- His words on why he rates them. Kept so the standard stays legible to
  -- whoever queues the next piece.
  why_trusted         text not null check (btrim(why_trusted) <> ''),
  -- ISA or otherwise, AS CLAIMED BY THEM. Nullable, and deliberately not
  -- sufficient. Arbo never asserts anyone's credential as verified fact —
  -- including its own company's (§2).
  credentials_claimed text,

  -- ─── THE ACTUAL BAR: shown, not claimed ───
  -- All four move together: either nobody has seen them work (all null) or
  -- somebody named has, and said what the footage shows.
  demo_evidence_url   text,
  demo_what_it_shows  text,
  demo_reviewed_by    text,
  demo_reviewed_at    timestamptz,

  approval_state      text not null default 'queued'
                        check (approval_state in ('queued', 'approved', 'rejected')),
  decided_by          text,
  decided_at          timestamptz,
  -- Which of safe / smart / fast it failed. Empty on anything not rejected.
  failed              text[] not null default '{}',
  decision_reason     text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- The demonstration is all-or-nothing. A half-filled proof is not a proof.
  constraint knowledge_source_demo_all_or_nothing check (
    (demo_evidence_url is null and demo_what_it_shows is null
      and demo_reviewed_by is null and demo_reviewed_at is null)
    or
    (btrim(demo_evidence_url) <> '' and btrim(demo_what_it_shows) <> ''
      and btrim(demo_reviewed_by) <> '' and demo_reviewed_at is not null)
  ),

  -- ═══ THE INVERSION, IN THE DATABASE ═══
  -- A certificate with no demonstration is refused. A demonstration with no
  -- certificate is fine. That is the rule as Mike stated it, and this is the
  -- line that makes the database enforce it rather than trusting a caller.
  constraint knowledge_source_demonstrated_to_approve check (
    approval_state <> 'approved' or demo_evidence_url is not null
  ),

  constraint knowledge_source_failed_values check (
    failed <@ array['safe', 'smart', 'fast']::text[]
  ),
  constraint knowledge_source_decision_shape check (
    (approval_state = 'queued'
      and decided_by is null and decided_at is null
      and cardinality(failed) = 0 and decision_reason is null)
    or
    (approval_state = 'approved'
      and btrim(decided_by) <> '' and decided_at is not null
      and cardinality(failed) = 0 and decision_reason is null)
    or
    (approval_state = 'rejected'
      and btrim(decided_by) <> '' and decided_at is not null
      and cardinality(failed) >= 1 and btrim(decision_reason) <> '')
  )
);
create index if not exists knowledge_source_state_idx on knowledge_source (approval_state);

-- ===========================================================================
-- KNOWLEDGE PIECE — gate two. One clip or one article.
--
-- Servable requires BOTH gates: this row approved AND its source approved.
-- No view or constraint can express "my parent is approved" cheaply, so that
-- half stays in `servable()` — which is why `assertAllApproved()` runs on the
-- serving path as well. Two doors, same as §3.
-- ===========================================================================
create table if not exists knowledge_piece (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references knowledge_source(id) on delete restrict,
  -- Seven pillars. Expansive means deep and wide WITHIN tree work, not
  -- unbounded — there is no 'general' and no 'other'.
  area            text not null check (area in (
                    'safety', 'climbing_craft', 'rigging_mechanics', 'tree_science',
                    'equipment', 'production', 'career')),
  format          text not null check (format in ('clip', 'article')),
  title           text not null check (btrim(title) <> ''),
  url             text not null check (btrim(url) <> ''),
  -- What it teaches, in the reviewer's words AFTER watching or reading it.
  teaches         text not null check (btrim(teaches) <> ''),
  -- Set when the piece is kept deliberately as a counter-example: approved,
  -- but approved as "this is what NOT to do". Serving it without this line
  -- showing would teach the hazard.
  counter_example text,
  -- Why this is being put in front of Mike — the specific doubt, not a
  -- summary. "The climb is clean but they are single-tied at 2:40, is that a
  -- no?" lets him answer in ten seconds. A cold link makes him do the work of
  -- finding the doubt the queuer already had.
  queued_note     text,

  approval_state  text not null default 'queued'
                    check (approval_state in ('queued', 'approved', 'rejected')),
  decided_by      text,
  decided_at      timestamptz,
  failed          text[] not null default '{}',
  decision_reason text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- The same link twice is the same judgement twice. Unique so a rejected
  -- piece cannot quietly reappear next quarter as a fresh queued row —
  -- which is the whole reason rejections are kept on file.
  constraint knowledge_piece_url_once unique (url),

  constraint knowledge_piece_failed_values check (
    failed <@ array['safe', 'smart', 'fast']::text[]
  ),
  constraint knowledge_piece_decision_shape check (
    (approval_state = 'queued'
      and decided_by is null and decided_at is null
      and cardinality(failed) = 0 and decision_reason is null)
    or
    (approval_state = 'approved'
      and btrim(decided_by) <> '' and decided_at is not null
      and cardinality(failed) = 0 and decision_reason is null)
    or
    (approval_state = 'rejected'
      and btrim(decided_by) <> '' and decided_at is not null
      and cardinality(failed) >= 1 and btrim(decision_reason) <> '')
  )
);
create index if not exists knowledge_piece_source_idx on knowledge_piece (source_id);
create index if not exists knowledge_piece_area_idx on knowledge_piece (area, approval_state);
create index if not exists knowledge_piece_state_idx on knowledge_piece (approval_state);

-- ===========================================================================
-- TRAINING PROGRAM — an ordered curriculum for one basic operation.
--
-- "training programs for basic operations of tree work" — a sequence, not a
-- pile of links. `step_piece_ids` is an ARRAY rather than a join table
-- because position IS the data here and an array preserves it without a
-- second table and an ordinal column to keep in sync. Simplicity over
-- cleverness; the calendar is an iframe for the same reason.
--
-- A program is publishable only when EVERY step is approved — one unreviewed
-- clip in a ten-step curriculum blocks the whole thing, because a crew member
-- working through it in order will hit that step and be taught by something
-- nobody vetted. That check needs the pieces in hand, so it lives in
-- `checkProgram()`; this table holds the shape.
-- ===========================================================================
create table if not exists training_program (
  id              uuid primary key default gen_random_uuid(),
  -- e.g. "Running the chipper", "Ground crew basics", "First day on a rope"
  operation       text not null check (btrim(operation) <> ''),
  summary         text not null check (btrim(summary) <> ''),
  step_piece_ids  uuid[] not null default '{}',

  approval_state  text not null default 'queued'
                    check (approval_state in ('queued', 'approved', 'rejected')),
  decided_by      text,
  decided_at      timestamptz,
  failed          text[] not null default '{}',
  decision_reason text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint training_program_failed_values check (
    failed <@ array['safe', 'smart', 'fast']::text[]
  ),
  constraint training_program_decision_shape check (
    (approval_state = 'queued'
      and decided_by is null and decided_at is null
      and cardinality(failed) = 0 and decision_reason is null)
    or
    (approval_state = 'approved'
      and btrim(decided_by) <> '' and decided_at is not null
      and cardinality(failed) = 0 and decision_reason is null)
    or
    (approval_state = 'rejected'
      and btrim(decided_by) <> '' and decided_at is not null
      and cardinality(failed) >= 1 and btrim(decision_reason) <> '')
  ),
  -- An approved curriculum with no steps in it is an empty promise.
  constraint training_program_approved_has_steps check (
    approval_state <> 'approved' or cardinality(step_piece_ids) >= 1
  )
);
create index if not exists training_program_state_idx on training_program (approval_state);

-- Service-role only, same as the rest of the spine (§4.3).
alter table knowledge_source enable row level security;
alter table knowledge_piece enable row level security;
alter table training_program enable row level security;
