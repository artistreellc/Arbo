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

# ARBO

**AI reception & operations platform for Art-is-Tree LLC** — Hampton Roads, VA.
The nerve center that answers the phone, qualifies and books work, files the
paperwork, covers for Mike in the field, and — over time — generates its own
repeat business from the property history it accumulates.

> **North star:** *Every customer feels like Art-is-Tree's only customer, while
> Mike touches a phone as little as possible.*

This is the **Art-is-Tree hard-coded edition** (per the Master Build Brief §0A).
A parallel white-label edition turns every Art-is-Tree specific into per-tenant
config; features stay in sync across both.

---

## Non-negotiables (law — enforced in code, not just prompts)

- **Service area = exactly four cities:** Virginia Beach, Norfolk, Chesapeake,
  Portsmouth. **Suffolk is never served or mentioned** (blocked by a DB check
  constraint *and* a customer-facing-copy test).
- **Never a price over the phone** — no quote, range, or ballpark; every price
  question pivots to a free in-person estimate.
- **Never diagnose a tree over the phone.** General education, yes; "what's
  wrong with *my* tree," no.
- **Credentials:** licensed & insured, BBB A+ only. **Never claim TCIA.**
- **Never autonomous.** ARBO proposes; Mike approves. It is structurally
  incapable of changing its own rules — improvement is human-reviewed only.
- Guardrails (`src/policy/guardrails.json`) and legal rules
  (`src/legal/compliance.json`) are the **single source of truth**, loaded by
  every layer and validated at boot.

---

## What works today (Phases 0–3 + reception hardening)

**Foundation & data**
- Guardrail + legal policy as validated, loadable config; design tokens; CI;
  secret hygiene (nothing sensitive in the repo).
- Full data spine on a live Supabase project (property "twin", contacts with
  timestamped consent, leads, estimates, jobs, contracts, photos, message/call
  logs, suppression list, Client Master index) — RLS locked to service-role.
- Address normalization so one lot never becomes two twins.
- Per-property Google Drive filing (Estimates / Signed Contracts / Job Photos /
  Documents) — created live in the owner's Drive.

**AI receptionist (the brain)**
- Opens like Mike does — **name first, then the AI/recording disclosure** (§3.10).
- Qualifies the lead (tree/size, proximity to house & power lines, job type),
  asks "had tree work before?", captures a clean lead.
- **Guardrails enforced in code** — an output guard blocks any price/diagnosis/
  forbidden term *even if the model produces it*; the caller can't talk it out
  of the rules.
- **Emergencies** (tree on house/car/line, someone in danger) → instant alert.
- **Incidents** (crew damage, injury, genuinely angry caller) → de-escalates,
  **never admits fault or quotes a repair cost**, live-forwards to Mike's cell +
  urgent alert.
- **"I want a person"** → flagged as a priority relationship call.
- **Spam / sales calls** → screened out, never become a lead — but a real
  customer is *never* mistaken for spam.
- **Lead-quality read** (hot/warm/cool) to prioritize follow-up; "getting
  multiple quotes" is treated as normal serious-buyer behavior, never a down-rank.

**Booking**
- Writes Google Calendar events in Mike's exact format —
  `Client Name - SOURCE - 10-digit phone`, scope in the description.
- **Afternoon-only 30-min estimate slots**, mornings protected for crew jobs.
- ZIP clustering + **recommend-don't-commit** (never auto-books, never
  double-books) — verified live against the real calendar.

**Status:** ~116 tests passing; `npm run check` green. See `PROGRESS.md`.

---

## Roadmap (12 phases, per the expanded brief)

| # | Phase | Status |
|---|-------|--------|
| 0 | Foundation & guardrails-as-config | ✅ done |
| 1 | The data spine | ✅ done |
| 2 | Inbound voice reception (the brain) | ✅ done (+ §3.6–3.29 hardening) |
| 3 | Booking, color-coding & ZIP clustering | ✅ done (colors: learn live map) |
| 4 | **Permitting & CBPA/RPA screening** (never "clear" — always "verify") | ⏭️ next |
| 5 | Inbox monitoring & paperwork automation | ⬜ |
| 6 | Follow-ups & outbound (TCPA-gated) | ⬜ |
| 7 | Location intelligence (geofence, running-late auto-cover) | ⬜ |
| 8 | Daily ops intelligence (morning brief, storm rescheduler) | ⬜ |
| 9 | Predictive Property Intelligence (the centerpiece) | ⬜ |
| 10 | The review loop (human-in-the-loop) | ⬜ |
| 11 | The mobile app & polish (Expo/React Native) | ⬜ |

Later capability layers from the brief (crew app, equipment/parts log,
tree-health assessment, storm war-room, per-job P&L, customer portal, owner
cockpit, wearables) are sequenced across phases 4–11.

---

## Stack

Node + TypeScript backend · **Supabase** (Postgres/storage, system of record) ·
Google Calendar/Drive/Gmail/Maps · **Vapi + Twilio** (voice/SMS — wired at
Phase 2 go-live) · **Railway** hosting · **Expo/React Native** app (Phase 11).
Rationale for every choice is logged in `DECISIONS.md`.

---

## Develop

```bash
cp .env.example .env      # fill in real values; .env is gitignored
npm install
npm run check             # typecheck + lint + tests  (the guardrail suite runs here)
npm run boot              # boots: loads & validates the policy + legal config
```

Requires Node ≥ 20. Secrets never enter the repo — Supabase service-role key,
Vapi/Twilio/Google credentials all live in `.env` / the host's secret manager.

## Project docs

- **`PROGRESS.md`** — every task, its status, its test result.
- **`DECISIONS.md`** — every non-obvious choice and why (the map out of any
  future rabbit hole).

Build one clean phase at a time. Audit every five tasks. Ask before you guess.
