# Direction B — screens named for the job (the approved redesign)

Mike picked **Direction B** on the Arbo Layout Review page on 2026-10-20 (R29 #1)
and answered four follow-up questions the same day. This file is the spec the
build follows. It was rebuilt on 2026-10-21 from the review page, R29 and the
follow-up answers after the first build plan was lost to a container restart.

- Review page (mockups, Mike's taps): https://claude.ai/artifact/5RFm5doQg7RdupLoXd2pV4
  — mockups `shots/B-0…B-8` (Today, Leads, Leads › Calls & texts, Estimate,
  Office), practice data only. They are drawings, not the app.
- Ruling: `docs/OWNER_RULINGS.md` R29. Nothing here overrides a ruling.

## What Mike approved (his taps, R29)

1. **Direction B.** The dock becomes **Today · Leads · Calendar · Estimate ·
   Office**. Every hub shows live counts, and every tap lands on the exact
   thing. Desk names (R26: Chief of Staff, Yard Boss, Crew Chief, Analyst) stay
   as the small line above each screen title.
2. **Calls folds into Leads.** Leads gets two segments, **New leads** and
   **Calls & texts**. A red Sona flag stays above the segments, just as loud as
   today, so it never sinks into the second segment. The home-screen shortcut
   to Calls keeps working.
3. **Queue is split by the job it holds:** Follow-ups, Money, Fleet,
   Crew & safety (plus Estimate, Office, Teach Arbo as named screens).
4. **Yard check moves from Today into Estimate**, beside prep, permit rules and
   measuring. Still one tap away.
5. **One feeds card per screen** for off / cut / couldn't-read notices (e.g.
   "9 feeds off: 8 cut on purpose, 1 couldn't read"), opening to name every
   feed. A failed feed is still named, never hidden (§1B).
6. **‹ Back stays as built**: labeled, on every screen except Today, dock
   tabs included.
7. **The quick fixes first** (they work under any direction). From the review
   page:
   - Today gets a **"Before you roll"** strip: crew who can't go aerial, trucks
     down or held, emergencies, and a named row for any feed it couldn't read.
   - Today's count tiles open what they count; the hero's three stats are
     tappable; weather that couldn't be read is a dashed, untappable tile that
     says so — never a zero.
   - Stops get a big **Navigate** button.
   - Agents lists its proposals at the top.
   - Permits folds down from ~22 screens to ~3, with the result pinned.
   - Leads shows about twice as many per screen (compact rows with a round
     call button instead of a full-width Call back slab).
   - Loading screens say "Reading…" instead of looking empty.
   - Small text gets larger and higher-contrast.
   - Number fields open the number keyboard.
   (The review counted 15; the first plan that itemised all 15 was lost. Any
   further quick fix must come from the review's findings, not be invented.)

## Follow-up answers (Mike, 2026-10-20, in the session)

- **Back** retraces every tab tapped, in order (keep the live behaviour; do not
  rewind history to [Today, tab]).
- **A red Sona flag clears** when Mike taps **Call back** on that customer: it
  counts as handled and leaves the Leads badge. It stays in call history.
- **Renames under Estimate:** Book → **"Properties on file"**; Permits →
  **"Permit rules"**.
- **The old receptionist page** is renamed **"Phone line (off while Sona
  answers)"**. "Talk" means only the R30 header button.
- **Downed line, nobody hurt** (R29 #4): Dominion only, never 911. Phrasings
  like "no one is injured" / "nobody was injured" must not add the 911 line;
  the alert to Mike is unchanged.

## The hubs (from the mockups)

- **Today:** hero with three tappable stats; "Before you roll"; the day.
- **Leads:** Sona flag on top → segments `New leads N` / `Calls & texts N` →
  filter chips → compact lead rows with a round call button. Calls & texts is
  the old Calls screen (Sona rule-break cards show the caller's exact words).
- **Estimate:** prep starts from a lead's address; then Permit (permit-vocab
  chips only), Drive time (named when it couldn't be read), 811, Access; Yard
  check, Measure, Properties on file, Permit rules.
- **Office** (replaces More and Queue): agent proposals at the top, each
  jumping to its panel; counted desk tiles for Follow-ups, Money, Fleet,
  Crew & safety, each with its R26 desk name above the title; then the rest
  (Agents, Teach Arbo, Assistant, Settings, Phone line…).

## What does not move

Every guardrail and ruling: §1B (a dead feed is named, never a confident zero),
R2 (the calendar is an iframe), R33 read-only Google/Quo, R32 read-only data,
the /api door, Spanish (R27) comes after. Links that exist today (home-screen
shortcuts, `#calls`, `#permits`, …) keep working and land on the new place.
