# Direction B — build plan

**Status:** plan only, not built yet. It merges three plans: ship order, safety, and taps. They were drafted read-only on 2026-10-21 against `claude/eloquent-wozniak-1y78ia` (main 38f5012 + `docs/DIRECTION_B.md`).

**Binding spec:** `docs/DIRECTION_B.md`. Precedence when sources disagree:
- A ruling beats a mockup.
- Existing copy beats mockup copy. The mockups are drawings with practice data.

**Base:** rebase onto main after TomTom (R35, branch `route-day-2`, 2b0cdda) merges.

## Facts checked in the code that shape this plan

1. **TomTom adds a sheet named `maps`, not `stop`.**
   - It also adds `openMapsStop`, `mapsDirUrl`, `renderTodayStops` and `#today-stops` above the Calendar iframe, plus its own minute interval.
   - It edits the SHEETS pins in `assistantUi`, `ownerTalk` and `quoPhotos`.
   - B adds no sheet and never edits `renderCalendar`, `routePlannerPanel` or the TomTom files.
2. **`#queue` is not a link today.** `VIEW_TITLES` has no `queue` key, so it lands on Today.
   - The links that exist today: every `VIEW_TITLES` key except `settings`; the manifest's `/app#calls`, `/app#cal` and `/crew?preview=1`; crew.html's way back, `/app#more`.
   - No test checks that the manifest shortcuts resolve.
3. **Production runs `ARBO_DATA_LINKS=readonly`.** `jobs`, `permits`, `photos` and `calls` stay cut.
   - So Today's run, Money and lead permit screens normally show as cut.
   - Every hub must be judged in cut mode, not only in sim.
4. **`renderToday` returns early when `/api/brief` fails, which is always the case in production.**
   - Anything new on Today must be placed and must start its reads **before** that `await`. This already burned Talk and Yard check.
5. **`holdsTyping()` holds a whole view while any `<details>` in it is open.**
   - So nothing permanent on a TIMED screen may be a `<details>`.
   - Permits is not TIMED, so folding it with `<details>` is safe.
6. **`ApiLead` carries `city` and `zip` but no street.**
7. **Section-agent proposals live only in the page's `AGENT_RUN`,** after a POST run in the current launch. Nothing stores or schedules a run.
8. **The downed-line bug is real.**
   - `guardrails.json` lists `"injured"` among the injury triggers, so "nobody was injured" is classed as an injury, and `receptionist.ts:279` adds the 911 line.
   - `emergencySafetyCalls()` already returns `call911:false` for these phrasings.
9. **Only 9 quick fixes are itemised anywhere** (the spec and the review page). The other ~6 of the "15" are not recoverable, and this plan does not invent them.
10. **Appearance and Install:** Appearance is on both Settings and More; Install is only on More. "Talk to Arbo" also appears in `docs/PHONE_SETUP.md`.

## Rules for every package

- **Cycle (CLAUDE.md):** tests first → `npm run check` → adversarial review of the diff → shots at 390×844 → commit → push → deploy by full SHA. Then verify all three: `git_ref`, `db connected` / `db READ-ONLY`, and `snapshotId: null`.
- **View ids:** none is renamed or removed. New ids are `estimate`, `money`, `fleet` and `safety`. Titles live only in `VIEW_TITLES`. Old dock buttons become `dock-hidden` (the existing pattern).
- **Navigation tables:** one `DOCK_OF` table says which tab lights. `NAV_PARENT` is used only when nothing is behind. Both hand-kept lists are replaced, not added to.
- **§1B:**
  - A failed read is a dashed tile or row with the `FEED_WORD`/`FEED_TAG` word. It is never a 0.
  - A dashed item is never tappable.
  - A "nothing here" line is drawn only when every read it depends on succeeded.
- **Pins:**
  - When a pin moves, it is rewritten for its new place and its meaning is kept, never deleted.
  - Every changed pin is listed in the commit with its reason.
  - Every default chosen is recorded in DECISIONS.md.
- **Lifted functions:**
  - Tests lift page functions with `pageFn`, so new helpers must be top-level `function x(` declarations with the closing `}` in column 0.
  - A helper called from a lifted render is stubbed in each test that lifts it:
    - `renderLeads`: qa2_calls-cal-leads, qa3_calls-cal-leads-settings-permits
    - `renderCalls`: qa3_quo-fold, r33Review
    - `renderFollowUps`, `renderBook`, `leadsTabBadge`, `emergencyLeads`: r26_owner-ui
    - `renderMore`: assistantUi
    - `buildHero`: qa2_today
    - `checkCard`: qa2_permits-measure-crew
    - `autoRefresh`: qa_shell, qa3
    - nav functions: navBack
- **Spanish (R27) later, so keep strings findable:**
  - Desk lines go in one `DESK_LINE` table; hub rows in `OFFICE_DESKS`, `ESTIMATE_TOOLS` and `ROLL_ROWS`.
  - Each visible sentence is one literal, with `plural()` for counts.
  - No text in CSS `content:` or SVG. Aria labels are JS literals.
  - Permit words always go through `permitChip`. 911/Dominion text is untouched.
- **No new POST in this plan.** P1's snapshot enforces it.
- **Browser harness, for every package:**
  - Playwright chromium at 390×844, `isMobile`, `hasTouch`, dpr 3; `localStorage.arborKey` set via `addInitScript`.
  - Three modes: sim, cut (unset), and `readonly` with no DB ("not set up"). Light and dark.
  - Always assert `document.scrollingElement.scrollWidth <= 390`, and that Back shows on every non-Today screen.
  - After a deploy, relaunch the home-screen app twice (the service worker is versioned by SHA).

## Deep links and Back (target state; P1 guards it, P19 finishes it)

| Link | Today opens | After B opens | Tab lit | Back with nothing behind |
|---|---|---|---|---|
| `/app`, `#today` | Today | Today | Today | hidden |
| `#calls` (manifest) | Calls | Leads › Calls & texts | Leads | Leads › New leads (pin changes, P19) |
| `#leads` | Leads | Leads › New leads | Leads | Today |
| `#cal` (manifest) | Calendar | Calendar, with R35 Today's stops | Calendar | Today |
| `#book` | Book | Estimate › Properties on file | Estimate | Estimate |
| `#permits` | Permits | Estimate › Permit rules | Estimate | Estimate |
| `#measure` | Measure | Estimate › Measure | Estimate | Estimate |
| `#followups` | the whole Queue | Office › Follow-ups | Office | Office |
| `#perf`, `#agents`, `#learn`, `#assistant` | More desks | Office desks | Office | Office |
| `#more` (crew preview's way back) | More | Office | Office | Today |
| `#queue` | not a link (lands on Today) | Office (new alias) | Office | Today |
| `#settings` | not a deep link (lands on Today) | unchanged | none | Today |
| new `#estimate` | — | Estimate | Estimate | Today |
| new `#money`, `#fleet`, `#safety` | — | Office desks | Office | Office |

**`DOCK_OF`:**

| Tab lit | Views |
|---|---|
| Today | `today` |
| Leads | `leads`, `calls` |
| Calendar | `cal` |
| Estimate | `estimate`, `book`, `permits`, `measure` |
| Office | `more`, `followups`, `money`, `fleet`, `safety`, `perf`, `agents`, `learn`, `assistant` |
| none | `settings` |

Back keeps its live mechanism. Every tab, segment and tile tap is one history step, and Back walks them in order. Sheets close first.

## Packages in ship order

| # | Package | Size | Depends on | Deploy group |
|---|---|---|---|---|
| P1 | Guard tests and baseline shots | S/M | TomTom merged | with P2 |
| P2 | Number keyboards and larger text | S | P1 | 1 |
| P3 | "Reading…" while loading | S | P1 | 1 |
| P4 | Rename the old receptionist page "Phone line" | S | P1 | 1 |
| P5 | Downed line, nobody hurt: Dominion only | S | — | 1 |
| P6 | Agents: proposals at the top | S | P1 | 1 |
| P7 | Navigate on each stop | S | TomTom `maps` sheet | 1 |
| P8 | Compact lead rows with a round call button | M | P1 | 1 |
| P9 | Permits folded, result pinned | M | P1 | 1 |
| P10 | Today: hero stats and tiles open what they count | M | P1 | 1 |
| P11 | Today: Before you roll | M | P10 | 1 |
| P12 | Feeds card (helper, then Today) | M/L | P11 | 2 |
| P13 | Queue split: Follow-ups, Money, Fleet, Crew & safety | L | P10, P11 | 2 |
| P14 | Office hub | M | P6, P13 | 3 |
| P15 | Estimate hub | M | P1 | 3 |
| P16 | Leads hub (head, segments, chips, badge, Calls & texts order) | M | P8, P12 | 3 |
| P17 | Call back clears a Sona flag | S/M | P16 | 3 |
| P18 | Prep estimate from a lead | S/M | P15 | 3 |
| P19 | Dock flip and the words that name old screens | S | P14–P18 | 3 |

- PRs merge one at a time. Auto-deploy is off, so main can carry merged work that is not yet deployed.
- **Group 1** is the quick fixes, which the spec says go first. It may ship as 2–3 deploys.
- **Group 2** ships under today's dock: the desks are reached from More's tiles.
- **Group 3** is one deploy, so the dock on Mike's phone changes exactly once.

### P1 Guard tests and baseline (S/M; no app change; must pass on main + TomTom)

**Goal:** lock what must not break before anything moves.

**Tests first:**
- **`test/directionB_links.test.ts`**
  - Each of `today leads calls cal book followups perf more permits agents measure learn assistant` resolves at boot to an existing `view-*`; only `today` lands on Today.
  - Serve the manifest (as `r25Routes` does): every `/app#x` shortcut resolves, and crew.html's `/app#more` resolves.
  - Every `switchTab('x')` literal and every `PROPOSAL_GO` target is a `VIEW_TITLES` key.
  - Every view except `today` and `settings` has a container, a lit tab, a parent, a draw path (TIMED or NAV_DRAW) and a ↻ path.
- **`navBack.test.ts` additions**
  - Today → Leads → Calendar → More, then Back three times, retraces Calendar, Leads, Today. It never rewinds to [Today, tab].
  - Every member of `SHEETS`, `maps` included, closes before a step back.
- **`test/directionB_deadFeeds.test.ts`**
  - Render with `api` rejecting four ways: `503 link_cut`; `503 db_not_configured` with LINKS `readonly`; `503 not_simulated`; network failure.
  - Assert the `FEED_WORD` appears, no 0 sits beside the feed's noun, and no calm phrase appears.
  - Seed it with `renderLeads`, `emergencyLeads`, `sonaPanel`, `renderSafety`, `renderFleetList`, `renderMoney`, `stormBanner` and the loops read.
  - A meta-check lists every `render*`/`*Panel` function as covered or exempt. Each later package adds its new functions.
- **`qa_gate` phrase gate**
  - The app never contains `All clear`, `Nothing holding`, `Nothing needs you`, `0 new leads` or `you're clear`.
  - `ready to text` / `Send catch-up` appear only in `outreachPanel`'s sends-on branch (R33).
- **`test/directionB_strings.test.ts`**
  - A curated list of ruling-carrying strings that must survive word for word:
    - the §1B words and the R32 line;
    - the Sona flag sentence, the slip rows, `SONA BROKE A RULE`, "… only in Quo now.";
    - the Quo read-only lines and `PERMIT_STATE` labels;
    - the yard verdicts and "Never a price, never a booking.";
    - the R2 calendar lines, `NO AERIAL WORK`, "⚠ CANNOT SEE";
    - the "This is not a claim that…" lines on Safety and Fleet.
  - A `RENAMED` map holds the approved renames: Book → Properties on file, Permits → Permit rules, Queue → Office / Follow-ups, Calls → Calls & texts, More → Office, Talk to Arbo → Phone line.
  - Removing a string without a `RENAMED` entry fails.
- **POST snapshot:** every `method: 'POST'` call site and path. A new one fails unless allow-listed with a ruling cited.

**Baseline shots (the "before" used to measure later packages):**
- Lead cards visible in the first 844 px (sim).
- Permits page height (sim, Virginia Beach).
- Today's first screen in cut mode.

### P2 Number keyboards and larger text (S)

**Goal:** two of the spec's quick fixes, CSS and attributes only.

**Files and functions (`index.html`):**
- **Keyboards:**
  - `inputMode='numeric'` on the `renderRosterList` level field and on `fleetComposer`'s height and weight fields. Keep `type='text'` so a typo still reaches the server's refusal.
  - Already correct, leave alone: the Yard `y-*` fields, prep ZIP, work ZIP.
- **Text:**
  - 12 px floor on `.eyebrow`, `.badge`, `.tile span/small`, `.loop-kind`, the field labels, `.cb-label`, `.cal-src`, `.internal-tag`, `.adetail .lab`, `.gtile small`, the nav label and the `.cal-day` TODAY pill.
  - `.brand small` goes to 11.5 px and must still fit one row.
  - Hero label alpha goes from .7 to .9.
  - `--ink-4` stays dots-only.

**Tests first:**
- Every numeric-purpose field carries `inputmode`.
- No `font-size` under 12px in the page `<style>` except listed selectors.
- Hero label alpha ≥ .85.
- `designTokens`: the four dot looks stay distinct (cut/sim grey, unset amber, unread hollow amber).

**Pins:** `qa_permits:160` (`.internal-tag` 11px), because that size is what is being fixed.

**Browser:**
- The fields carry `inputmode`. Playwright cannot raise the iOS keyboard, so the keyboard itself is checked on Mike's iPhone.
- Dock labels don't truncate. Badge rows wrap cleanly. The header subline stays one row. Check dark mode.

### P3 "Reading…" while loading (S)

**Goal:** screens never look empty while a read is in flight.

**Files and functions:**
- New `readingLine()` helper.
- Leads (blank today) and Calls (empty slots) show "Reading…" on the first draw only.
- A redraw keeps the old content until the read lands, then calls one `replaceChildren` (no flash).
- Also applied to: Book's list, Numbers, the Agents roster, Learn, Permits facts, Recommended sends.
- A failed read replaces "Reading…" with the named feed. A 401 hands off to the key wall.

**Tests first:** lift `renderLeads` and `renderCalls` with a pending `api`:
- exactly one "Reading…" before it resolves, none after;
- a rejecting `api` leaves none and names the feed;
- a second render over drawn content inserts none.

**Pins:** none. The harness fakes gain `hasChildNodes`.

**Browser:** delay `/api/*` by 1.5 s with a route. Each screen shows "Reading…", then its content. `autoRefresh()` causes no flash.

### P4 "Phone line" rename (S)

**Goal:** Mike renamed the old receptionist page "Phone line (off while Sona answers)". "Talk" now means only the R30 header button.

**Files and functions:**
- Today's `talkBtn` text becomes "Phone line". Keep `id="talk-btn"`; it is still removed while the line is cut.
- The More tile `Talk / Voice with Arbo` becomes "Phone line". Its cut subline "Off while Sona answers calls" is kept.
- `src/app/talk.html` `<title>`.
- `server.ts` talk-off page h1 → "Phone line is off".
- `docs/PHONE_SETUP.md`, in the same PR (CLAUDE.md rule).

**Tests first:** the Today button and the tile say "Phone line"; the header Talk button is unchanged.

**Pins:** `appUi:307,311` (keep the ordering pin), `qa_shell:102`, `vendorLinks:63`, and `ownerTalk` where it names the old button. Reason: Mike renamed the page.

**Browser:** in cut mode there is no Today button, and the tile reads "Phone line / Off while Sona answers calls", disabled. Check the `/talk` 503 page title.

### P5 Downed line, nobody hurt: Dominion only (S; unit tests only)

**Goal:** R29 #4 and the spec. The 911 line is added only for a real injury; the alert to Mike is unchanged.

**Files and functions:**
- `receptionist.ts:279`: add 911 when `calls.call911 || (intent.incidentType === 'injury' && !injuryDenied(text))`.
- New `injuryDenied()` in `src/reception/emergency.ts` covers "no one / nobody / no one's / nobody's … hurt|injured" and "not hurt|injured".
- `guardrails.json` and `intent.ts` stay untouched. The intent stays `injury`, so the alert and notify tier are unchanged.

**Tests first (`r26_reception`):**
- "power line is down, nobody was injured" and "no one is injured" give Dominion and no 911, with the alert tier unchanged.
- "my son is hurt and a line is down" gives both lines.
- "is anyone hurt? no" keeps 911 (R29 #4: detection stays sensitive).

**No browser check:** the line is cut (R21) and retired (R36).

### P6 Agents: proposals at the top (S)

**Files and functions:**
- New `agentProposals(run, roster)` returns `[{desk, text, kind}]` in roster order, through `noRefs`.
- `renderAgents` draws "Proposals for you (N)" above the first `.card.agent`. Each button comes from `PROPOSAL_GO` and calls `switchTab`.
- The stale-run line (over 15 minutes) and "The run did not complete…" draw **above** the list.
- With no run: "Run all eight first", never "no proposals".
- After a run with nothing proposed: "No proposals — N desks couldn't read everything" when any desk was degraded or blocked. A bare "none" appears only when every desk read fully.
- The per-card proposal notes stay.

**Tests first:** lift `agentProposals`. Lift `renderAgents` with a fake `AGENT_RUN` and check:
- the panel comes before the cards;
- the buttons go to the right targets;
- the degraded empty state is named;
- the no-run wording is right.

**Browser:** sim: run all eight; the proposals are on the first screen; a tap lands on the right screen; Back shows the run still drawn.

### P7 Navigate on each stop (S; after TomTom)

**Files and functions:**
- In `renderToday`'s stop loop, add a full-width **Navigate** button (`i-route`, at least 48 px) that calls TomTom's `openMapsStop({title, address})`. It asks first, through R35's sheet.
- `mapsDirUrl` stays the page's only Maps URL builder. A stop with no address gets no button.
- The address link and "Route the day" are kept. R35's Calendar rows are untouched.

**Tests first:**
- One Navigate per stop card, with the full address.
- None without an address.
- A source scan finds exactly one Maps URL builder.

**Browser:**
- Sim: Navigate opens "Open in Google Maps?". X, Back and the edge swipe each close it. Yes opens a new tab.
- In production the run is cut, so real stops are R35's on Calendar.

### P8 Compact lead rows (M)

**Files and functions (`renderLeads`):**
- Call back moves into `.toprow` as `a.callbtn.round` (`i-calls`), with a visually hidden "Call back" span and `aria-label="Call back"`. Drop `flexBasis:100%`.
- CSS: a 52 px round button, tighter gaps, `.scope` clamped to 2 lines.
- Unchanged:
  - Good lead / Spam keep their words and aria labels.
  - The spam Undo hold stays intact.
  - Older leads and leads with no phone get no button (R32).
  - Today's emergency card and the Sona cards keep their big Call back.

**Tests first (qa2 fake DOM):**
- A lead with a phone has exactly one `.callbtn`, inside `.toprow`, with its accessible name.
- No element has `flexBasis`.
- An older lead has no button (that test already exists).

**Pins:** none expected. Confirm that `qa2:155,157` still find "Call back" through the hidden span.

**Browser:**
- Cards in the first 844 px are at least 2× the P1 count.
- The button is at least 48×48.
- A long SIM name does not collide with the button. No horizontal scroll.

### P9 Permits folded, result pinned (M)

**Files and functions (`renderPermits`):**
- Each fact topic becomes a closed `<details class="topic">`.
  - Its summary is "TOPIC · N rules" plus counts of its status chips, so UNCONFIRMED and RE-CHECK DUE stay visible while folded.
- The job check stays on top.
- **Result pinned:** a sticky one-line verdict above the questions.
  - It shows the strongest chip (alarm > stop > watch > info) through `permitChip`/`PERMIT_STATUS`, plus "N steps · city".
  - A tap scrolls to the results. CALL FIRST and TICKET REQUIRED stay on it.
- `checkCard`'s "Source & date checked ↓" opens the enclosing `<details>` before it scrolls.
- Permits stays out of TIMED.

**Tests first:**
- Topics render closed, with their counts.
- The source jump opens the topic.
- The verdict uses permit words only.
- `forbiddenStrings` / `FORBIDDEN_CLEAR` still pass over the render.

**Pins:** the `qa2_permits-measure-crew:220–243` fake node needs `closest`. This is a harness change, not a behaviour change.

**Browser (VB):**
- Page height drops from about 22 screens to about 3 (compare with P1).
- A topic opens. The source jump and "↑ Back to the job check" both work.
- The header Back leaves Permits in one step.

### P10 Today: stats and tiles open what they count (M)

**Hero (`buildHero`):**
- Add `HERO.go(key, fn)`; stat cells become buttons.
- `HERO.stat(key, '–', …)` renders `.hstat.gap`: dashed, `aria-disabled`, worded with `FEED_TAG`, and no handler.
- Targets:
  - Stops scroll to Today's run, or to the schedule card.
  - Loops go to `DESK_VIEW.loops`.
  - Weather alerts above 0 scroll to the storm card.
- Weather at 0 stays inert but not dashed, because a real zero is a fact.

**Tiles (`renderToday`):**
- Add `goTile(t, fn)` on its own line, so the pinned `tile('–','jobs today')` shape is kept.
- Targets:
  - jobs and estimates → the run;
  - coming due → `book`;
  - agent runs → `agents`;
  - overdue and to bill → `DESK_VIEW.money`;
  - emergencies → the first emergency card;
  - flagged → the first flagged stop.
- A gap tile (`tileWhy`) is dashed and inert.

**New helpers:**
- `openPanel(view, id)`, modelled on `openSonaCall`: switch, retry-find, scroll, flash.
- `DESK_VIEW = {loops, money, fleet, safety}`, all pointing at `'followups'` for now. Add the ids `queue-money`, `queue-fleet` and `queue-safety` to the Queue's slots. P13 re-points them in one place.

**Tests first:**
- Lift `buildHero`: `go` makes a clickable button; a '–' stat is `.gap`, inert and worded.
- Source pin: every tile target comes from `DESK_VIEW` or a `VIEW_TITLES` key.

**Pins:** qa2_today T1's fake `el` gains button and click support. The tile pins (`qa2_today` T3, `scheduleSource`) are kept.

**Browser:** in sim and cut, tap every stat and tile and check where it lands. Cut-mode stops and weather are dashed and do nothing. Back returns to Today at the same scroll.

### P11 Today: Before you roll (M)

**Placement:** new top-level `beforeYouRoll(emgP, stormP)`. Its slot sits directly under the hero, and it is placed and starts reading **before** the `/api/brief` `await` (a static test checks this).

**Reads:**
- `/api/safety` (`aerialBlocked`, `blindSpots`).
- `/api/fleet/units` (down and held units).
- The existing `emergencyLeads()` promise and `stormBanner()`'s outcome. Nothing is read twice.

**Rows (from `ROLL_ROWS`):**
- **Crew & safety:** "NAME can't go aerial" → `openPanel(DESK_VIEW.safety)` and that person's `[data-crew]` card. Each blind spot gets a "⚠ CANNOT SEE" row.
- **Fleet:** "UNIT is HELD/DOWN · reason" → Fleet, with the unit flashed.
- **Leads:** the emergency → its card.
- **Weather:** an alert → the storm card. If unreadable: "Weather alerts: couldn't read — not the same as none" with a ↻ that retries `/api/storm` only.

**Rules:**
- Every unreadable read gets its own named row.
- Cut and not-set-up reads share one muted line.
- The header chip reads "N to check · M couldn't read". Only real items are counted in N.
- "Nothing to check before you roll" appears only when every read succeeded and `blindSpots` is empty.
- This is new code; `renderSafety` is untouched.

**Tests first (lift, stub `api`):**
- 3 items give 3 rows, "3 to check", and the right targets.
- Safety unreadable gives a named row and never the clean line.
- All cut gives one muted line and no clean line.
- All read and empty gives the clean line.
- The static placement check.

**Pins:** none expected. The `qa_today:20–27` order still holds; check `assistantUi:583`.

**Browser:**
- Sim: the first screen shows the hero and at least 3 rows, and each row lands.
- Cut: one muted line, and the run is not pushed off.
- Dark mode.
- Cost: two more reads per minute on Today, which is acceptable.

### P12 Feeds card: helper, then Today (M/L)

**Helper:** new `feedsCard()` returns `{el, place(slot, node)}`.

**Marking off-feed wrappers:**
- Wrappers that only report a dead feed are marked `data-off="<kind>"` and `data-feed-name`. This extends `locationStrip`'s existing `dataset.feed` pattern.
- Applies to `receptionStrip`, `inboxIntentPanel`, `websiteFormsPanel`, `stormLawFlag`, and `fillQuoSlots` (which gains an optional `place` parameter).
- `renderToday`'s `.then(b => slot.appendChild(b))` lines become `feeds.place(slot, b)`.

**The card:**
- Headline from `FEED_WORD`: "N feeds off: X cut on purpose, Y not set up, Z couldn't read".
- A button toggle with `aria-expanded` lists every feed. It is never a `<details>` (fact 5).

**What folds and what stays visible:**
- Cut, not-in-the-practice-data and not-set-up feeds fold into the card.
- **Couldn't-read feeds stay inline where the number would be, and are also counted in the card.**
- Partial-read lines never fold: capped weeks, "could not be read this pass", failed holds, `blindSpots`.
- The card counts only the screen's own reads through `place()`, never `/health/feeds` (two sources could disagree).
- A read still in flight shows "Reading…" and is not counted as working.
- The R32 read-only line and the schedule card ("Open the Calendar tab") stay where they are.

**Tests first:**
- Lift `feedsCard`: an off wrapper moves in and counts; an unread wrapper stays in its slot and counts; a normal node goes to its slot; the card has no `<details>`.
- Source pin: every Today slot goes through `place`.

**Pins:**
- `appUi:274` (the `receptionStrip` placement line).
- `qa2_today:269–275` (`locSlot` class swap, `dataset.feed`).
- `qa3_quo-fold` slot expectations, if `fillQuoSlots` gains `place`.
- Reason for all three: placement now goes through the card.

**Browser:**
- Cut mode, against P1's shot: the first screen is the hero, Before you roll, then the day, not a column of notices.
- The open card names every feed.
- Sim says "not in the practice data"; readonly with no DB says "not set up".

### P13 Queue split: Follow-ups, Money, Fleet, Crew & safety (L)

**New views (`index.html`):**
- Add `view-money`, `view-fleet` and `view-safety`. Each new render draws its viewhead (the `DESK_LINE` eyebrow and title) **before any read**, has an `FU_GEN`-style generation guard so overlapping renders can't double-append, and then calls the existing panels unchanged:

  | Render | Desk line | Panels it calls |
  |---|---|---|
  | `renderMoneyView` | Yard Boss | `renderMoney` |
  | `renderFleetView` | Yard Boss | `renderFleet`, including the Bouncie line |
  | `renderSafetyView` | Crew Chief | `renderSafety` (blind spots and aerial first), `renderRoster`, `renderTrainingBoard`, `renderVetting`, `renderLibraryDesk` |

- `renderFollowUps` keeps the loops and Recommended sends, with the h1 "Follow-ups" (Chief of Staff), and keeps `#queue-loops`.

**Tables and wiring:**
- `VIEW_TITLES`: add `money` 'Money', `fleet` 'Fleet', `safety` 'Crew & safety'; `followups` becomes 'Follow-ups'.
- `switchTab` takes its view list from `Object.keys(VIEW_TITLES)`.
- `DOCK_OF` replaces the hard-coded More list.
- `NAV_PARENT`: the three new views → `more`.
- `TIMED` and `refreshAll` gain the three renders.
- More's Queue tile becomes four tiles.

**Retargets in the same commit:**
- **`PROPOSAL_GO`:**

  | Proposal kinds | Opens |
  |---|---|
  | `collections_review` | `money` |
  | `parts_review`, `signback_review` | `fleet` |
  | `fix_credentials`, `lesson_draft`, `vet_reference` | `safety` |
  | `decide_open_loops` | `followups` |
  | `area_review` | `perf` |
  | `call_review` (unchanged) | `calls` |
  | `route_fix`, `weather_hold_review` (unchanged) | `cal` |

- **`DESK_VIEW`** is re-pointed. The cross-screen aerial row uses `openSonaCall`'s polling pattern to find its card.
- **The breakdown sheet's `bd-go`:** after a successful filing, redraw Fleet and Today, not `renderFollowUps()`.

**Server text and docs:**
- `src/agents/sections.ts`: sections become 'Today & Follow-ups', 'Money & Fleet', 'Crew & safety'. The three "on the Queue" texts are reworded to name the new screens.
- `docs/BOUNCIE.md:157`.

**Each desk keeps its failure wording word for word:**
- "Safety board — …" and "This is not a claim that everyone is current."
- "Fleet — …" and "This is not a claim that everything runs."
- "That is not a sign that nothing is open."
- "Nothing due from what Arbo could read" and "This is not a claim that none are due."

**Tests first:**
- Each new view draws its head before any read.
- A dead money feed does not touch Fleet.
- `DOCK_OF` and `NAV_PARENT` entries for the three.
- Every `PROPOSAL_GO` target is a drawable view.
- `bd-go` redraws Fleet.
- The dead-feed harness gains the three renders.

**Pins (the Queue is no longer one screen; each is rewritten per screen with its meaning kept):**
- `qa_queue:21–36`
- `qa2_queue-numbers-book:364–368`
- `r26_owner-ui:213–229`, `248–255`
- `qa3_queue-desks:114`, `131`
- `assistantUi:913–914`
- `sections.test:137`

**Browser:**
- More → each desk lands with its eyebrow and title.
- Fleet's first screen shows the units (they were 5+ screens down).
- The Before-you-roll rows land on Fleet and Crew & safety with the item flashed.
- "Open Fleet →" from Agents lands on Fleet.
- Today → row → Fleet → Back → Today.
- The "Crew & safety" title doesn't collide with Talk, the gear or ↻.

### P14 Office hub (M)

**`renderMore`** keeps its name (NAV_DRAW, the tab handler and the pins all use it).

**Head:**
- Eyebrow "The back office".
- h1 "N desks need you" (counting red or amber tiles), plus "· M couldn't be read" when any desk read failed. It never claims calm over an unread desk.

**Proposals card:**
- `agentProposals(AGENT_RUN)` from P6, headed "Agents · ran TIME", with the stale line.
- With no run this launch: "Not run since Arbo started" and a **Run all eight** button (the same read-only POST).

**`OFFICE_DESKS`** (the mockup's order). Each tile shows "Reading…" first. A failed read gives a dashed tile with the feed word and no digit.

| Desk line | Tile | Count and subline | Opens |
|---|---|---|---|
| Chief of Staff | Follow-ups | N open loops · M haven't heard back — "to text from the Quo app" (R33) | `followups` |
| Yard Boss | Money | N overdue · M to bill · K can't tell. `moneyCounts(m)` is shared with Today's tiles so both agree. Reads cut under readonly. | `money` |
| Yard Boss | Fleet | N held or down · M units up | `fleet` |
| Crew Chief | Crew & safety | N no aerial (plus blind spots) · M certs due in 30 days | `safety` |
| Analyst | Numbers | ad spend, or dashed "Ads: not set up yet" | `perf` |
| Learn | Teach Arbo | N to approve | `learn` |

**Also here (`.grid-tiles`):**
- Assistant first, with its waiting count (R28).
- All eight agents.
- Crew view (the R26 string, exact).
- Phone line.
- Appearance and Install stay (Q4).
- The feeds card.

**Titles:** `VIEW_TITLES.more` → 'Office', `learn` → 'Teach Arbo'. The dock label waits for P19.

**Tests first (lift `renderMore` with a per-path `api` stub):**
- The tile counts.
- `/api/money` returning `link_cut` gives a dashed Money tile with no digit.
- Assistant is first in `.grid-tiles`.
- The proposals card from a fake run; the Run button when there is none.
- The heading names the couldn't-read desks.

**Pins:**
- `assistantUi:932–960`: the `api` stub must accept the new reads; Assistant-first still holds.
- `qa_shell`'s More block: 'The rest of Arbo, one tap away.' and 'Which areas & ads pay'. Numbers is now a desk tile.

**Browser:**
- The first screen shows the proposals card and four tiles.
- Every tile lands. Cut tiles say why.
- Back from a desk goes to Office. A cold `#money` with Back goes to Office.
- The `/crew?preview=1` way back lands on Office.

### P15 Estimate hub (M)

**New view `view-estimate` and `renderEstimate()`:**
- Eyebrow "Arborist · Permit Desk", h1 "Before you write it up".
- `estimatePrepPanel()` moves here from `renderBook` and is drawn before any read.
- **Result rows use the server's words:**
  - Permit: permit chips only, plus "Open the job check ›" → `permits` with the city filled in.
  - Drive: named when unread; ↻ rebuilds.
  - 811.
  - Access: the typed access notes.
- "Prep sheet unavailable right now — nothing was screened." and PERMIT SCREEN PENDING are kept.

**`ESTIMATE_TOOLS`:**

| Tool | Opens |
|---|---|
| Permit rules | `permits` |
| Measure a tree | `measure` |
| Yard check (keeps the pinned "Yard check — will this job pay?") | `openYard()` |
| Properties on file, "N on file · M coming due" from `/api/properties`, named on failure | `book` |

**Other changes:**
- `renderBook` drops the prep panel; its h1 becomes "Properties on file".
- `renderToday` drops `yardBtn`.
- `VIEW_TITLES`: `book` 'Properties on file', `permits` 'Permit rules', `estimate` 'Estimate'.
- `NAV_PARENT`: `book`, `permits` and `measure` → `estimate`; `estimate` → `today`.
- `DOCK_OF` gains the Estimate group.
- `TIMED` gains `estimate`; `holdsTyping` keeps a half-typed address.
- Until P19, an Estimate tile on More replaces the Book, Permits and Measure tiles.
- "Recent preps" is not built: it needs storage, which is new scope.

**Tests first:**
- The head and the prep panel come before any read.
- The tool targets; Yard check opens the sheet.
- `renderToday` has no Yard check.
- Book's children are `['viewhead','state']` in cut mode.
- `navBack` reads the page's own `NAV_PARENT`.

**Pins (R29 #1 moved Yard check):**
- `qa_today:30–35`
- `qa2_today:234,355–357`
- `r26_owner-ui:190–198`, `242–244`
- `navBack:86` (the NAV_PARENT literal) and `:96–97` (cold `#permits` Back now lands on `estimate`)

**Browser:**
- The first screen is the head and the prep form; inputs are at least 16 px so iOS doesn't zoom.
- Each tool lands.
- Yard check: the sheet opens, the P2 keyboards work, and X and Back close it.
- Today has no Yard check. Cold `#book` / `#permits` with Back go to Estimate.

### P16 Leads hub (M)

**Markup:**
- `<div id="leads-head" class="hubhead">` sits before `view-leads`, outside both views. This keeps `renderLeads`, `renderCalls` and every test that lifts them untouched, and keeps their holds independent.
- `switchTab` shows it for `leads` and `calls` with a class toggle, not `[hidden]` (the `.sys` lesson).

**`renderLeadsHead()`:**
- Eyebrow "Front Desk".
- **h1:**
  - New leads: "N new leads, M emergency".
  - Real data with none: "New leads are not in Arbo", never a 0.
  - Calls & texts: "N calls need you".
- **Sona flag** from `sonaSlipBox(d)`, extracted from `sonaPanel` so Today and the head share one builder. It shows on both segments.
  - Quo unreadable: a named line in the flag's place.
  - Quo not set up: the fold words, once.
- **Segments** `New leads N` / `Calls & texts N` call `switchTab('leads'|'calls')`; each tap is a Back step. An unread count shows '–' plus the feed word.
- **Filter chips** All / Emergency / Call back, on New leads only.
  - They set `#view-leads[data-filter]` (hiding is done in CSS) and are not Back steps.
  - The filter is kept in a variable, so it survives the minute redraw.
  - EMERGENCY cards show under every filter. `openLead` resets the filter to All.

**Refresh and order:**
- `autoRefresh` calls `renderLeadsHead()` every minute even when both views are held (one line).
- On Calls, `sonaPanel(…, true)` skips its own slip box because the head carries it. Today keeps its box.
- **`renderCalls` order follows the mockup:** Sona calls first, then the customer study, outreach, texts and photos, notes, and the line card.
- The Calls & texts cut lines go through `feeds.place`. Both segments get the feeds card.

**Badge:**
- New `sonaTabBadge(err, n)` beside `leadsTabBadge`.
- The dot counts emergencies plus unhandled Sona flags.
  - An emergency counts when `isEmergency && status !== 'qualified'`.
  - `filedAsEmergency` on an older lead never counts.
- Sona slips never join Today's emergencies tile.

| Leads read | Quo read | Badge shows |
|---|---|---|
| ok, n | ok, m | red count n+m |
| failed | ok, m | m plus the gap marker; the label says "Emergency leads unknown — not zero." |
| ok, n | failed | n plus the gap marker; the label says "Sona calls unknown — not zero" |
| ok, 0 | ok, 0 | no dot |
| any | Quo not set up | an `unset` gap |

**Tests first:**
- Lift `renderLeadsHead` with stub reads:
  - the counts;
  - flag rows call `openSonaCall`;
  - Quo unreadable gives a named flag area and a '–' segment;
  - chips set `data-filter`, and an emergency survives every filter;
  - the badge matrix.
- An open transcript in `view-calls` does not hold `view-leads`, and the reverse.
- The head refreshes while both views are held.
- `openSonaCall`'s target view holds the `[data-sona-call]` cards.

**Pins:**
- `navBack:178–184`: the sliplink pins move to `sonaSlipBox` (same text).
- `r26_owner-ui`: the badge wording "Leads: N emergency leads" is kept.
- `qa3_quo-fold`, `r33Review`, `quoPhotos`: the `renderCalls` slot order changes because Sona moved first (mockup).

**Browser:**
- Sim: the first screen is the head plus at least one compact row.
- Tap Calls & texts, then Back returns to New leads.
- The chips filter. A flag row flashes the red card.
- Cut: the Calls & texts count is '–' and named.

### P17 Call back clears a Sona flag (S/M)

**Behaviour:**
- Tapping Call back on a flagged Sona card (or on its flag row) marks every open flagged call from that caller as handled.
- The mark is kept on this phone (localStorage, wrapped in try/catch), by **call id only, never the number**, and pruned after 7 days (Q2).
- The head and the badge skip handled calls.
- The card stays in history with `SONA BROKE A RULE` and a muted "Handled — you tapped Call back at 7:14".
- A new slip (a new `callId`) raises the flag again.
- If storage is lost, the flag comes back (the loud direction).
- No POST, no database write, no Quo write (R32/R33).

**Tests first:**
- A tap marks the right ids; the head and badge counts drop; the card stays.
- A new `callId` raises the flag again.
- A throwing storage keeps the flag.
- No phone number is stored.
- The POST snapshot is unchanged.

**Browser:** tap Call back on SIM-Hazel. The flag leaves the head and the badge, and the card stays. Check it survives the minute redraw and a relaunch.

### P18 Prep estimate from a lead (S/M)

**Behaviour:**
- A lead row gets "Prep estimate ›". It opens Estimate prefilled: a "From NAME's lead" pill (× clears it), the street, city, ZIP and details.
- The lead is handed over by id, in memory. **Never** through the hash, `history.state`, storage or a log, because addresses are customer details.
- The spec says prep starts from the lead's address, so `/api/leads` adds `street` from the lead's property. This is a read through the properties link, which is readable under readonly, with the owner key as now.
- With no property, the city and ZIP are filled and the street field is focused with "Street not on file". An unreadable property is named.

**Tests first:**
- Server: the street comes from the property; no property gives null; a failed property read is named, not empty.
- Lift the prefill function; the hash and history are unchanged after a prefill.

**Browser:** tap the button; Estimate opens prefilled and builds; Back returns to Leads.

### P19 Dock flip and the words that name old screens (S)

**Dock:**
- Today · Leads · Calendar · Estimate (new `tab-estimate`, `i-tree`) · Office (`tab-more` relabelled).
- `tab-calls` becomes `dock-hidden`. `DOCK_OF.calls = 'leads'`; `NAV_PARENT.calls = 'leads'`.

**Boot:**
- The boot hash block becomes `startView(hash)`, using the same draw path as `navShow`, so the matrix can be tested.
- Add `VIEW_ALIAS = { queue: 'more' }`.

**Manifest:** the shortcut name 'Calls' becomes 'Calls & texts'; the URL is unchanged.

**Copy that names old screens:**
- `assistant.ts:436–444` and index.html's "Open More → Assistant" → "Office → Assistant".
- `crew.html:1064` ("More, then Crew").
- `sections.ts`: front-desk 'Calls' → 'Leads › Calls & texts'; arborist 'Measure & Book' → 'Estimate'.
- `docs/GO_LIVE.md` paths and `docs/R27_SPANISH_PLAN.md:44`.
- OWNER_RULINGS is untouched.

**Tests first:**
- Exactly five visible dock buttons, in order, with their labels.
- Every `VIEW_TITLES` key lights at most one tab; `settings` lights none.
- The whole deep-link matrix through `startView`, `#queue` included.
- Manifest URLs are unchanged. P1's link guard is fully green.

**Pins:**
- `assistant.test:1176`, `assistantUi:659,684,689` ("More → Assistant").
- `r26_owner-ui:248–255`, `sections.test:430` (section names).
- The `navBack` lit list, and `navBack:99–100`: a cold `#calls` Back now lands on Leads. Reason: Calls & texts is a child of the Leads tab, the same way More desks land on More.
- `qa_shell:58` still passes (same `tab-more` prefix).

**Browser:**
- Five labels fit with no truncation; targets are at least 44 px wide.
- Cold-start every link in the matrix.
- A six-tap walk is retraced by Back.
- On Mike's iPhone, in the installed app: launch lands on Today, the edge swipe works, and the crew preview's way back lands on Office.

## Where the three plans disagreed, and what this plan does

| Question | What the plans said | Resolved | Why |
|---|---|---|---|
| TomTom's sheet | brief: `stop` | `maps`; B adds no sheet | That's what the code at 2b0cdda adds |
| How often the dock changes | once at the end / nav core first / three times | Hubs merge under today's dock; the dock flips once (P19); group 3 is one deploy | Mike sees one change. P1's guards give the nav-core safety up front |
| Crew & safety view id | `safety` / `crew` | `safety` | `crew` is too close to the crew door and the Crew view |
| `#queue` | no alias / Office / Follow-ups | Alias to Office | The spec says Office replaces More and Queue; `#followups` is the Follow-ups desk |
| Cold `#calls` Back | Today / Leads | Leads | Calls is now a child of the Leads tab; "as built", children land on their hub |
| Dashed stats tappable | Stops dashed → Calendar / never | Never | One rule, from the spec's weather rule. The cut schedule card already has "Open the Calendar tab" |
| Reach of the Phone line rename | in-app only / the page too | The whole page, plus PHONE_SETUP.md | Mike renamed "the old receptionist page" |
| Slimming Today to the mockup | move study, outreach, forms off Today / keep | Keep for now (Q1). Yard check moves (R29 #1); the tiles stay (the spec makes them tappable) | R28 #4, R26 and R34 name Today; the mockup can't override a ruling |
| A Sona row in Before you roll | add / not add | Not added; the Sona panel stays on Today | The spec lists four kinds of row. Revisit with Q1 |
| Where "Call back handled" is stored | server memory / this phone | This phone (Q2) | Simplest; no new route or POST; fails loud |
| Calls & texts order | keep / Sona first | Sona first | The mockup; the flag lands on screen 1 |
| Couldn't-read feeds | fold / stay inline | Inline **and** counted in the card | The spec: "a failed feed is still named, never hidden" |
| Prep street address | city and ZIP only / add street | Add street (read-only) | The spec: "prep starts from a lead's address" |
| Office tile order | "safety leads" / mockup | Mockup order; red markers carry urgency | The spec's mockups; Before you roll leads with safety on Today |
| Follow-ups tile wording | "2 texts ready to send" | "haven't heard back — to text from the Quo app" | R33: Arbo cannot send |
| Mockup copy vs existing copy | — | Existing copy wins (the R36 line card, "No hold filed…", "Talk to Arbo") | Rulings carry the existing words |

## Tap counts (starting on Today, scrolled to the top; screens are estimates at 390×844)

| Job | Before (main) | After B | Change |
|---|---|---|---|
| A. Call back a new lead | 2 (Leads → Call back); about 1 screen per lead | 2 (Leads → round button); about ½ screen per lead | Twice as many leads per screen |
| B. Call back an emergency lead | 1 (Today's red card) | 1 (same card; Before you roll points to it) | = |
| C. See a Sona flag and what she said | No badge. Today: 0 taps but about 6 screens down. Calls: 1 + a scroll past up to 60 study cards + 1 | A badge on every screen. Leads (1): the flag is on the first screen; its row (2) shows her words | Buried → screen 1 |
| D. Call back the Sona-flagged caller | Today: 1 after about 6 screens; Calls: 3 + a long scroll | 3, no scroll (Leads → flag row → Call back); the flag clears | No scroll; the flag clears |
| E. See a held truck | 2 (More → Queue) + about 8 screens; not on Today | 0 to see (Before you roll, screen 1); 1 to the unit, flashed | Invisible → screen 1 |
| E2. Sign it back on | E + 2 | 1 + 2 | −1 tap and the scroll |
| F. Prep an estimate for a lead | About 7 (More → Book → address, city ×2, ZIP, job type ×2 → Build) and retyping | 3 (Leads → Prep estimate › → Build); no retyping when the property has a street | −4 taps, no retyping |
| G. Yard check | 1, but 2–3 screens down Today | 2 (Estimate → Yard check), no scroll | +1, approved (R29 #1) |
| H. See money owed | A count on Today that can't be tapped; the list = 2 + about 7 screens | 1 (Today's overdue tile → Money, owed first), or 2 via Office | No scroll |
| I. Approve an agent proposal (sign Unit 3 back on) | 6 + two long scrolls (More → Agents → Run → hunt → Open the Queue → scroll → Sign → confirm) | 4 (Office → proposal → Sign → confirm); +1 Run if nothing ran this launch | −2 taps, no scrolls |
| I2. Approve an assistant ask (R28) | 2 (Today row → Approve) | 2 | = |
| J. Route the day, in production | Can't be done (the schedule is cut) | 3 through R35, which is TomTom's, not B's (Calendar → Route the whole day → Yes). B adds Navigate per stop (2 taps) wherever Arbo's schedule reads | Impossible → 3 |

## Questions for Mike (each has the default the build uses)

1. **Today, beyond the mockup.** The customer study (R34 names Today), inbox cards (R17), website forms (R19), outreach and the Sona panel are on Today now; the mockup leaves them out.
   - *Default:* keep them on Today, below the day.
   - If they move, they go to Leads: the study, outreach and Sona panel to Calls & texts; forms and inbox to New leads. A Sona row then joins Before you roll, so Today never goes quieter.
   - Not in question (rulings keep them on Today): the R28 office check and approvals, the emergency cards, storm and storm-law, the location strip.
2. **Where "handled" is remembered after Call back.**
   - *Default:* on this phone, by call id.
   - The alternative is Arbo's server: it covers all devices, but marks are forgotten at each deploy, so flags return.
3. **Agents on a timer.** The mockup's "ran 6:00 AM" needs a scheduled read-only run of the eight desks, which is new scope.
   - *Default:* no timer. Office shows this launch's run, or a Run button.
4. **Appearance and Install behind the gear**, as the mockup's footnote shows.
   - *Default:* they stay on Office (pinned today). "Español" is not shown until R27 is built.
5. **The other ~6 of the "15 quick fixes."** Nothing recoverable lists them.
   - *Default:* build the nine that are written down and invent none. Mike names the rest, or the review page's findings are re-read.
6. **The hero's "Stops today" after R35.** Should it count Arbo's bookings (cut in production) or R35's Google Calendar stops?
   - *Default:* unchanged. This is an R35/H4 call, not B's.

## Risks

- **Today's early return:** anything placed after the `/api/brief` `await` never draws in production. P11's static check and P1's dead-feed harness guard this.
- **`<details>` freezes refresh:**
  - A `<details>` on a TIMED screen holds its minute redraw. The feeds card is a button toggle; Permits stays out of TIMED; the Leads head refreshes outside the holds.
  - A transcript open on Calls & texts must never hold New leads (the two-container design).
- **Cut is the normal state in production:** cut, not set up and couldn't read are the screens Mike actually sees. Every package's screenshots include cut mode and readonly without a DB.
- **Test churn and the TomTom rebase:**
  - `assistantUi`, `navBack`, `r26_owner-ui` and `qa2_today` are edited by several packages, and `assistantUi` by TomTom too. Rebase each PR on main.
  - A rewritten pin must keep its meaning; P1's surviving-strings test catches a silent deletion.
- **Cross-screen flash targets:** a Before-you-roll row or a proposal may land before its panel has drawn. `openPanel` retries the find, as `openSonaCall` does, and a miss still lands on the right screen.
- **A badge from two reads:** a failed half must never read as zero. The P16 matrix pins every case.
- **Stale proposals:** a run from earlier in the launch can look current. The stale line always draws above the list, and "no proposals" is never shown without a run.
- **Customer details in the prefill:** the lead's street travels by id in memory only, and P18 tests the hash, history and storage.
- **Mockup copy creep:** the mockups' words are practice text. Existing ruling-carrying strings win; P1's string list and the phrase gate enforce it (e.g. "texts ready to send" breaks R33).
- **Two "today's stops" after R35:** Arbo's bookings on Today versus Google's on Calendar. This plan flags it and does not resolve it (Q6).
- **Load:** Before you roll adds two reads a minute on Today, and the Leads head adds its own leads and Quo reads. Both are acceptable. If `/api/quo` proves slow, the head shares Calls' promise instead.
- **Service worker caching:** after each deploy, Mike's installed app needs two relaunches before it can be judged.
