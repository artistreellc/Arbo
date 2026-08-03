<!--
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
-->

# Doc Scan tool — Step Zero reconciliation

**Status: AWAITING MIKE'S APPROVAL. No doc-scan code has been written.**

Per `docs/DOC_SCAN_TOOL_SPEC.md`, this table comes before any code. Authority
order: live brief wins → the spec prompt → nothing else. The spec is an
**ADD-ON**; anything already in the brief or already built, the existing thing
wins and the tool becomes its intake rather than a second implementation.

Classification: **DUP** already exists · **EXT** extends something that exists ·
**NEW** genuinely new · **CONFLICT** needs Mike's ruling · **OUT** out of scope.

---

## What already exists in the codebase

Found before classifying, so nothing gets rebuilt:

| Thing | Where | State |
|---|---|---|
| `contract` table — `property_id`, `estimate_id`, `job_id`, `signed`, `drive_file_id` | `0001_data_spine.sql` | Live |
| `convertEstimateToJob()` — creates job + contract row, marks estimate won, returns the calendar event id for the Sage recolor | `src/db/repositories.ts` | Live, tested |
| `'Signed Contracts'` as a standard property subfolder | `src/integrations/drive.ts` (`PROPERTY_SUBFOLDERS`) | Live |
| `ensurePropertyFolders()` + `propertyFolderName(address, city)` | `src/integrations/drive.ts` | Live |
| `estimate.agreed_amount` — the human-written signed figure | `0012` migration | Live |
| §3 never-price, enforced at the source | `src/ops/invoicing.ts` | Live, tested |

---

## Reconciliation table

| # | Spec item | Class | Ruling |
|---|---|---|---|
| 1 | Camera capture / upload, single or batch | **NEW** | No capture surface exists. Build it. |
| 2 | Auto-deskew, auto-rotate, auto-crop | **NEW** | Build. Pure image work, no brief conflict. |
| 3 | Archive scan **plus retained original** | **NEW** | Build. The "never keep only the compressed copy" rule becomes a structural guarantee: the write path stores two files or it fails. |
| 4 | Completeness check; refuse a scan missing the Approved/Date signature block | **NEW** | Build. This is the §1B pattern applied to paper: a scan that cannot prove signature is not evidence, and must be NAMED as such rather than filed and forgotten. |
| 5 | OCR field extraction with per-field confidence | **NEW** | Build. Low-confidence fields shown for correction, never silently guessed. |
| 6 | "Never invent a dollar total" | **DUP** | Already law (§3) and already structural — `estimate.agreed_amount` is human-written and `POST /api/invoices` refuses to take an amount from a request. The scan tool inherits this; see CONFLICT-A. |
| 7 | Auto-naming `<street> <city-abbrev> <total>` | **NEW** | Build as a pure, tested function. Every rule in the spec is a real error from the current folder, so each gets its own test. |
| 8 | Confirm screen; nothing files without Mike | **EXT** | The never-autonomous principle (§5B #1) already governs every write surface in Arbo. This extends it to filing. Consistent — no new principle. |
| 9 | Save to the Signed Contracts Drive folder | **DUP (extend)** | The folder and the ensure-folders helper already exist. The tool WRITES INTO the existing structure; it does not invent a second one. |
| 10 | Convert matching estimate → job, link doc to job + client record | **DUP** | `convertEstimateToJob()` already does exactly this and is tested. **The scan tool is its INTAKE, not a reimplementation.** It supplies `contractDriveFileId` to the existing function. |
| 11 | Duplicate detection (address + total + date) | **NEW** | Build. Mirrors the cycle-7 lesson: warn before a second copy, and let the DB settle races where it can. |
| 12 | Backfill sweep — report only | **NEW** | Build as strictly read-only. It must be incapable of renaming or moving, not merely instructed not to. |
| 13 | Never delete / rename / move without per-file approval | **DUP** | Already the standing law in `docs/OPS_SWEEP.md`. Restated here, not re-invented. |
| 14 | Unsigned proposal needs a deliberate override to reach Signed Contracts | **EXT** | `contract.signed` already exists as a boolean. Extend: the holding state and the override gate are new; the flag is not. |
| 15 | Admin login only (§8C) | **DUP** | §8C roles + RLS are live and proven by impersonation (D53/D56). The tool sits behind the existing admin door; no new access model. |

---

## CONFLICT-A — needs Mike's ruling before code

**The OCR total vs. §3 "Arbo never sets a price".**

The spec asks the tool to extract the **Job Proposed Total** from the form.
Cycle 7 established that a price only becomes real when a human writes it —
`estimate.agreed_amount` exists precisely so no machine-derived number can
become an invoice amount.

These are reconcilable, but only one way, and I want it stated rather than
assumed:

- **Proposed reading (what I would build):** OCR *proposes* the total on the
  confirm screen. It is not written anywhere until Mike confirms it. The value
  Mike confirms becomes `estimate.agreed_amount`. If the total is unreadable,
  the field is blank and Mike types it — the tool never fills it from a guess,
  and a low-confidence total is flagged rather than pre-filled.
- **Why it matters:** if the OCR total were written straight through, Arbo
  would be setting a price from a photo, and every invoice built on it would
  inherit a machine-read number. The confirm tap is what makes it Mike's figure.

**Ruling needed:** confirm the proposed reading, or say how you want it.

## CONFLICT-B — smaller, but a real fork

**Where the scanned doc's property comes from.** The form carries an address;
the property twin dedupes on a normalized address (`upsertProperty`). A scanned
address that does not match an existing twin could either (a) create a new
property, or (b) be held for Mike to match against an existing one.

**Proposed reading:** (b). Address OCR is exactly where a typo becomes a
duplicate twin, and D12's dedupe rule exists to stop that. Hold and ask.

---

## Open question for Mike

City abbreviations in the filename are given as **Nor / VB / Ches / Ports**.
That is four cities and matches the service area exactly — confirming there is
no fifth abbreviation in the existing folder I should know about (a Suffolk
abbreviation would be a problem, since Arbo holds no Suffolk license).

---

## Acceptance checklist (from the spec, tracked here)

- [ ] Reconciliation table produced and approved before any code ← **you are here**
- [ ] Photographed signed contract → confirm screen → correctly named file in Signed Contracts + estimate converted, under a minute
- [ ] Cut-off scan (signature block missing) refused with a re-shoot prompt
- [ ] Sideways photo files correctly oriented
- [ ] Saved file verified re-openable after upload (no silent corrupt files)
- [ ] Unsigned doc cannot reach Signed Contracts without explicit override
- [ ] Backfill sweep reports the known bad titles without touching any file
