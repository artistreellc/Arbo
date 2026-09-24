# DATA LINKS — the one-by-one reconnect (R19)

Owner instruction, 2026-09-24. Mike: *"contecting the links for the data it
needs one by one after a multiple step verification process"* and *"make
sure its using supabase the correct way"*.

## The switches

- `ARBO_DATA_LINKS=live` — the MASTER (§3). Anything else = everything cut.
- `ARBO_LINK_<NAME>=live` — one per link, on top of the master. The links
  and their tables live in `src/db/links.ts`. Same fail-closed rule: a
  missing, misspelled, or miscased value leaves that link CUT.
- Enforcement is at `getDb()`'s `from()` door: a cut link throws
  `LinkCutError` naming the link; an unmapped table refuses too. The server
  answers 503 `link_cut` — never a vague 500 (§1B).

## The verification process — EVERY link, EVERY time, in order

No step is skippable, and a finding at any step STOPS the link and goes to
Mike. Run steps 1–4 read-only from the session (Supabase MCP); the app
cannot read a cut link, on purpose.

1. **Migrations parity.** Every file in `supabase/migrations/` is applied
   (`list_migrations` matches the repo). New migrations go through the
   Supabase migration tooling — never raw ad-hoc DDL — AND the `.sql` file
   is committed (CLAUDE.md law).
2. **Supabase the correct way.** RLS enabled on the link's tables; security
   and performance advisors show nothing new for them; the service-role key
   stays server-side only (§4.3).
3. **Content review.** Row counts for the link's tables, and a look at what
   is actually in them. Anything unexpected — rows from a reverted writer,
   sim rows near real rows, states a surface would render dangerously — is
   FLAGGED TO MIKE and the link stays shut until he rules. (This is §3's
   lesson as procedure: look at what a door will show BEFORE opening it.)
4. **Tests green** for the link's read/write paths (`npm run check`).
5. **Open it.** Set the link's variable on Railway, deploy manually by full
   SHA, and verify: the boot line names the link as open, and
   `GET /api/links` probes its tables with live counts.
6. **Look at what it renders.** Open the app surfaces that read the link and
   confirm they show the truth (screenshots). A dead feed stays NAMED.

## Link status (2026-09-24 verification pass)

| Link | Tables (rows) | Finding |
|---|---|---|
| contacts | contact (26), contact_property (0) | clean |
| properties | property (14), tree (0) | clean |
| leads | lead (37), campaign (0) | clean |
| estimates | estimate (0) | clean |
| jobs | job (**11**), contract (0), … | **HELD — the 11 `job` rows are from the 2026-08 ingestion incident (status `booked`, renders as crew work orders). Mike rules on them before this link opens.** |
| permits | permit (0), permit_correspondence (0) | clean |
| photos | photo (0) | clean |
| calls | conversation_log (0), call_log (0) | clean |
| location | location_ping (0) | clean |
| crew / equipment / safety / ops | all 0 except event (581), agent_run | clean — event/agent_run rows are Arbo's own audit spine, not customer data |

Migrations 0016–0018 were unapplied at review time — applied via the
Supabase migration tooling as part of this pass (step 1).

## What connecting a link does NOT do

- It does not import anything. §3's import gate stands: nothing involving
  active company activity flows IN without its own ruling from Mike.
- It does not change sweep behavior: sweeps stay read-only (R4).
- It does not touch the 11 held `job` rows, or any row. Cut ≠ delete, open ≠
  ingest.
