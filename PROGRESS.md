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
