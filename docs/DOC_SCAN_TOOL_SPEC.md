<!--
  ═══════════════════════════════════════════════════════════════════════
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
-->

# ARBO MODULE BUILD PROMPT — DOC SCAN & AUTO-FILE TOOL (Admin Dashboard)

**Slot in brief sequence:** Admin Dashboard module prompts (alongside AR_PERMIT_OVERLAY_SPEC, CREW_SYSTEM_SPEC, FLEET_MANAGEMENT_SPEC).
**Authority order:** Live brief (`Arbo_Master_Build_Brief.md` / `_WhiteLabel.md`) wins → this prompt → nothing else. Do not restate brief content; point into it.

---

## STEP ZERO — MANDATORY, BEFORE ANY CODE OR WRITING

Run the reconciliation protocol from `ARBOR_CLAUDE_CODE_KICKOFF` / `START_HERE.md` first:

1. Use `BRIEF_INDEX.md` to locate every existing section touching paperwork filing, signed-contract photo handling, estimate→job conversion, Client Master DB, Drive integration, and admin-dash layout (including the signed-contract-photo → estimate-converts-to-job flow and Sec 8C admin/crew roles).
2. Itemize everything in this prompt and classify each item DUP / EXT / NEW / CONFLICT / OUT against the brief.
3. This prompt is an **ADD-ON**, not a rewrite. Anything already in the brief: the brief wins. Surface conflicts to Mike before writing.
4. Write into BOTH editions per the standing rule.

---

## WHAT TO BUILD

A **Doc Scan tool inside the Arbo admin dashboard** (admin login only, per Sec 8C). Mike photographs or uploads a signed proposal/invoice; Arbo cleans it, reads it, names it correctly, and files it — with Mike confirming before anything lands.

### 1. Capture
- Camera capture or upload (photo or PDF), single or batch.
- Auto-deskew, auto-rotate to portrait, auto-crop to the form.
- Archive output: compact high-contrast scan (current practice: ~900 px 1-bit) PLUS retain the original photo. Never keep only the compressed copy.

### 2. Completeness check (reject bad scans at the door)
Warn and ask to re-shoot when:
- Any edge of the form is cut off — **especially the Approved/Date signature block at the bottom** (a scan without the signature block is not evidence of anything).
- Page is sideways or upside down and can't be auto-corrected.
- Image decodes as blank/black or the file is corrupt (verify the saved file re-opens before calling it filed).
- Total, name, or address is unreadable at archive resolution.

### 3. Field extraction (OCR of the standard form)
Extract: Name, Address, City + Zip, Phone, Date of estimate, service checkboxes A–H, Job Proposed Total, Crew needed, and **signature present? / date signed present?** Handwriting confidence is scored per field; low-confidence fields are shown for correction, never silently guessed. **Never invent a dollar total.**

### 4. Auto-naming (the file title convention)
Generated title: `<street> <city-abbrev> <total>` — street lowercase without house number, city abbreviation (Nor / VB / Ches / Ports), total as plain digits, no `$`. Example: `gallahad dr VB 3100`.
Hard rules the tool enforces (all are real errors from the current folder):
- Street-first, never client-name-first (fix the "Moore Holland VB $1400" pattern).
- No `$` in the title, no run-together typos ("YeatesbVB").
- Never file under a scanner default name ("Adobe Scan Jul 26…").
- Client name is spell-checked against the extracted form text (the "Cove"/"Condo" class of typo) — title text must match what's written on the form.
- Always include the file extension.

### 5. Confirm screen (human in the loop)
One screen: cleaned scan on the left, extracted fields + proposed filename + destination on the right. Mike taps Confirm, edits, or Re-shoot. **Nothing files without confirmation.** No auto-delete of anything, ever.

### 6. Filing (on confirm)
- Save to the **Signed Contracts** Drive folder (unsigned proposals get an explicit "not signed yet" flag and a holding state — filing an unsigned doc into Signed Contracts requires a deliberate override).
- Convert the matching estimate → job and link the doc to the job + Client Master DB record, per the flow already in the brief (DUP-check this against the brief; the conversion logic likely already exists — this tool is its intake).
- Duplicate detection: same address + same total + same date ⇒ warn before filing a second copy.

### 7. Backfill sweep (one-time utility, admin-triggered)
Scan the existing Signed Contracts folder and report (report only — never rename or move on its own): titles violating the convention, scanner-default names, files outside the folder that look like contracts, corrupt/unopenable files, scans missing the signature block.

---

## ACCEPTANCE CHECKLIST
- [ ] Reconciliation table produced and approved before any code.
- [ ] A photographed signed contract goes camera → confirm screen → correctly named file in Signed Contracts + estimate converted, in under a minute.
- [ ] A cut-off scan (signature block missing) is refused with a re-shoot prompt.
- [ ] A sideways photo files correctly oriented.
- [ ] Saved file verified re-openable after upload (no silent corrupt files).
- [ ] Unsigned doc cannot reach Signed Contracts without explicit override.
- [ ] Backfill sweep reports the known bad titles without touching any file.

## NEVER-DO LIST
- Never auto-file without the confirm screen.
- Never delete, rename, or move an existing file without explicit per-file approval.
- Never fabricate a field value or total; unreadable = ask.
- Never keep only the compressed copy; the original photo is retained.
- Never write into the brief without the Step Zero reconciliation.
