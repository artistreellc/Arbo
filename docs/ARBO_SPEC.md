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

# Arbo — Working Spec

Derived orientation document in Mike's 9-section format, written 2026-08-02.
The Master Build Brief (live Arbo edition, 206 headings) is the law; where this
file and the brief disagree, the brief wins. This file tracks what EXISTS and
what's NEXT, in plain language, and is updated every build cycle.

## 1. What this is

Arbo is the nerve center for Art-is-Tree, a four-city Hampton Roads tree
service — not a phone bot. One brain that answers and qualifies every call,
books the calendar the way Mike actually runs it, screens every address for
permit risk before anyone quotes or cuts, keeps a living profile (a "twin") of
every property and its trees, chases nothing without Mike's approval, watches
the weather, closes the loops the day leaves behind, prices work against real
truck-to-truck economics, trains and protects the crew, and hands Mike the
whole business at a glance in a dark mission-control app. The predictive layer
— knowing which trees are coming due before the customer calls — is the moat,
built on data every earlier phase captures.

## 2. Users and context

- **Mike (admin, the only user today):** owner-operator, on an iPhone in the
  field most of the day, on a desktop at night. Gloved hands, direct sunlight,
  thirty seconds between jobs — every surface is one-glance, big-target,
  one-tap. Reviews everything; nothing customer-facing sends itself.
- **Crew (next):** field hands on phones, English and Spanish. They get their
  half only: work orders, maps, training, their own record — never customers,
  pricing, tracking, or anyone else's data (§8C hard ceiling).
- **Customers (indirect):** talk to the receptionist by phone/text/web; later
  get a magic-link portal for their own property only. Never see internals.
- **Context:** Virginia Beach, Norfolk, Chesapeake, Portsmouth — nowhere else,
  ever (the database physically rejects other cities). ~350–400 jobs/yr.
  Real infrastructure: Gmail, Google Calendar, CallRail notification emails
  (no API), Google Ads lead forms, LSA, a formsubmit.co web form.

## 3. Guardrails

The five absolutes, enforced as CODE (a deterministic policy engine inspects
every human-reaching message; the LLM cannot be talked out of them):
1. **Never a dollar amount** to a customer — always the pivot to a free estimate.
2. **Never diagnose a tree** remotely — "we'd want to see it in person."
3. **Never promise a date or time** until Mike confirms it.
4. **Never claim credentials not held** — licensed & insured + BBB A+ only;
   the strings "Suffolk" and "TCIA" fail the build if they appear customer-facing.
5. **Strictly on-topic** — trees, scheduling, the customer's property.

And the structural laws around them: TCPA consent + permanent STOP + 8am–9pm
quiet hours gate every outbound touch (a blocked send at 2am sends NOTHING,
not even a pivot); no agent can spend money, send a legal commitment, or
terminate anything (human-only tool tiers); customer PII never appears in
logs or chat; a permit screen can never say "you're clear" — only PERMIT
LIKELY / REVIEW NEEDED / NO OVERLAY–VERIFY; a dead feed is always NAMED,
never rendered as a reassuring zero; crew never see tracking, pricing,
footage, or each other's records; quiz time is paid time (§4.6); invoices
are capped at the VA-safe 5% late fee by a database constraint.

## 4. Scope

**CONFIRMED — live now:** receptionist logic with guarded output + ElevenLabs
voice bridge; lead capture from every real channel with hot/warm/cool read,
spam screen, repeat-customer memory; permit screening (all 4 cities' GIS,
RPA/125-ft logic, packet records, Gmail permit-history mining); booking brain
rules + calendar sync (hourly ops sweep); follow-up queue (recommend-only,
legally gated); storm watch on the NWS feed with at-risk flagging; location
intelligence (owner-consented, work-hours-only, visit confirmation,
running-late drafts); growth forecasting over the twin; morning brief; review
loop logging; full 27-entity data spine; the binder (event bus, policy
engine, tool registry, agent audit log); Loop-Closer agent (open loops:
quiet estimates, unbooked wins, unclosed jobs, un-returned callbacks);
Permitting + Owner-Briefing agents (deterministic cores, audit-logged,
Opus judgment activating with the key now on the server); estimating engine
($1,000/$700/hr targets, crew-scaled $5k floor, leakage re-derived from
actuals); the cockpit HUD app.

**CONFIRMED — next (build order in §8):** remaining wave-1/2 agents; crew
app + §8C roles/RLS; fleet units + Bouncie; training engine surfaces; P&L;
neighborhood analytics; marketing engine; AR (iOS-first RealityKit per
D51) — boundary overlay first, pruning guidance second; customer portal;
white-label per-tenant config.

**DEFERRED:** new-hire onboarding sequence (6M.13 — data model ready, build
later); Spanish training delivery (needs Mike's go); POV glasses/bodycam and
helmet-cam ambient scanning (Phase 2 + attorney review); Field Measurement
Engine (§6X — separate product, doorway only).

**EXPLICITLY OUT:** fully autonomous self-rewriting learning; win-back
nudges to cold estimates ("customers who went with someone else don't want
to be chased"); auto-ordering parts / storing a vendor card (deliberately
rejected); anything that quotes prices, diagnoses trees, or files permits
without a human.

## 5. Data model

27 core entities live in Supabase Postgres, RLS-locked to the service role:

- **The customer spine:** Property (the twin, deduped on normalized address,
  4-city constraint) → Tree (species, size, last service, next-due forecast)
  → Contact (phones, consent record, opt-out, first-timer flag) → Lead →
  Estimate (visit-confirmed, outcome, follow-up state) → Contract → Job
  (calendar event id, color, status) → Invoice (5% cap) → Photo, Message log,
  Call log, Permit (+ permit correspondence), Site Condition Record,
  Change Order, Work Order.
- **The crew spine:** Crew Member → Certification (expiry nudges), Time Entry
  (training time payable by design), Training Item (can't publish unvetted;
  near-miss-derived items excluded from scoring by trigger), Training Event
  (carries its time entry), Near Miss (blameless), Reference Entry.
- **The business brain:** Neighborhood Area + Area Performance (job-factor-
  normalized, never naive averages), Behavior Profile (admin-only),
  Campaign, Keyword, Equipment Unit (VIN-keyed) + Parts + Tool (two
  inventories, never merged) + Maintenance Task (photo proof required to
  close, by CHECK constraint), Leakage Event (repair vs damage split).
- **The binder:** Event (durable ordered bus) + Event Cursor, Agent Run
  (every agent decision audited), app_user (admin/crew role groundwork).

Relationships flow one way: everything hangs off Property and Crew Member;
agents share state and events, never private memory.

## 6. Screens and flows

The app is one self-contained file served by the backend, key-gated, §9
cockpit design (near-black, luminous purple, mono numerals, 48px+ targets).

- **Today (home / HUD):** six instrument tiles — stops, jobs, estimates,
  open loops (red when urgent), coming due, agent runs — each fed
  independently and honest ('–' when its feed is dead); storm banner;
  tracking toggle + running-late draft; Yard-check button; top-3 open
  loops; the day's route (one tap into Google Maps) and stop cards.
  *Writes:* tracking on/off, location pings.
- **Leads:** worst-first inbox (emergency → callback-needed → hot). Each
  card: history line, permit flag, quality read, tap-to-call, ✓ qualify /
  ✗ spam. *Writes:* lead status.
- **Book:** coming-due money list + every property; tap → the twin sheet
  (trees, permits, history, city correspondence). *Writes:* none (read).
- **Queue:** open loops first (silence is never success), then recommended
  sends with the legal-gate hold count. *Writes:* "Mark sent ✓" — the only
  way a cadence advances.
- **Calls:** every conversation with guard flags. *Writes:* mark reviewed.
- **Yard check (sheet):** job type, truck-to-truck hours, crew, quote,
  labor rate → verdict (ON TARGET / BELOW TARGET / LOSES MONEY) with the
  drivers named. Internal only. *Writes:* none.
- **Coming:** crew app screens (work order, gated briefing, clock, profile
  with private pay tab), owner live map, AR camera views.

## 7. Architecture

- **One backend service** (Node/TS, zero frameworks — node:http + tested
  handlers), identical on Railway (live: arbor-server-production.up.railway.app)
  and Vercel (arborgrow.app — stale pending connector re-grant).
- **Supabase Postgres** system of record (RLS, service-role only);
  **Google Drive** the filing cabinet; **Google Calendar** the scheduling
  truth (two-way; Mike's manual edits win).
- **The binder (§8A.6):** shared DB + event bus + typed tool registry +
  policy engine + audit log. No orchestration framework, no agent-to-agent
  calls, no fine-tuning, no vector DB in phase 1.
- **Models (owner decision, standing):** Claude Opus 5 is the brain for
  every judgment call — safety, legal, permits, pricing, training never
  downgrade. Sonnet-class for bulk drafting; fast tier for live voice turns
  only. Vendors consolidated: Anthropic + Twilio + Deepgram (Gemini
  emergency fallback). One thin model adapter; role → model from config.
- **Voice:** ElevenLabs bridge today; locked target Twilio ConversationRelay
  + ElevenLabs TTS + Deepgram STT (Retell fallback only).
- **Specialists (8B.2):** Pl@ntNet species ID, iPhone-LiDAR DBH, allometric
  green weight (human sign-off required), Trimble + OR-Tools truck routing
  (hard clearance blocks), NWS + Tomorrow.io weather, Regrid parcels,
  XGBoost-class forecasting (never an LLM), on-device vision → Opus.
- **AR (D51):** iOS-first — ARKit + LiDAR + RealityKit. Expo/React Native
  remains the cross-platform shell for everything non-AR.
- **Integration seams:** Gmail/Calendar via MCP-driven ops sweep (hourly);
  CallRail/Ads/LSA parsed from notification emails; Square, QuickBooks,
  Docusign, Bouncie, GBP arrive as modules behind the same policy engine.

## 8. Build plan

Cycles run continuously (build → test → adversarial review → deploy →
verify), pushed to main and deployed to Railway on each pass.

- **Cycle 1 (done):** full data spine + binder + Loop-Closer + estimating.
  ✅ 25 tables live · policy-engine matrix tested · /api/queue + yard check
  live · 317 tests green.
- **Cycle 2 (done, this doc's cycle):** HUD home + wave-1 agents #4/#13 +
  adversarial review (5 findings fixed, incl. a date-promise guardrail
  bypass). ✅ 321 tests green · screenshots reviewed · Opus key installed.
- **Cycle 3:** agents #2 Booking/Dispatch + #9 Weather on the binder; agent
  sweep on the hourly schedule; desktop HUD polish. ✔ when: agent_run shows
  scheduled runs; booking suggestions pass the policy engine; no duplicate
  events on repeated sweeps.
- **Cycle 4:** §8C for real — Supabase Auth, admin/crew roles, RLS policies.
  ✔ when: a crew login provably cannot query one admin field (test, not
  assertion).
- **Cycle 5:** crew app v1 — work-order push, one shared clock, gated
  briefing (scroll + checkbox + timer), safety-packet e-sign EN/ES. ✔ when:
  a briefing cannot be skipped and every gate completion writes a payable
  time entry.
- **Cycle 6:** fleet — unit records UI, breakdown flow (photo → DOWN →
  action plan), Bouncie ingest stub → live. ✔ when: a DOWN unit blocks
  scheduling and a maintenance task cannot close without a photo.
- **Cycle 7:** P&L + leakage dashboards; neighborhood analytics v1 with
  job-factor normalization. ✔ when: quoted-vs-actual renders for real jobs
  and no naive per-area average appears anywhere.
- **Then:** marketing engine, customer portal, AR track (boundary overlay
  first), white-label tenancy — each with its own acceptance gate, each
  logged in DECISIONS.md.

## 9. Open questions

1. **Vercel access** — reconnect the Vercel connector with all-projects
   scope so arborgrow.app catches up to Railway. *Decision: Mike (dashboard).*
2. **6B.VB** — the Virginia Beach permit-process subsection lost with the
   dead chat: reconstruct from the 22 mined real VB approvals? Needs your
   sign-off to draft. *Decision: Mike.*
3. **C26 revisit-triggers note** — approved addition to §8A.2 (both
   editions); needs the .md brief editions to write into (PDF can't be
   edited). *Blocked on: Mike supplying the .md files.*
4. **Friday questionnaire: 10 or 15 questions?** (6M.3 vs 6V.5 — the brief
   conflicts with itself.) *Decision: Mike, before Cycle 5.*
5. **Win-back tension** — 5B cuts win-back nudges; 3.24 re-opens cold
   estimates. Which governs? *Decision: Mike, before the marketing cycle.*
6. **6E one-tap reorder vs 6E2.3 no-stored-card** — building to 6E2.3
   (list + deep-link, human buys) per the later decision; formal ruling
   wanted. *Decision: Mike, before Cycle 6.*
7. **Crew/Fleet spec canonization** — confirm CREW_SYSTEM_SPEC.md and
   FLEET_MANAGEMENT_SPEC.md as canonical doc-set additions. *Decision: Mike.*
8. **Missing docs** — WhiteLabel brief (.md), SAFETY_AGENT_SPEC.md,
   OPEN_DECISIONS.md, Arbo_Kickoff_Prompt.md still wanted. *From: Mike.*
9. **Paycheck-unlock legality** (Friday gate) and **clock-out gating** —
   built as config flags DEFAULT OFF pending bookkeeper/attorney sign-off
   (§4.6). *Decision: counsel, then Mike.*
