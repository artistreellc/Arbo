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
- 0.3 is partially open pending the real Supabase project + keys (see DECISIONS O1).
  Boot + config validation is complete and tested; live Supabase connection is
  verified once the new project's keys are in `.env`.
