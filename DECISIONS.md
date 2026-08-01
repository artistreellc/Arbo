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

## Open decisions (revisit before the relevant phase)

- **O1 — GitHub remote for `arbor`:** default plan is a new private repo under
  the `artistreellc` org named `arbor`. Confirm owner/name/visibility before first push.
- **O2 — Secrets manager beyond env vars:** Phase 0 uses gitignored `.env` +
  Vercel env vars. Revisit whether a dedicated manager (Doppler/1Password) is
  worth it as integrations grow.
- **O3 — Google auth style + credentials (BLOCKS task 1.8):** the per-property
  Drive folder auto-creation needs Google credentials. Recommended: a **Google
  Cloud service account** with the Drive API enabled, and a parent "ARBOR
  Clients" Drive folder shared to the service-account email. Needs Mike to:
  create/confirm a Google Cloud project, enable the Drive API, create the
  service account + JSON key, and share the parent folder. Then set
  `GOOGLE_*` env vars. Until then, 1.8 is parked (not half-built).

## Backlog (§5C optional — DO NOT build without Mike's OK)

Crew dispatch summary · permit/utility flag on power-line jobs · referral ask ·
upsell prompter · night-before gear pre-check · cancellation dead-time filler ·
deposit/unpaid-invoice reminder.

## Explicitly OUT (§5B — never build)

Fully autonomous / self-rewriting learning · win-back nudges to cold estimates.
