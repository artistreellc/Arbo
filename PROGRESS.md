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
| 2.7 | Voice platform wiring — **ElevenLabs Agents** (D39, supersedes Vapi): custom-LLM bridge over the Receptionist (`/voice/llm/chat/completions`, guard-before-stream, session TTL, fail-closed auth), Anthropic brain (`claude-opus-5`, latency-tuned, safe fallback line), TTS client for the spoken brief (§3.17). Live agent **created in Mike's ElevenLabs workspace** (`agent_1901kyyxyj2sf9nsx9jascy2ssxj`, voice George, full guarded prompt) via the connector — running on the built-in LLM until the bridge is deployed, then it flips to custom-LLM so the guard is code, not prompt. | ◐ | `voice.test.ts` (15) — offline; **to go live: deploy server (O1) + point agent's custom LLM at the bridge + phone number** |

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
| PF.6 | **The ARBOR app** (`src/app/index.html`, served at `/`): mobile-first single-file ops UI on the §9 tokens — Today (brief summary chips, ZIP run, ordered stops with red flags) + Leads (hot/warm/cool, emergency, §6B permit flags incl. screen-pending; never says "clear"). `APP_ACCESS_KEY` gate on `/api/*`, fail-closed with a connected DB (§4.3) | ☑ | `appUi.test.ts` (7) |
| PF.7 | **Deployed on Railway** (D40): project `arbor`, push-to-deploy from `main`, healthcheck `/health`, `https://arbor-server-production.up.railway.app` — deploys via GitHub Actions `railway up` (D43) — needs only the `RAILWAY_TOKEN` repo secret | ◐ | live `/health` check pending GitHub App install |
| PF.8 | **Deployed on Vercel with zero GitHub dependency** (D41): esbuild-bundled function + policy/legal/app sidecars, all routes → one handler (`createArborRequestHandler()`, same law as node:http). Production: `https://arbor-artistree.vercel.app` | ◐ | bundle smoke-tested locally (health/app/api 200s); live URL verification pending build completion |

## Phase 5/6 pull-forward — inbox lead recognition + follow-up queue (§5A #12, #16–20)

| # | Task | Status | Test |
|---|------|--------|------|
| P56.1 | Lead-mail classifier over the REAL notification stream: Google Ads lead forms, CallRail (tracker = source tag, duration, repeat signal, Tagged-as), LSA calls; out-of-area flagged for review, marketing mail never lead-ified (D42) | ☑ | `leadMail.test.ts` (6) |
| P56.2 | Follow-up engine: 2-day estimate cadence (+ proof of insurance on first, #17), review request 1d after paid (#18), no-show saver (#20); consent/STOP/quiet-hours gates in CODE; recommend-only (§5B #1); migration 0007 applied live | ☑ | `leadMail.test.ts` (9) |
| P56.3 | `/api/followups` + app **Follow-ups tab** ("ARBOR recommends — nothing sends without you") | ☑ | typecheck + smoke; engine fully covered offline |
| P56.4 | Live Gmail inbox monitor loop (poll/push wiring at deploy) | ☐ | deploy-time (needs Google creds on the host) |
| P56.5 | **Write side / app buttons** (D44): outcome taps (won/lost/no-show), Mark-sent per follow-up card (the only cadence-advancer) | ☑ | `stormWatch.test.ts` API suite |
| P56.6 | **Storm watch #26** (D44): NWS alerts per city centroid (verified live), work-stopping filter, at-risk stop flags, Today-tab banner; feed-down ≠ clear skies | ☑ | `stormWatch.test.ts` (7) |
| P56.7 | **Repeat-customer memory #27** (D45): one-line property history on every lead card ("🌳 Job done & paid Mar 2025 — oak removal"); auxiliary — fetch failure never kills the inbox | ☑ | `memoryOutreach.test.ts` |
| P56.8 | **Pre-storm outreach #19** (D45): storm-triggered only, past customers in affected cities, consent/STOP/quiet-hours gated, recommend-only; `seasonalUnavailable` honesty flag | ☑ | `memoryOutreach.test.ts` |
| P56.9 | **Spoken brief §3.17** (D45): `/api/brief/audio` — brief → drive-time speech → ElevenLabs MP3; 503 until the real key | ☑ | `memoryOutreach.test.ts` |

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
| 4.12 | **Live GisProvider stack** (`src/permitting/gis/`) — strict ArcGIS point-in-polygon client, VA-constrained Google geocoder, per-city dated layer registry (DEQ statewide CBPA baseline + city layers), provider that throws (→ honest PENDING) on no-verified-layers / geocode failure / any single layer failure. Candidate endpoints recorded with sources; **none marked live yet** (gov GIS hosts egress-blocked from this env) — a tripwire test fails if one is flipped live without updating the verification evidence | ☑ | `gis.test.ts` (14) |
| 4.13 | **Packet assembly (§6B.1 step 6, #34)** — `assemblePacket()`: per-city checklist (forms/map/photos/owner/contractor), named missing items, mitigation surfaced up front, hand-off target (portal + contact) for MIKE; `neverAutoFiled: true` structural, no submit function exists; forbidden-string scan on output | ☑ | `packet.test.ts` (7) |
| 4.14 | **Sage won-recolor (D36, resolves O5)** — `markEstimateWonOnCalendar()` flips a won estimate's event to Sage 2 (the only path that writes it); `CalendarApi.updateEventColor` (PATCH); `estimate.calendar_event_id` via migration 0004 (**applied live**); `convertEstimateToJob` returns the event id; D26 rollback file updated to keep the now-legit column | ☑ | `scheduling.test.ts` (won-recolor + never-Sage-on-new-bookings) |
| 4.15 | **GIS endpoints verified + DEQ RPA layer LIVE (D37)** — layer 33 metadata/coverage/point-evidence verified over connector infra; proximity tier (direct → PERMIT_LIKELY, 300 m probe → `CBPA_RPA_PROXIMITY` → REVIEW_NEEDED); keyless Census geocoder default; `createDefaultGisProvider()` now always returns a provider | ☑ | `gis.test.ts` (20) |
| 4.16 | **D26 drift removed from the live DB** — roll-forward migration `0005` applied via the DDL tooling; verified live (tables/columns) | ☑ | live `list_tables` + column checks |
| 4.17 | **Permit-history mining (§5A #35, D38)** — `permitMail.ts` classifier (city domains, Accela case-ref formats incl. DSC/UTIL/J##-RPA, VB review-letter address pattern, kinds: ppr_review / cbpa_case / intake_request / duplicate_warning / payment); migration `0006_permit_correspondence` (**applied live**); **22 real cases mined from the live inbox and indexed** — incl. the brief's own 2025-DSC-021160 example, the VOIDED duplicate 2025-DSC-022094, both Norfolk CBPA violation cases, the Britannica Admin Variance chain, and the DWR eagles-nest coordination; VB ruleset enriched (Accela-help contact, Admin Variance path, DWR coordination) | ☑ | `permitMail.test.ts` (7); 22 rows live |

## O4 RESOLVED — color map learned from the live calendar (2026-08-01)

Analyzed 250 real events (Apr–Jul 2026) from the Art-is-Tree Google Calendar:

| colorId | Meaning (observed) | Evidence |
|---|---|---|
| 4 Flamingo | **Virginia Beach** visits | 93/93 VB locations |
| 10 Basil | **Norfolk** visits | 16/16 Norfolk |
| 5 Banana | **Chesapeake** visits | 6/6 Chesapeake |
| 6 Tangerine | **Portsmouth** visits | 3 Portsmouth (+1 historical out-of-area) |
| 11 Tomato | **Payments/financial only** | 14/14 payment titles — D21 confirmed |
| default | Booked **jobs** / admin | job-titled + address-only events |
| 2 Sage | **Job WON** (O5 resolved — Mike confirmed) | cross-city + REPEAT-heavy fits: winners come from every city |

Also learned: the real title format is **space-separated** (`Peter Simmons TT
7578193493`), not the brief's hyphenated draft — code updated to match (D34).
Two historical Suffolk-location events exist on the calendar (pre-drop, Mike's
own entries — informational only; ARBOR can never create one).

## D26 — RESOLVED (roll-forward migration 0005, applied live)

The drift cleanup ran as a standard roll-forward migration
(`0005_remove_detour_drift.sql`, applied to the live `arbor` project via the
DDL tooling): the three `app_*` tables and `lead.external_id` are gone —
verified live (14 tables = 13-table spine + `permit`; column checks pass).
History stays append-only: the two detour migration rows remain as record,
and replaying 0001→0005 on a fresh DB yields the identical schema (all drops
are `if exists`). `estimate.calendar_event_id` is kept (legitimized by 0004).
The earlier hand-run rollback file is deleted — superseded.

## GIS endpoints — VERIFIED LIVE (4.15); screens now run end-to-end keyless

Build-env egress blocks the gov GIS hosts, so verification ran over the
connected Zapier webhook infrastructure (2026-08-01):

- **DEQ EDMA layer 33 "Resource Protection Area (RPA)"** — polygon Feature
  Layer, Query capability; distinct LOCALITY includes all four service
  cities. Layer **flipped to `live`**. (Layer 32 — the original candidate —
  turned out to be a non-queryable GROUP layer; corrected. The
  candidate-vs-live gate caught exactly what it was built to catch.)
- **The Circle Drive lesson (D37):** the known violation address geocodes to
  the street centerline; direct point-intersects = 0 hits, 75 m = 0,
  150 m = 0, **300 m = 1**. A bare point test would have missed the real
  case. The provider now runs two tiers: direct hit → `CBPA_RPA`
  (PERMIT_LIKELY on removals); probe-only hit within 300 m →
  `CBPA_RPA_PROXIMITY` (REVIEW_NEEDED). Inland control at 300 m: 0 hits.
- **Keyless geocoding:** US Census geocoder (verified live — it resolved
  Circle Drive) is the default when no Google Maps key is set, so the whole
  §6B screen pipeline runs live with **zero paid credentials**.

**Deferred to deploy / later (named, not silent):** live city GIS layer wiring
(the injected `GisProvider`), geocoding, form-PDF retrieval, the interactive
map + tree-labeling tool (§6B.2, mobile — Phase 11), and packet assembly +
city handoff (§6B.1 steps 2–6). Same deferral pattern as Vapi/Twilio (2.7) and
Drive OAuth (O3): the classification brain is complete and fully tested behind
an injected interface; nothing is half-built.

**Migration 0003 APPLIED to the live `arbor` project** (Supabase tooling became
available mid-session): `permit` table live with RLS enabled; all three CHECK
constraints verified in pg_catalog (city ∈ 4 cities; screen_status ∈ the three
no-clear values; lifecycle ∈ needed/applied/approved/not_required_verified).
Security advisor: only the intentional D11 `rls_enabled_no_policy` INFO notes.
The D26 drift rollback (destructive) still awaits Mike's approval.

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

### "Connect them" — live app ↔ live DB (2026-08-01, verified)
The production Vercel app is fully connected to the live Supabase project with
zero remaining action items. Root cause of the earlier 500s: the dashboard env
values were malformed phone-pastes (presence-only health checks can't see
that). Fix is D46 — trimmed env, shape-validated Supabase credentials
(`getShaped()`), and a gitignored `private/deploy.config.json` carried only
inside the private deployment upload as backstop. Verified live over the
sanctioned webhook path: `/health` → `db:true`; `/api/leads` → 200 with the
real seeded lead row; `/api/followups` → 200 (empty queue, seasonal feed
healthy); `/api/brief` → 200 with a valid window. Dashboard env vars remain
Mike's to fix/delete at leisure — well-formed env always wins over carried.
Recommended (non-blocking): rotate the service-role key eventually, since it
transited chat during setup.

### Location intelligence + review loop (§5A #21–24, #29) — built 2026-08-02
`locationIntel.ts` (pure engine, 16 new tests): §24 working-hours + master-
switch law in code, 150 m/2-ping geofence visits, straight-line running-late
assessment that degrades to the soft "running a little behind" draft (guard-
checked) instead of inventing an ETA. Migration 0008 applied live:
`location_ping` (72 h retention on the write path), `ops_setting`,
`conversation_log`, `estimate.visited_at`. New key-gated routes:
POST /api/location/{ping,tracking}, GET /api/location/{status,day},
GET /api/review/backlog, POST /api/review/:id/reviewed. The voice bridge now
appends every turn to conversation_log (best-effort — a dead log never drops
a caller). App: Today-tab tracking pill + running-late banner with the
send-it-yourself draft. Deploy-time reality, named honestly: pings need a
sender (an iPhone Shortcut posting to /api/location/ping is the zero-app
path); geofencing/visits work the moment pings flow. 268 tests green.

### Secret rotation status (2026-08-02)
ELEVENLABS_BRIDGE_SECRET rotated (ours to mint; ships in the deployment-
carried config — nothing external used the old one yet). The two remaining
hygiene items are dashboard-gated and NOT reachable from this environment's
sanctioned tools (the Supabase MCP deliberately exposes no key management;
the Vercel MCP has no env-var surface): (1) rotating the Supabase
service_role key — verified still live; (2) deleting the three corrupt
Vercel env vars — harmless since D46 shape-validation ignores them. Both are
60-second dashboard clicks whenever Mike wants; D46 means neither blocks
anything, and a rotated key ships into the carried config on the next
deploy with one paste.

### Deploy verification (2026-08-02)
Deployment `dpl_HaLUaeNXg1mzUDdyE7EME9KPJbaL` READY on production
(arbor-artistree.vercel.app), carrying the rotated bridge secret. Verified
live over the webhook path: /health 200 db:true; /api/location/status 200
(tracking OFF by default, late=no_data); /api/review/backlog 200 (empty);
/api/leads 200 with the real seeded row. Full loop green end-to-end.
