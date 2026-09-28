# BUILD R25 — the whole platform, field-test ready

Owner ruling R25 (Mike, 2026-09-28) — see `docs/OWNER_RULINGS.md`. This file
is the working plan: what gets built, in what order, and where the honest
limits are. Every phase ships the house way: tests → `npm run check` →
adversarial review → screenshots → PR → merge → deploy by full SHA → verify.

## Sources, in the order CLAUDE.md sets
1. `Arbo_Master_Build_Brief.pdf` (Drive "Arbo", read 2026-09-28 in full).
2. Add-on **-01** "permitting-module-virginia-beach-buffers" — the only
   numbered add-on. Its FACTS (Appendix F / G buffers, variance mechanics,
   intake fields) feed the permits database. Its OUTPUT VOCABULARY
   ("CLEAR", "EXEMPT", "PERMIT REQUIRED", "LIKELY PROHIBITED") contradicts
   the brief (§6B.3, §6B.4c, §8A.5 #14, §12) and the coded rule — **held for
   Mike** (conflicts stop and ask). The code keeps PERMIT LIKELY / REVIEW
   NEEDED / NO OVERLAY–VERIFY.
3. Running code wins on what exists (e.g. R18 holds, not direct calendar
   writes; Railway, not Vercel; the brand is the website's, not §9's purple —
   Mike 2026-09-24, "Template v3").

## Design — "Heartwood" (hand-built, no kit, no framework)
- Brand: forest #1B4D3E, paper #F7F5F0, gold #C9971C (the website's family,
  Mike 2026-09-24). A Night theme (forest-black) for evenings.
- Type: Fraunces (display, variable optical size) + Instrument Sans (UI),
  both SIL OFL, **self-hosted** in `src/app/fonts/` — no external requests.
- Icons: `src/app/sprite.svg`, drawn for Arbo (24px grid, 1.75 stroke,
  growth-ring motif). Mark: off-centre growth rings.
- Signature: the Day Ring on Today — time of day, the day's stops, open
  loops — every ring dashed when its feed is unreadable (§1B).
- Field law (§9): 48px minimum targets (56px on crew), one-handed, sunlight
  contrast, every surface within two taps.

## Installable app (iPhone + Android)
Web-app manifest (start_url `/app`), service worker (`/sw.js`) caching the
shell and fonts — **never** `/api` responses (customer data and §1B), app
icons incl. maskable, iOS home-screen meta. App-store listing is a separate
step (developer accounts) and is not implied.

## Sections and the eight agents
The brief names 14 agent roles (§8A.5). Mike asked for eight, one per
section. Each section agent carries one or more roles, so all 14 are covered.

| # | Section agent | Brief roles carried | Section |
|---|---|---|---|
| 1 | Front Desk | #1 Receptionist | Calls |
| 2 | Dispatcher | #2 Booking/Dispatch, #9 Weather | Calendar / route |
| 3 | Chief of Staff | #3 Loop-Closer, #13 Owner Briefing | Today / Queue |
| 4 | Permit Desk | #4 Permitting & Site Intel, #14 Legal & Codes | Permits |
| 5 | Arborist | #5 Master Arborist Knowledge, #8 Vision & Labeling | Measure / Book |
| 6 | Crew Chief | #6 Safety, #7 Trainer | Crew |
| 7 | Yard Boss | #10 Fleet/Equipment/Parts, collections | Queue → fleet & money |
| 8 | Analyst | #11 Marketing, #12 Analyst | Numbers |

Law for all eight (§8A, §8A.8, R17): agents never call each other (they
share state and events), never spend money, never send anything (the one
exception stays the R22 text via Quo, behind `inspectMessage`), never edit a
calendar event, never rewrite their own rules or code. Every run is recorded.

## LiDAR
A web app cannot read the iPhone LiDAR sensor (no depth API in iOS Safari).
Arbo imports the point cloud a LiDAR scanning app exports (PLY / LAS / XYZ)
and measures height, crown spread and a DBH estimate with a confidence —
consistent with brief §8B (LiDAR DBH via phone apps) and inside §6X's limits
(no AR capture, no photogrammetry, no cut-count model). Measurements are
decision support; a person signs off.

## Public works & permits database
Handcrafted per city (VB, Norfolk, Chesapeake, Portsmouth) plus regional
rules (VA811, Dominion line clearance, DPOR licensing, burn law, disposal).
Every fact carries a source URL and a verified-on date; anything not
confirmed from a source says UNCONFIRMED — verify. Outputs stay in the
three-word vocabulary; never "you're clear".

## Simulated learning environment
A catalog of the problems real people bring to a tree service (callers,
crews, permits, weather, money, equipment), each scenario with an expected
behaviour and the rules it tests. The harness runs them against the brain
and scores against Mike's rules; failures become LESSON proposals Mike
approves (the IntentRegistry pattern) — nothing retrains itself.

## What "go live" still needs from Mike (not optimisations to make quietly)
- Opening the data links one by one (§3, R19).
- Google reconnect from Settings (D83).
- Quo texting registration (R22).
- Answers on the add-on -01 vocabulary conflict and the open items in R23.
