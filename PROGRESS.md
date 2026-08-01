# PROGRESS

Every task, its status, its test result (brief §0, rule 6).
Legend: ☐ todo · ◐ in progress · ☑ done (test passing)

## Phase 0 — Foundation & guardrails-as-config

| # | Task | Status | Test |
|---|------|--------|------|
| 0.1 | Repo scaffold + docs seeded (README, PROGRESS, DECISIONS, .gitignore) | ☑ | n/a (structure) |
| 0.2 | Env/secrets handling (.env gitignored, .env.example, secret hygiene) | ☑ | `secrets.test.ts` — repo has no secrets |
| 0.3 | Supabase project connection wired via env; app boots & reports config | ◐ | `boot.test.ts` — boot loads configs ✓ (live Supabase pending real keys) |
| 0.4 | `policy/guardrails.json` authored (§3 source of truth) | ☑ | `guardrails.test.ts` |
| 0.5 | `legal/compliance.json` authored (§4 source of truth) — **AUDIT after this task** | ☑ | `legal.test.ts` |
| 0.6 | Config loader + Zod schemas validate both configs at boot | ☑ | `guardrails.test.ts`, `legal.test.ts` |
| 0.7 | Forbidden-string guard (Suffolk / TCIA) fails build on violation | ☑ | `forbiddenStrings.test.ts` |
| 0.8 | Design tokens (§9: color/type/spacing/radius) delivered + documented | ☑ | `designTokens.test.ts` |
| 0.9 | CI (GitHub Actions): install → typecheck → lint → test → secret-scan | ☑ | CI workflow runs `npm run check` |
| 0.10 | Phase 0 audit (§11) + docs updated; present & stop for sign-off | ☑ | audit passed (see below) |

## Phase 0 audit (§11) — result

Run at Phase 0 end. `npm run check` green: 28 tests pass, typecheck + lint clean; `npm run boot` succeeds.

1. **Guardrails intact?** ✅ price/diagnosis/credential(no-TCIA)/service-area(no-Suffolk) suites pass.
2. **Legal gates intact?** ✅ consent, quiet-hours (8–21), STOP-suppression, disclosure line all present & unit-tested. (Runtime enforcement lands with the first outbound feature, Phase 5 — gates are configured now.)
3. **Tests green?** ✅ 28/28, none skipped.
4. **No regressions?** ✅ n/a (first phase).
5. **Data integrity?** ✅ n/a (schema is Phase 1).
6. **Secrets clean?** ✅ `secrets.test.ts` scans the tree — no secret-shaped strings; `.env` gitignored.
7. **Docs current?** ✅ PROGRESS + DECISIONS reflect reality (incl. D7a discovered this phase).
8. **Scope honest?** ✅ nothing from 5B (OUT) or 5C (optional) built.
9. **Rabbit-hole check?** One open item, named not silent: live Supabase connection (task 0.3) awaits the real project + keys — see O1/O3 in DECISIONS. Everything else is complete and tested.

**Acceptance (Phase 0):** app boots; policy + legal config load and are
unit-tested; secrets never in repo; docs seeded; design tokens delivered.

### Notes
- 0.3 resolved: dedicated Supabase project **`arbor`** (`wdpyysgxmwvvoyveihum`,
  us-east-1) created and live. Boot + config validation complete and tested.

## Phase 1 — The data spine

| # | Task | Status | Test |
|---|------|--------|------|
| 1.1 | Dedicated Supabase project `arbor` provisioned (free tier) | ☑ | project ACTIVE_HEALTHY |
| 1.2 | §7 schema + migrations applied (13 tables, RLS service-role-only) | ☑ | `list_tables` — all present, RLS on |
| 1.3 | Service area enforced in DB (city CHECK; Suffolk impossible) | ☑ | live: Suffolk insert rejected by constraint |
| 1.4 | Address normalization — no double twins (§12) + ZIP capture | ☑ | `address.test.ts` (8) |
| 1.5 | Supabase service-role client wiring | ☑ | `boot.test.ts`; typecheck |
| 1.6 | Repository CRUD (property/contact/lead/estimate/job/contract/photo) | ☑ | `spine.integration.test.ts` (guarded) + live SQL chain verified |
| 1.7 | Function search_path hardening (advisor 0011) — **AUDIT after this** | ☑ | `get_advisors` security clean |
| 1.8 | Google Drive per-property folders + Client Master index writes | ☑ | `drive.test.ts` (3) + **live folders created in owner's Drive** |
| 1.9 | Phase 1 audit (§11) + docs | ☑ | audit passed (below) |

**Acceptance (Phase 1):** create Property/Contact/Estimate/Job/Photo/Contract
end-to-end ✅ (verified live); **Drive folders auto-create per property** ✅
(live "ARBOR Clients" tree created in the owner's Drive; idempotent code + tests).
Production runtime auth for the Drive API (service account vs OAuth) is wired at
deploy — see DECISIONS O3.

## Phase 3 — Booking, color-coding & ZIP clustering

| # | Task | Status | Test |
|---|------|--------|------|
| 3.1 | Auth-agnostic Google Calendar client (list/create events) | ☑ | typecheck; live create+delete verified |
| 3.2 | Color mapping per event kind (avoids the payment red /11) | ☑ | `scheduling.test.ts` |
| 3.3 | Availability: working days/hours, realistic-day factor, no double-booking | ☑ | `scheduling.test.ts` |
| 3.4 | ZIP/route clustering — same-ZIP work scored higher | ☑ | `scheduling.test.ts` |
| 3.5 | Scheduler: recommend ranked slots, **never auto-commit** (§5A #11) — **AUDIT** | ☑ | `scheduling.test.ts` |

**Acceptance (Phase 3):** a booked estimate lands **color-correct** (verified
live: colorId 9 estimate created on the real calendar, then deleted), clustered
near same-ZIP work, **without double-booking**; recommendations **require
explicit approval** (booking throws otherwise). 98 tests pass.

### Phase 3 audit (§11) — result
94→98 tests pass, typecheck + lint clean. Guardrails/legal ✅ (unchanged, still
green). No regressions ✅. Recommend-don't-commit enforced in code
(`ApprovalRequiredError`) ✅. Double-booking blocked (`DoubleBookingError`) ✅.
Colors avoid Mike's payment red; no Sunday bookings ✅. Rabbit-hole: color
mapping is a sensible default pending Mike's confirmation (O4) — named, not
silent. Timezone handled via Intl (no ad-hoc offset math).

## Phase 2/3 hardening — from the expanded brief (Section 3.6–3.29)

Applied after the brief expanded from 5 to 29 guardrail subsections. Core golden
rules (3.1–3.5) unchanged; these add the operational depth.

| Area | Status | Test |
|---|---|---|
| Calendar-write format `Name - SOURCE - phone`, scope in description (§3.22) | ☑ | `eventFormat.test.ts` |
| Afternoon-only 30-min estimate window, mornings protected (§3.11) | ☑ | `scheduling.test.ts` |
| Incident escalation — angry/damage/injury → Mike's cell, never admit fault (§3.9) | ☑ | `intent.test.ts`, `receptionist.test.ts` |
| "I want a person" routing (§3.8) | ☑ | `intent.test.ts`, `receptionist.test.ts` |
| Spam/solicitor screening — never a lead, customer-biased (§3.7, §3.26) | ☑ | `intent.test.ts`, `receptionist.test.ts` |
| Name-first call-open, disclosure after the name (§3.10) | ☑ | `systemPrompt.test.ts` |
| Missed-call text-back copy (§3.21) | ☑ (config) | `systemPrompt.test.ts` |

**Deferred (needs work/accounts/decisions):** learn Mike's real source/city color
map from the live calendar (O4); real ZIP-adjacency graph across the 4 cities;
multi-channel lead intake wiring (Google Ads/LSA/CallRail emails) — Phase 5;
outbound sends (follow-up/quote/reactivation) — Phase 6 behind the TCPA gate.
116 tests pass total.

## Phase 2 — Inbound voice reception (the brain)

| # | Task | Status | Test |
|---|------|--------|------|
| 2.1 | Receptionist system prompt assembled from config (single source of truth) | ☑ | `systemPrompt.test.ts` (4) |
| 2.2 | Output guard — price/diagnosis/forbidden enforced in CODE, not just prompt | ☑ | `outputGuard.test.ts` (many) |
| 2.3 | Emergency detection → alert to Mike | ☑ | `emergency.test.ts` (13) |
| 2.4 | Lead qualification state machine (§3.3) + power-line red flag | ☑ | `qualification.test.ts` (5) |
| 2.5 | Receptionist orchestrator + clean lead capture — **AUDIT after this** | ☑ | `receptionist.test.ts` (4) |
| 2.6 | Live LeadSink over Phase 1 repositories | ☑ | typecheck; used by orchestrator |
| 2.7 | Vapi + Twilio wiring (answer a real phone) | ☐ | **needs Twilio number + Vapi account** |

**Acceptance (Phase 2):** scripted test calls prove — **never** says a price
(even when the model tries) ✅, **never** diagnoses ✅, never leaks Suffolk/TCIA
✅, qualifies correctly ✅, escalates emergencies ✅, captures a clean lead ✅.
Guardrail suite run **twice**, green both times. The one remaining item (2.7) is
the telephony wiring, which needs external accounts.

### Phase 2 audit (§11) — result
85 tests pass (×2 runs), typecheck + lint clean. 1) Guardrails ✅ enforced in
code (output guard) — the model cannot quote a price or diagnose; caller can't
override. 2) Legal gates ✅ disclosure line is in the prompt. 3) Tests ✅ 4) No
regressions ✅ (Phase 0/1 suites still green). 5) Data integrity ✅ (lead capture
reuses the deduping repositories). 6) Secrets clean ✅. 7) Docs current ✅.
8) Scope honest ✅ (no 5B/5C). 9) Rabbit-hole: one named open item — Vapi/Twilio
wiring (2.7) needs accounts; the brain is complete and fully tested behind
injected interfaces.

### Phase 1 audit (§11) — result (partial phase)
`npm run check` green: **36 tests pass, 4 live-integration skipped** (run once
service-role key is in `.env`), typecheck + lint clean. Supabase security
advisor: clean (the `rls_enabled_no_policy` INFO notes are intentional — §4.3
service-role-only). 1) Guardrails ✅ 2) Legal gates ✅ (configured) 3) Tests ✅
4) No regressions ✅ 5) Data integrity ✅ (FKs + cascade + dedupe verified live)
6) Secrets clean ✅ 7) Docs current ✅ 8) Scope honest ✅ 9) Rabbit-hole: one
named open item — Drive integration (1.8) needs Google creds; not silently
half-built.

### Repo consolidation — merged into `artistreellc/Arbo`
Full Phase 0–3 history merged into the Arbo repo (unrelated-histories merge;
final tree byte-identical to the incubator branch). The pre-brief generic-CRM
detour on Arbo main is parked (D25). One named open item: live-DB drift
rollback awaiting Mike's approval (D26). `npm run check` re-verified green
post-merge (see below).

## App surface pull-forward (Mike-directed) — Morning Brief + backend service

Pulled forward at Mike's direction (D27); §5A #25 is normally Phase 8, but the
app surface needed something visible and it reads purely from spine data.

| # | Task | Status | Test |
|---|------|--------|------|
| PF.1 | Morning Brief assembler — route order (emergencies → jobs → ZIP-by-ZIP estimates), first-timer/repeat tags, red flags (§3.11, §5A #25, §9) | ☑ | `morningBrief.test.ts` (5) |
| PF.2 | Interactive app design preview (`design/app-preview.html`: Brief / Inbox / Approve / Property twin, §9 tokens, glove-scale, both themes; sample data, clearly labeled) | ☑ | n/a (static preview) |
| PF.3 | Backend service (`src/server.ts`): node:http, guardrails+legal validated at boot, no PII/stack traces on the wire (§4.3, §8) | ☑ | `api.test.ts` (5) |
| PF.4 | API handlers (`src/server/api.ts`): `/health`, `/api/brief`, `/api/leads` (with hot/warm/cool read §3.14) over an injected DataSource | ☑ | `api.test.ts` |
| PF.5 | Live DataSource + read repos (`listLeads`, `listStopsBetween`) over the Phase 1 spine | ☑ | typecheck; `api.test.ts` behind injected source |

## Phase 4 — Permitting & CBPA/RPA screening engine (§6B, §5A #30)

High value, legally sensitive — front-loads the highest-risk piece first: the
screen that is **structurally incapable of saying "you're clear."**

| # | Task | Status | Test |
|---|------|--------|------|
| 4.1 | Screening engine core — `ScreenStatus` has exactly 3 values (PERMIT_LIKELY / REVIEW_NEEDED / NO_OVERLAY_VERIFY); no CLEAR value exists in the type; `verifyWithCity` always true (§6B.3, §12) | ☑ | `screening.test.ts` (12) |
| 4.2 | Per-city ruleset config — VB (Accela/PPR, reference impl), Norfolk, Chesapeake (eBUILD tiers), Portsmouth (WQIA); forms, portals, contacts, mitigation, **dated `lastVerified`** (§6B.4/4b) | ☑ | `screening.test.ts` |
| 4.3 | Overlay coverage beyond CBPA — FEMA flood, local floodplain/land-disturbance, Norfolk CRO, city tree ordinance; plain-English "what it means" (§6B.4c) | ☑ | `screening.test.ts` |
| 4.4 | Mitigation surfacing (3:1, min 3.5" DBH) on PERMIT_LIKELY removals; Chesapeake scale tiers (site-visit / Board hearing) | ☑ | `screening.test.ts` |
| 4.5 | Power-line routing (§6B.4d) — utility-first, High Voltage Safety Act, ≥ REVIEW_NEEDED; `assertNeverClear` structural guard | ☑ | `screening.test.ts` |
| 4.6 | **"Never say clear" test run twice** (Phase 4 acceptance) — every reachable result across all 4 cities × input shapes × overlay sets | ☑ | `screening.test.ts` (pass 1 + pass 2) |
| 4.7 | Permit entity in the spine — migration `0003_permit.sql` (§7 fields; `screen_status` CHECK mirrors the type, no "clear" storable; RLS service-role-only) | ☑ | schema CHECK; `permit.integration.test.ts` (guarded) |
| 4.8 | Screen→permit bridge + repo (`createPermit`, `getLatestPermitForProperty`, `updatePermitStatus`) — lifecycle needed→applied→approved/not_required_verified | ☑ | `permitRecord.test.ts`, `permit.integration.test.ts` |
| 4.9 | **Crew clearance gate (§6B.3)** — `crewMayStart()` blocks protected work (PERMIT_LIKELY / REVIEW_NEEDED / in-RPA) until a human resolves the permit; `not_required_verified` is never inferred from a screen | ☑ | `permitRecord.test.ts` (7) |
| 4.10 | **Intake auto-screen (§6B.1 step 1)** — lead capture screens the property the moment the address lands: `intakeScreen.ts` (honest PENDING when GIS is absent/down — never a fabricated NO_OVERLAY_VERIFY; failures never lose the lead), wired into the live LeadSink; `crewMayStartForProperty(null)` = blocked ("no screen on file is not clearance") | ☑ | `intakeScreen.test.ts` (11), `permitRecord.test.ts` (9) |
| 4.11 | Screen flag rides the lead into the inbox — `/api/leads` carries `permit` + `screenPending` (property with no screen on file is surfaced, never assumed fine); permit-join failure degrades the flag, never kills the inbox | ☑ | `api.test.ts` (6), `permit.integration.test.ts` (guarded) |

**Deferred to deploy / later (named, not silent):** live city GIS layer wiring
(the injected `GisProvider`), geocoding, form-PDF retrieval, the interactive
map + tree-labeling tool (§6B.2, mobile — Phase 11), and packet assembly +
city handoff (§6B.1 steps 2–6). Same deferral pattern as Vapi/Twilio (2.7) and
Drive OAuth (O3): the classification brain is complete and fully tested behind
an injected interface; nothing is half-built.

**Migration 0003 not yet applied to the live `arbor` project** (no DB creds in
this environment). It's written and in the source of truth (`supabase/migrations/`);
apply it at deploy alongside the D26 drift rollback. Named, not silent.

### Phase 4 audit (§11) — result (checkpoint after 4.7–4.9)
`npm run check` green: **145 tests pass, 7 live-integration skipped**, typecheck
+ lint clean. 1) Guardrails ✅ (permit engine still cannot emit a "clear"; both
the type and the DB CHECK enforce it). 2) Legal gates ✅ (no outbound path
added). 3) Tests ✅ 145/145 run. 4) No regressions ✅. 5) Data integrity ✅
(permit FKs cascade from property, set-null from job; migration mirrors code
types). 6) Secrets clean ✅ (city-office contacts are public, not PII/secrets).
7) Docs current ✅ (this update; D28–D31). 8) Scope honest ✅ (all Phase 4 = #30
CONFIRMED). 9) Rabbit-holes: carried — D26 drift rollback + migration 0003
apply (both need live DB), live-GIS wiring, O4 color map. All named.

### Post-merge audit (§11) — result
`npm run check` green: **138 tests pass, 4 live-integration skipped**,
typecheck + lint clean. 1) Guardrails ✅ (price/diagnosis/Suffolk/TCIA suites
green; merged code adds no price/diagnosis path; permit engine cannot output a
"clear"). 2) Legal gates ✅ (unchanged; the new API is read-only GET — no
outbound path added; server never logs PII/stack traces). 3) Tests ✅ 138/138.
4) No regressions ✅ (all prior suites green). 5) Data integrity ✅ (new repos
are read-only joins; no writes). 6) Secrets clean ✅ (`secrets.test.ts`). 7)
Docs current ✅ (this update). 8) Scope honest ✅ — Morning Brief (#25) is a
CONFIRMED feature pulled forward with Mike's OK (D27); Phase 4 is #30 CONFIRMED;
nothing from 5B/5C built. 9) Rabbit-holes: carried — D26 live-DB drift rollback
(needs Mike's approval); Phase 4 live-GIS wiring (deferred above); O4 calendar
color map. All named.
