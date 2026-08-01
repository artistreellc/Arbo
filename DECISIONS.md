# DECISIONS

Every non-obvious choice and why. The map out of any future rabbit hole
(brief §0, rule 6).

## Phase 0 — Foundation

| # | Decision | Why |
|---|---|---|
| D1 | **Separate dedicated repo** (`arbor`), not folded into the marketing website. | Isolates sensitive customer PII (§4.3), own CI/history/least-privilege. Confirmed by Mike. |
| D2 | **Backend = Node + TypeScript.** | One language shared with the Expo/React Native app (§8) and the existing Vercel/JS world — shared types & config schemas end-to-end instead of a second Python runtime. Confirmed by Mike. |
| D3 | **New dedicated Supabase project** for ARBOR (not the existing "website" project). | Customer PII isolation & least-privilege (§4.3). Confirmed by Mike. |
| D4 | **Voice platform = Vapi** on a Twilio number. | Purpose-built voice-agent platform avoids the biggest rabbit hole — hand-rolling STT/TTS (§8, §12). Logged now; wired in Phase 2. Confirmed by Mike. |
| D5 | **Guardrails & legal rules as loadable JSON config** (`src/policy/guardrails.json`, `src/legal/compliance.json`), validated by Zod schemas at boot. | Single source of truth (§3, §12) — voice & messaging layers both load it; nothing hard-coded in scattered prompts. |
| D6 | **Zod** for config validation; **Vitest** for tests; **tsx** to run TS directly. | Minimal, fast, TS-native toolchain. Zod schemas double as the runtime guard and the type source. |
| D7 | **Forbidden-string guard** (`src/lint/forbiddenStrings.ts`) fails tests/CI if `Suffolk` or `TCIA` appears in **customer-facing** text. | §12 risk control — makes the two most dangerous copy mistakes structurally impossible to ship. |
| D7a | "Customer-facing" is defined **precisely** as the explicit allow-list of strings the AI actually says/sends (approved pivot lines, spoken questions, the out-of-area line, the call disclosure, the STOP instruction, the business-identity line) — NOT internal policy descriptions. | Internal rules legitimately name TCIA/Suffolk as the thing to *avoid* ("Never claim TCIA"). A whole-object scan false-positives on exactly the config that enforces the rule. Discovered via the failing test during Phase 0 — the guard now scans `guardrailsCustomerFacingStrings()` / `legalCustomerFacingStrings()`. |

## Phase 1 — Data spine

| # | Decision | Why |
|---|---|---|
| D8 | Supabase project **`arbor`** (`wdpyysgxmwvvoyveihum`, us-east-1, free tier) — separate from "website". | §4.3 PII isolation; region matches VA. |
| D9 | **Service area enforced by a DB CHECK** (`city in (…4 cities)`), not just app code. | Makes storing a Suffolk property structurally impossible (§2, §12) — defense in depth below the app. Verified live. |
| D10 | **`normalized_address` UNIQUE** on `property`; app normalizes before upsert. | One lot can never become two twins (§12). Normalization standardizes street types/directions/units. |
| D11 | **RLS on every table, zero policies** → service-role-only access. | §4.3 least privilege; the backend uses the service role, no public key can read PII. |
| D12 | Empty `tree.next_due_forecast` (+ other twin fields) created now, populated in Phase 8. | §6 build note: capture cleanly from day one, forecast last. |
| D13 | `text` columns with CHECK constraints for enums (source/status/etc.), not PG enum types. | Easier to evolve without migrations; same integrity. |

## Phase 2 — Inbound voice reception

| # | Decision | Why |
|---|---|---|
| D15 | **Guardrails enforced in CODE (output guard), not only in the prompt.** Every candidate reply is scanned; price/diagnosis/forbidden terms are blocked and replaced with the approved pivot line before anything is spoken. | §3/§12 "guardrails are law." An LLM can be imperfect or jailbroken; this layer cannot be talked out of the rules. Proven by tests where the model tries to quote a price and the guard blocks it. |
| D16 | **All external edges injected** — `LlmClient`, `Alerter`, `LeadSink`. | The receptionist brain is fully testable offline (fakes) and the same code runs under Vapi + Twilio + Anthropic in prod with no changes. |
| D17 | Emergency detection is **deterministic and biased toward catching** (a false ping to Mike is acceptable; a miss is not). | §3.4 — a tree on a house/car/line must never be slotted as a normal estimate. |
| D18 | Price/diagnosis patterns live in `guardrails.json` (per golden rule), consumed by the guard. | Single source of truth (§12) — tune the rules in one place; code + tests follow. |

## Phase 3 — Booking & scheduling

| # | Decision | Why |
|---|---|---|
| D19 | **Recommend-don't-commit** enforced in code: `bookApproved` throws `ApprovalRequiredError` unless `approved===true`, and `DoubleBookingError` if the slot is taken. | §5A #11 — ARBOR suggests, Mike approves. Never auto-books. |
| D20 | Calendar client is **auth-agnostic** (`CalendarApi` + injected token), like Drive. | Same code runs under service account / OAuth at deploy; testable offline. |
| D21 | Default colors **avoid Tomato (11)** — Mike uses it for payment reminders (seen on his live calendar). estimate=Blueberry(9), job=Basil(10), emergency=Tangerine(6), follow_up=Banana(5). | Don't clash with an existing convention (§5A #9). |
| D22 | Working days Mon–Fri, 8am–5pm, with a productive-day factor 200/260. | §2 realistic capacity (rain/breakdowns cut ~260 workdays to ~200). |
| D23 | Timezone via `Intl.DateTimeFormat` (America/New_York), not manual offsets. | §12 avoids the timezone rabbit hole. |

## Open decisions (revisit before the relevant phase)

- **O4 — Confirm calendar color convention with Mike.** Defaults chosen to avoid
  his payment-red; confirm estimate/job/emergency/follow-up colors match how he
  wants his calendar to read.

- **O1 — GitHub remote for `arbor`:** default plan is a new private repo under
  the `artistreellc` org named `arbor`. Confirm owner/name/visibility before first push.
- **O2 — Secrets manager beyond env vars:** Phase 0 uses gitignored `.env` +
  Vercel env vars. Revisit whether a dedicated manager (Doppler/1Password) is
  worth it as integrations grow.
- **O3 — Google Drive runtime auth (deploy-time, NOT blocking):** the live
  "ARBOR Clients" folder tree is created and the filing code is written +
  tested. What remains is how the *deployed* backend authenticates to the Drive
  API at runtime — a **service account** (share the ARBOR Clients folder with
  its email) or a **stored OAuth refresh token** for the owner. The Drive code
  is auth-agnostic (`createGoogleDriveApi(getAccessToken)`), so this is a
  one-line wiring at deploy. Recommend service account. Decide at deploy (Phase 10).

## Phase 1 — live Drive artifacts (created in owner's Drive)

| Folder | ID |
|---|---|
| ARBOR Clients (root) | `1O76sL4tkQ33xDFTmoorayMT2pZwd6WAT` |
| 742 Evergreen Terrace — Virginia Beach (pilot) | `1NO-sbywuK_gNGtHzvOFvVBXc1YR7uURv` |
| ↳ Estimates / Signed Contracts / Job Photos / Documents | created |

D14 — **Drive module is auth-agnostic** (`DriveApi` interface + injected token
provider), so the same filing logic runs under a service account or OAuth
without code changes.

## Backlog (§5C optional — DO NOT build without Mike's OK)

Crew dispatch summary · permit/utility flag on power-line jobs · referral ask ·
upsell prompter · night-before gear pre-check · cancellation dead-time filler ·
deposit/unpaid-invoice reminder.

## Explicitly OUT (§5B — never build)

Fully autonomous / self-rewriting learning · win-back nudges to cold estimates.

## Repo consolidation — merge into `artistreellc/Arbo` (resolves O1)

| # | Decision | Why |
|---|---|---|
| D24 | **ARBOR's home repo = `artistreellc/Arbo`** (this merge brings the full Phase 0–3 history in; the art-is-tree `claude/tree-service-crm-kfllgt` orphan branch was the incubator). | Resolves O1. Mike directed all ARBOR work to the Arbo repo; keeps PII-sensitive code out of the public marketing-site repo (D1). |
| D25 | A **pre-brief generic-CRM detour** (React SPA + `/api/crm/*` + `crm_*`-schema design, Arbo PR #1) is **parked** — removed from the tree, recoverable in git history. It predated reading the Master Build Brief and violated §2/§3 (Suffolk + non-approved credentials in a receptionist prompt, dollar amounts in UI). Nothing from it is load-bearing. | §0 rule 1 (phases in order) and §3/§12 — the brief-aligned implementation supersedes it wholesale. |
| D26 | **Live-DB drift to remove (needs Mike's approval — destructive op):** the detour session applied two extra migrations to the `arbor` Supabase project — `app_support` (tables `app_settings`, `app_admins`, `app_activity`; column `lead.external_id`) and `estimate_calendar` (column `estimate.calendar_event_id`). No code references them; they are additive and dormant. Rollback SQL is written but a destructive drop was (correctly) blocked by tooling policy. Action: drop the three tables + two columns and delete the two rows from `supabase_migrations.schema_migrations`, restoring exact parity with `supabase/migrations/`. | §11 audit item 5 (data integrity / schema = migrations). Logged rather than silently left. |

## Mike-directed reprioritization (Aug 1)

| # | Decision | Why |
|---|---|---|
| D27 | **App surface pulled forward** at Mike's explicit direction ("start really building the app"). Built the Morning Brief assembler (`src/ops/morningBrief.ts`, pure + tested) and an interactive design preview of the phone app (`design/app-preview.html`: Brief / Inbox / Approve / Property twin, §9 tokens, glove-scale targets, both themes). | The approval surface is the missing half of already-built recommend-don't-commit (#11), and Mike needs something visible. Preview uses sample data, clearly labeled; real wiring lands with the API layer. Phase ordering otherwise unchanged. |

## Phase 4 — Permitting & CBPA/RPA screening (§6B)

| # | Decision | Why |
|---|---|---|
| D28 | **"Clear" is unrepresentable in the type.** `ScreenStatus` is exactly `PERMIT_LIKELY \| REVIEW_NEEDED \| NO_OVERLAY_VERIFY` — there is no CLEAR/NONE/OK value, `verifyWithCity` is the literal `true`, and `assertNeverClear()` guards the headline. The lowest outcome (no overlay found) still says "VERIFY WITH CITY". | §6B.3 / §12: GIS is wrong at parcel edges and a false "clear" is exactly what caused the real 8562 Circle Drive violation. Making it structurally impossible (like the receptionist output guard) beats hoping a prompt behaves. |
| D29 | **GIS is an injected `GisProvider` interface; screening logic is pure and offline-tested.** Live city GIS/geocode, form-PDF retrieval, the map+tree-labeling tool (§6B.2), and packet assembly/handoff are deferred to deploy/mobile. | Same pattern as Vapi/Twilio (2.7) and Drive OAuth (O3) — build and fully test the brain now; wire external, credential-bound, or mobile-only pieces at their phase. Nothing half-built or silent. |
| D30 | **Per-city rules live in a dated config module** (`src/permitting/cities.ts`) with `lastVerified` per city; city planning/environmental **office** contacts are stored (public, not customer PII). VB (Accela/PPR) is the reference implementation; the other three mirror the shape. | §6B.3 "configurable and dated"; the review loop (§13) re-checks the dates. Keeps forms/portals/contacts/mitigation out of the classification logic so Mike (or the loop) can update them in one place. |
| D31 | **Crew clearance is a human gate, and the DB enforces the no-clear rule too.** The `permit` table's `screen_status` CHECK allows only the three code statuses (no "clear"), and `crewMayStart()` blocks protected work (PERMIT_LIKELY / REVIEW_NEEDED / in-RPA) until the lifecycle reads `approved` or `not_required_verified` — the latter set only by an explicit human write after checking with the city, never inferred from a screen. Migration `0003_permit.sql` is **applied to the live `arbor` project** (verified: table + RLS + all three CHECKs live; advisors clean). The destructive D26 rollback remains separate and still awaits Mike's approval. | §6B.3 "no crew starts protected work without clearance" + §12: put the guarantee in the type AND the schema, not a prompt. Schema = migrations parity holds (§11 item 5) — apart from the already-named D26 drift. |
| D32 | **A screen that didn't run is PENDING, never NO_OVERLAY_VERIFY.** `NO_OVERLAY_VERIFY` means "we checked the GIS layers and found nothing"; when the GIS provider is absent or fails at intake, `runIntakeScreen` returns a named PENDING outcome and no permit row is written — the absence of a row *is* the "still needs a screen" state, surfaced as `screenPending` in the inbox and blocked by `crewMayStartForProperty(null)`. Screening/persistence failures never lose the lead. A repeat capture on a known address deliberately re-screens (new work = fresh clearance cycle; a prior approval stays on its own job's row). | §1B graceful degradation (the fake-ETA ban applied to GIS) + §3.18 never bluffs: fabricating a "no overlay" result when nothing was checked is a quiet Circle Drive. Fail-closed everywhere, but the lead always survives (§3.21 — never lose a caller to an auxiliary failure). |
| D33 | **GIS endpoints ship as dated 'candidate' config; the provider only queries 'live' (verified) layers by default.** Candidate URLs (DEQ statewide CBPA layer + Chesapeake city layers; Norfolk/VB hub pages for REST-URL extraction) were discovered via search but the gov GIS hosts are egress-blocked from this build environment, so none could be verified here. `layers.ts` documents the 5-minute per-endpoint verification procedure (metadata check + known-RPA point (8562 Circle Drive) + known-inland point) and `gis.test.ts` has a tripwire test that fails when a layer flips to 'live', forcing verification evidence into the same commit. The provider also throws on geocode failure and on ANY single layer failure — a partial screen recorded as complete is a quiet false-negative. | D32's honesty rule applied to endpoints: querying an unverified URL that happens to answer could produce a false NO_OVERLAY_VERIFY on the wrong layer/point — the exact Circle-Drive failure. Fail-closed (pending) until each endpoint is proven, then real screens with no code change. |
