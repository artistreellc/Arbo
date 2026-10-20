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

## The credential door — outside the business links (Mike, 2026-10-20)

Mike, 2026-10-20: *"Yes, allow the sign-in row"* (R31, answered). One door
reaches Supabase while the business links stay cut, and it is not one of
them:

- **One table**, `integration_credential` (migration 0021, applied live
  2026-10-20 and checked: RLS on, 0 policies, no anon/authenticated access).
  One row per outside service, and the only one allowed is Bouncie: its
  sign-in, once Mike taps Connect Bouncie (0 rows until then). No customer,
  lead, job, call or truck position.
- **Sealed rows.** Each value is encrypted (AES-256-GCM) before it leaves
  the server, under a key derived from the provider's client secret, which
  lives only on Railway — the database or the service-role key alone cannot
  open it.
- **Its own switch**, `ARBO_LINK_CREDENTIALS`, open only when exactly `live`
  (same fail-closed rule as every link; set at deploy on Mike's yes). It is
  not `ARBO_DATA_LINKS` and opens no business link or agent sweep; the
  master switch does not open it either.
- **One door**, `src/db/credentialStore.ts`: it addresses that table and
  nothing else, and `getDb()` refuses the table by name (it is in no list
  in `src/db/links.ts`), so neither door reaches the other's tables.

It sits outside the business links by Mike's 2026-10-20 ruling: it holds
Arbo's own sign-in, not company data, so the verification steps below — and
§3's import gate — are about the business links, and opening this door
imports nothing.

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

**Step 1 (migrations):** 0016–0018 were unapplied at review time — applied
via the Supabase migration tooling this pass; `list_migrations` now covers
every file in `supabase/migrations/`.

**Step 2 (Supabase the correct way):** RLS is ON for all 50 public tables;
every policy targets `authenticated` only. The security advisor flagged five
SECURITY DEFINER functions callable by `anon` (anyone with the publishable
key) — closed by 0019. What the advisor still reports, and why it stays:
- *RLS enabled, no policy* (INFO) on the 7 tables from 0017/0018 — correct:
  service-role only, deny-all to everyone else, same as §4.3 intends.
- *Signed-in users can execute SECURITY DEFINER* (WARN) on the four
  `arbo_*` helpers — required: the `authenticated` policies call them.
- Performance INFO/WARN (unindexed FKs, unused indexes, multiple permissive
  policies) — immaterial at dozens of rows; revisit when volumes grow.

**New tables not yet in any link:** `property_access_consent`,
`risk_assessment`, `ar_capture_session`, `prune_estimate`, `prune_plan`,
`locate_ticket`, `utility_marking`. No code queries them yet, and the door
refuses unmapped tables — they join a link when code that reads them ships.

## READ-ONLY mode — `ARBO_DATA_LINKS=readonly` (R32, 2026-10-20)

Mike: *"give arbo and its agents read only data access and run systems checks
every couple hours while you contuin to build"*.

**What it is.** A third exact value for the master switch. Arbo and its agents
READ the named links below with no `ARBO_LINK_*` variable, and **write nothing,
anywhere**. Exactly `readonly` — `READONLY`, ` readonly`, `read-only` and every
other spelling leave everything CUT (fails closed, like `live`). It can never be
taken for `live`: three different strings, one value at a time.

**How it holds** (`src/db/client.ts`, `readOnlyDb()`), so a caller that forgets
to check still cannot write:
1. the read-only client hands out `from` and nothing else — `rpc`, `schema`,
   `storage`, `functions`, `channel`/realtime, `auth`, `rest`, even
   `constructor` are refused by name (`ReadOnlyError`);
2. a table passes the same link check as live, then hands out `select` only —
   `insert` / `upsert` / `update` / `delete` are refused by name. A table a
   select EMBEDS (`jobs:job(count)`, `property:property_id(zip)`) passes the
   link check too, so a link kept cut stays cut inside another link's read;
3. its fetch lets only GET and HEAD leave.

A refused tap answers `503 { error: 'read_only', line }` — the line is
**"Read-only: Arbo can look but not save. Nothing was written."** — and the app
shows it. `live` is untouched: it uses its own client and door, exactly as before.

**What it reads:** contacts, properties, leads, estimates, location, crew,
equipment, safety, ops.

**What stays CUT in read-only, and why** (`READ_ONLY_KEPT_CUT`, `src/db/links.ts`):

| Link | Why it stays cut |
|---|---|
| calls | Sona's calls live in Quo, not these tables — an empty call log would read as "no calls yet" (R21, §1B). |
| photos | Nothing in the app files a photo yet — an empty table would read as "no photos" instead of "not built". |
| jobs | HELD: the 11 mistaken `job` rows (§3, R29). Until a count check shows Mike's delete ran, they would render as booked work orders and open loops. Keeping jobs cut also keeps the Book's property list (it embeds job counts), the brief, the queue, money and crew work orders named as "cut on purpose". |
| permits | HELD: `permit_correspondence` holds rows no Arbo code writes (0 at the 2026-09-24 check). Step 3 above — shut until Mike says where they came from. |

Opening one of these in read-only is a one-line change to that list, after
Mike rules — never a variable flipped on the way past.

**What the background writers do instead** (each named, counted in
`GET /api/links` → `notSaved`, kinds and counts only; resets on a redeploy):
- the hourly sweep still runs every agent (R4: sweeps are read-only by rule);
  their `agent_run` rows are not written — the runs are kept in memory, marked
  `saved: false`, and the Today tile says "not saved — read-only". An agent
  that needs a kept-cut link fails by name every run (booking and collections
  need `jobs`, permitting needs `permits` — never "0 screens missing"), and the
  safety agent names an empty crew roster as a blind spot, never an all-clear;
- bus events and the permitting agent's cursor are not written (the cursor
  re-reads the same batch next hour — once a sweep, never a loop);
- `GET /api/forecast` and `GET /api/location/day` still answer; their
  write-throughs are skipped and the body says `saved: false`;
- the phone's location ping is refused `503 read_only`;
- the seed refuses a read-only database.

**Old rows never pose as new work.** A lead older than 14 days
(`src/ops/leadAge.ts`) lights no EMERGENCY alarm, no tab badge, no "Call back
needed" and no open loop, and Talk does not list it. It shows on Leads under
"Older leads", with its date and no Call back button.

**An empty lead list is not an empty inbox.** Nothing in the app files a lead
(R4 — Mike handles them), so on real data Leads says "New leads are not in
Arbo" (Sona's are in Quo, website and ad leads in Gmail) instead of "No new
leads", and Talk says the lead list is not fed instead of "none open". Only the
practice data (`sim`) still says "No new leads".

**What it does NOT change.** Nothing is imported (§3). R18 calendar holds, R22
texts, the Quo intake and study, Bouncie and the webhooks run on their own
switches and never touched these tables — read-only does not turn them on or off.

**Turn it ON** (Mike's call, like every link):
1. Confirm `APP_ACCESS_KEY` is set on Railway — with no key the `/api` door
   stays LOCKED in read-only (real rows are never keyless), so the app would
   show only the key wall.
2. Confirm the Supabase project is active (a paused project reads as "couldn't read it").
3. Set `ARBO_DATA_LINKS=readonly` on Railway. Deploy manually by full SHA.
4. Verify: the boot line reads `db READ-ONLY (ARBO_DATA_LINKS=readonly) —
   reading real data, writing nothing. Readable: … Kept cut: …`; `/health`
   says `dataLinks: "readonly"`; `/api/links` names each link `read-only` or
   `cut` with its reason; Settings and Today show the read-only line.

**Turn it OFF:** set `ARBO_DATA_LINKS` back (delete it → everything cut, or
`live` once Mike opens links one by one) and redeploy. There is nothing to undo
— nothing was written.

## What connecting a link does NOT do

- It does not import anything. §3's import gate stands: nothing involving
  active company activity flows IN without its own ruling from Mike.
- It does not change sweep behavior: sweeps stay read-only (R4).
- It does not touch the 11 held `job` rows, or any row. Cut ≠ delete, open ≠
  ingest.
