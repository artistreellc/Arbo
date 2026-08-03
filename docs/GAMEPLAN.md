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

# Arbo 72-Hour Build Plan — agents, AR, and the order of attack

Written 2026-08-02. Governing document: the live Master Build Brief (206-heading
Arbo edition). This is the execution order, not new law — where this file and
the brief disagree, the brief wins.

## The shape of the whole thing

Three tracks run in parallel. Every cycle ends the same way: tests green →
adversarial review pass → push → deploy → verify live. Nothing ships unreviewed.

```
TRACK 1 — THE BRAIN (server, this container, every cycle)
  spine → binder → agents wave 1 → agents wave 2
TRACK 2 — THE FACE (the app Mike pokes)
  cockpit HUD rebuild → morning-brief home → yard check → queue/agent surfaces
TRACK 3 — THE EYES (AR, phone hardware — needs the platform ruling below)
  camera tool A: boundary/permit overlay → camera tool B: pruning guidance
```

## Track 1 — the agent ecosystem (§8A/§8B, locked by owner decision)

**DONE this cycle (2026-08-02):**
- Full §7 data spine live: all 25 remaining tables applied to production
  (crew/training/near-miss/reference, areas/behavior/campaigns/keywords,
  site-condition/change-order, equipment units + parts + tools + photo-proof
  maintenance, leakage line, work orders, invoices w/ 5%-cap law, app_user
  roles groundwork, event bus, event cursors, agent_run audit log).
- The binder (§8A.6): event bus (durable, ordered, cursor-consumed, no
  framework), THE policy engine (single deterministic wall: golden rules +
  TCPA/STOP/quiet-hours + admin-data wall + date-promise + Suffolk/TCIA lint;
  agents structurally cannot spend money or send legal commitments), tool
  registry (typed, permissioned, every call recorded), agent-run audit trail.
- Agent #3 Loop-Closer (the §1E backup brain) running deterministically:
  quiet estimates, wins never booked, jobs never closed, callbacks never made
  — live at GET /api/queue, worst-first.
- §6J2 estimating engine: truck-to-truck math, crew-scaled $5k floor,
  leakage load re-derived from logged actuals — live at POST /api/estimating/check
  (internal-only, admin key required). Leakage logging at POST /api/leakage.

**WAVE 1 — the first 5 agents (all runnable server-side, no voice hardware):**
| # | Agent (§8A.5) | Trigger | What it needs |
|---|---|---|---|
| 3 | Loop-Closer (backup brain) | absence of events, hourly | LIVE NOW (deterministic core) |
| 13 | Owner Briefing | 6am + EOD cron | exists as morning brief — moves onto the binder w/ agent_run logging |
| 4 | Permitting & Site Intelligence | lead.created event | screening engine exists — becomes an event consumer |
| 12 | Analyst | overnight batch | conversation log + outcomes exist; batch summaries → needs-decision items |
| 7 | Trainer | near_miss.created, weekly cron | schema live now; generates DRAFT items only — §4.7 wall: nothing publishes without human vetting |

Wave-1 agents run Opus 5 per the standing decision — which requires the
ANTHROPIC_API_KEY on the server (approval gate below). Until the key lands,
every agent runs its deterministic core and logs honestly to agent_run;
LLM-judgment steps say "not configured," never fake it.

**WAVE 2 (after wave 1 is green):** #2 Booking/Dispatch on the calendar
contract, #9 Weather & Conditions (NWS feed exists), #10 Fleet/Parts (schema
live; Bouncie integration is its own step), #11 Marketing, #14 Legal & Codes.
The Receptionist (#1) upgrades when the voice platform work lands (8B.2:
Twilio ConversationRelay + ElevenLabs; Retell fallback).

## Track 2 — the app becomes a cockpit (§9, next cycle, already in flight)

The current app is a recolor of the old layout — not acceptable and not the
law. §9 says mission-control HUD: Morning Brief as the home surface, dense
instrument panels, one-glance status, one-tap approvals. The rebuild:
- Home = the Morning Brief + live status rail (storm, queue count, agents'
  last runs, coming-due money list) — glanceable like a dashboard, not a feed.
- Queue tab = the Loop-Closer's open loops (already live server-side) + the
  §16-20 recommend-only follow-ups, one-tap each.
- Yard = the §6J2 estimating instrument (already live server-side).
- Proof: fresh phone + desktop screenshots reviewed against §9 before deploy,
  every time.

## Track 3 — the two camera tools (AR, per the two uploaded specs)

**Camera tool A — AR site scanner / boundary + permit overlay** (§6B.4i + §6T.1/6T.2):
paints property line, RPA/125-ft line, city land, power-line envelope, per-tree
tags on live camera. "Approximate — never a survey" label is permanent law.
**Camera tool B — AR pruning guidance** (§6T.3, AR_PRUNING_OVERLAY_SPEC):
goal-driven cut plan on the live canopy, A300-capped, "must see it" gate —
no call off a bad frame, crew lead owns every cut.

Sequencing per §6T.5: boundary/utility overlay (A) ships before pruning (B).
Both need the **platform ruling** (the brief contradicts itself — F7):
- §6B.4i says ARKit/ARCore via the Expo/React Native app (cross-platform, one codebase)
- §6T.4 says ARKit + LiDAR + RealityKit, iOS-first (deeper AR, Apple-only, second codebase)
This is Mike's call (approval gate below). Everything server-side that AR
consumes (parcels, permit screens, twin data, offline packs) is Track 1 work
and proceeds regardless.

## Standing quality law (every cycle, no exceptions)
1. `npm run check` green before any push.
2. Adversarial review workflow over each cycle's diff; confirmed findings fixed before deploy.
3. §11 audit every 5 cycles: guardrail suite, legal gates, secrets/PII scan, scope honesty, rabbit-hole check → DECISIONS.md.
4. Screenshots before any UI ship — reviewed against §9, then sent to Mike.
5. Deploy → verify live by provenance (commit SHA in deploy logs + health check), never by assumption.

## Approval gates open right now (Mike)
1. **ANTHROPIC_API_KEY on the Railway server** — turns wave-1 agents' judgment on (Opus 5 per your standing decision). Without it they run deterministic-only.
2. **AR platform ruling** — Expo/React Native cross-platform vs iOS-first RealityKit (the brief's own conflict; pick one owner).
3. **Vercel reconnect** — restores arborgrow.app deploys (Railway URL is fully live meanwhile).
