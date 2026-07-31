# ARBOR

AI reception & operations platform for **Art-is-Tree LLC** (Hampton Roads, VA).
Working codename: **ARBOR**. See the Master Build Brief for the full spec.

> **North star:** *Every customer feels like Art-is-Tree's only customer, while
> Mike touches a phone as little as possible.*

## What this is

The nerve center for the business: it answers the phone under strict guardrails
(never quotes a price, never diagnoses a tree over the phone, stays on-topic,
only claims real credentials), qualifies and books work into a color-coded,
ZIP-clustered calendar, files paperwork into Google Drive, runs the field day
(geofenced reschedules, storm awareness, a one-glance morning brief), and — the
centerpiece — keeps a living record of every property that eventually forecasts
when trees are due and generates repeat business on its own.

## Non-negotiables (baked in from Phase 0)

- **Service area is exactly four cities:** Virginia Beach, Norfolk, Chesapeake,
  Portsmouth. **Suffolk is never served or mentioned.**
- **Credentials:** licensed & insured, BBB A+ only. **Never claim TCIA.**
- **Guardrails** (`src/policy/guardrails.json`) and **legal rules**
  (`src/legal/compliance.json`) are the single source of truth, loaded by every
  layer. They are law (brief §3, §4).

## Stack

Node + TypeScript backend · Supabase (Postgres/storage/auth, system of record) ·
Google Calendar/Drive/Gmail/Maps · Vapi + Twilio (voice, Phase 2) · Vercel
hosting · Expo/React Native app (Phase 10). Rationale in `DECISIONS.md`.

## Develop

```bash
cp .env.example .env      # fill in real values; .env is gitignored
npm install
npm run check             # typecheck + lint + tests
npm run boot              # boot: loads & validates policy + legal config
```

## Project docs

- **`PROGRESS.md`** — every task, status, and test result.
- **`DECISIONS.md`** — every non-obvious choice and why.

Build one clean phase at a time. Audit every five tasks. Ask before guessing.
