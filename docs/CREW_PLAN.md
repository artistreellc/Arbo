# Crew door: tightening plan

**Status:** C1–C4 built: D107, D109 (C1 and C2 review-fixed in D107's review round), not deployed. C5–C8 wait on Q0 and Mike's rulings; C3's real-iPhone sign-in check is on GO_LIVE §2. The plan was drafted read-only on 2026-10-21 against main `e4a6415`, after Direction B, R35 TomTom and audit wave 1. Live row counts were not re-checked. They come from `docs/DATA_LINKS.md` (2026-09-24) and GO_LIVE. Nobody checked whether `CREW_ACCESS_KEY` is set on production, because Railway can't be reached from here.

**Goal (Mike, 2026-10-20):** *"the map, the crew section, everythimg else really needs to start tightening up"*. For launch Mike said *"I use it daily first"*, and the date is October 2026. That reads as Mike using the app daily himself before the crews do. So October's crew scope is C1–C4 plus his preview, unless he says crews go live this month (Q0). If they do, a crew member's day goes like this: open `/crew` at the yard, read and sign today's briefing, see today's confirmed jobs, tap Navigate.

**Binding:** CLAUDE.md (§3 included), `docs/OWNER_RULINGS.md` (R2, R9, R24, R26, R27, R29, R31, R32, R33, R35), `docs/DATA_LINKS.md`, `docs/DIRECTION_B_PLAN.md`, DECISIONS D89–D105, `docs/OPS_CONVENTIONS.md` (§6, the contract rules and Conflicts 3 and 8), `docs/GO_LIVE.md`.

## Bottom line

Production runs `ARBO_DATA_LINKS=readonly` (D97). On that setting no crew member can get through one day on the crew door. Five things stop it:

1. **`CREW_ACCESS_KEY` is probably not set (unverified).** If it isn't, the door answers `crew_key_not_set`.
2. **The roster can't be filled.** Adding a crew member is a write, and R32 refuses every write.
3. **No briefing can be published.** Nothing in `src` writes a `tailgate_brief` row. `todaysBriefing()` has no date filter, so the first row ever written would come back every day.
4. **Sign-off is refused.** It writes `time_entry` (jobs link) and `training_event`, so it gets 503 `read_only`. The quiz, near miss, arrival and change order are refused the same way.
5. **There is no source for work orders.** The jobs link stays cut, there are 0 `contract` rows, and R9 says a calendar entry alone is not a job. Even the practice data has never drawn a work-order card.

Items 2–5 need Mike's rulings, and no build may decide them. C1–C4 need no ruling except the Q5 and Q7 defaults. They leave a crew door that names every reason it can't be used, and a preview Mike can use daily. C5–C8 wait on Q0 and their own rulings.

## Facts checked in the code

1. **`time_entry` sits in the `jobs` link** (`src/db/links.ts`), which stays cut in read-only. `training_item` and `training_event` sit in the `crew` link, which is readable.
2. **The CHECK `training_item_vetted_before_publish`** (migration 0009) refuses a published row with no `vetted_by`/`vetted_at`.
3. **`training_item` has no day column.** `todaysBriefing()` orders by `created_at desc limit 1`. `body` is JSON (`{ text, standardRefs }`), so a day can ride in `body.forDay` without a migration.
4. **A reload can sign twice.** The only duplicate guard is `time_entry_ack_once` on `(crew_member_id, source, started_at)` (0011). `renderGate` resets `startedAt` on every render, so a reload writes a second paid row.
5. **The ack trusts the phone's text.** `ackBriefing` runs `evaluateGate` on the body the phone sends back.
6. **No crew route checks `active`.** The roster's own warning says an off-roster code still opens the door.
7. **`crewWorkOrders(dateIso, briefingId)` (`api.ts:975`) checks nothing with `briefingId`** (M11, open in D99). Two callers use it: the route (`server.ts:1342`) and Talk (`ownerTalk.ts:134`). Talk passes no crew id and no headers.
8. **The door doesn't say which key opened it.** `checkApiDoor` returns only `{ok:true}` (`accessDoor.ts:313-315`). `x-arbo-preview` is a header the phone sets itself (`crew.html:309`), so on its own it proves nothing.
9. **Arrival and change order need a job UUID.** `site_condition_record.job_id` references `job`.
10. **Calendar events carry PII.**
    - The layout (OPS_CONVENTIONS:110) puts the name, source tag and 10-digit phone in the title, the scope in the description, and the address in the location.
    - The location is free text (`todayStops.ts` `toRow`).
    - "Street + amount" is how Mike *talks* about jobs, not the title format.
11. **Drive reads.**
    - `driveRead.ts:48-62` already lists a folder's files: GET only, pinned by a test, under Drive read-only permission.
    - `drive.ts`'s `findFolder` has never run in the app (`drive.ts:60-62`). It quotes the name with `JSON.stringify` (`:128`), which may not match Drive's query syntax. Unverified.
    - `drive.ts` also holds the folder-create write.
12. **How Mike files contracts** (OPS_CONVENTIONS:122-127, Conflict 8):
    - Files are named street first, then the amount, then the city code.
    - Unsigned contracts sit in an unsigned folder. Finished jobs' contracts sometimes move to a completed-jobs folder.
    - Per-property `Signed Contracts` folders are only the brief's pilot layout.
13. **A second crew-day source already exists.** The R28 assistant drafts 6:30am crew route texts from its own calendar and Drive (`agent.yaml:124`).
14. **Job colour is in conflict** (OPS_CONVENTIONS Conflict 3). Mike's export says job events go on the calendar in Tangerine. The repo uses Tangerine for Portsmouth estimates (D34).
15. **Failure lines on the crew page.**
    - Five catches bypass `crewWhy`: `renderWork`, `submitQuiz`, `renderQuiz` (load 503), `arrivalButton` and `changeOrderButton`.
    - `crewWhy` reads the error name only on a 503 or 429 (`crew.html:326`).
    - `submitGate` holds GO only on a 400 or 503 (`:491-498`). A 403 or 409 reads "try once more" with GO green.
16. **The near miss warns in advance only when `LINKS === 'cut'`.**
17. **The quiz pool.**
    - An empty pool returns silently (`renderQuiz`), and nothing writes `quiz_question` items.
    - `publishedTrainingItems()` and `trainingItemsByIds` don't filter by type (`repositories.ts:1891`, `:1973`). A published briefing would join the quiz pool and the training board's topics.
18. **`prompt()` collects three inputs:** arrival notes, the extra-work description, and who agreed.
19. **The photo line promises a close flow that doesn't exist:** "Before + after photos required to close this job".
20. **There is no Navigate button.** The address is a plain `maps.google.com/?q=` link. On the owner side a tap asks first, through R35's "Open in Google Maps?" sheet (`index.html:3843`).
21. **Three writes are not plain inserts:**
    - `recordCertification` deletes, then inserts (`repositories.ts:1805`).
    - The near-miss lesson draft updates `near_miss.generated_training_item_id` (`:1883`).
    - `completeQuiz` updates `crew_member.training_profile` (`api.ts:1813`), and a failure there is swallowed.
22. **The practice crew ids are `sim-crew-1`…** (7 uses in `simSource.ts` and `sim/harness.ts`). They are not UUID-shaped.

## Rules for every package

- **Cycle (CLAUDE.md):**
  - Tests first, then `npm run check`, then an adversarial review of the diff, then browser shots, then commit, push, and deploy by full SHA.
  - Then verify three things: `git_ref` matches, the log says `db READ-ONLY (ARBO_DATA_LINKS=readonly)`, and `snapshotId: null`.
- **§1B:**
  - Every catch goes through `crewWhy`. A failed read is never "Nothing scheduled", "No briefing" or a blank.
  - A stop-work line stays its own bold line.
  - "Nothing here" is said only over a read that succeeded.
- **The server decides.** Anything that unlocks work is checked on the server.
- **Admin data stays off the crew phone.** It is kept off by construction through `buildCrewPayload`: no price, tracking, customer name or phone, and never a calendar title, description or contract file name.
- **R26 preview:** every new control is off in `/crew?preview=1`, with `PREVIEW_WHY` beside it. Every new POST is covered by the server's refusal of preview writes.
- **Keys:** the crew key opens `/api/crew/*` only. A new owner action lives outside `/api/crew/`.
- **R27 later:** each sentence is one string literal, with `plural()` for counts. Safety and permit words each go through one table.
- **`localStorage`:** every read and write sits in `try/catch`, and the page works without it.
- **Pins:** a moved pin is rewritten so it keeps its meaning, and listed in its commit. Defaults are recorded as D106 onward.
- **Browser harness (every package):**
  - Playwright chromium, `isMobile`, `hasTouch`, at 390×844 and 320×640.
  - Crew phone: `arboCrewKey` and `arboCrewId` set via `addInitScript`. Preview: `arborKey` set, at `/crew?preview=1`.
  - Modes: sim; cut; `readonly` with no DB; and `page.route` stubs for `read_only`, `link_cut`, a 404 briefing, 429, `crew_key_not_set`, `off_roster` and `not_todays_briefing`.
  - Always assert:
    - `scrollWidth` ≤ viewport;
    - every button and job action is at least 44 px tall;
    - any `dialog` event fails the run;
    - GO is never green in the preview or after a refusal.

## Packages in ship order

### C1 Name every failure (S; no ruling)

**Changes:**

- **`crew.html`:**
  - `renderWork`, `submitQuiz`, `arrivalButton`, `changeOrderButton`: `await LINKS_READY`, then `crewWhy(e)`. The work-orders line keeps "that is not an empty day — call the office".
  - `renderQuiz` load failure: give the `crewWhy` reason and keep "carry on".
  - `renderQuiz` empty pool: the pool counts as empty when it holds no `quiz_question`. The line reads "The office hasn't published any questions yet — nothing to answer today. That is the office's gap, not a pass."
  - `renderNearMiss`: warn before anyone types when `LINKS` is `'cut'` or `'readonly'`. The read-only wording is "Filing is off while Arbo is read-only — tell the office directly." C5 rekeys this to `crewWrites`.
  - `renderGate` under read-only: one line above GO, "Arbo is read-only today — your sign-off can't be saved on this phone.", then its own bold line, "Do not start work — call the office." The briefing stays readable.
- **`repositories.ts`:** `publishedTrainingItems()` and `trainingItemsByIds` take `quiz_question` and `lesson` only. The training board's topic count follows.

**Tests first** (`crewPage`, `readOnlyMode`, `crewApi`):

- All five catches call `crewWhy(`, with no `'Try again.'` or `'try once more'` left in them.
- The near miss warns under `readonly`.
- An empty pool, and a pool with no `quiz_question`, both draw the named line.
- The read-only gate lines show only under `readonly`, and "Do not start work" is bold.
- `Nothing scheduled` appears only in the success branch.
- A `tailgate_brief` row never enters the pool.

**Browser:** stubbed `read_only` and `link_cut` at 390 and 320, crew phone and preview. The near-miss warning is visible without scrolling the card.

### C2 A practice day with a work order; Navigate; no `prompt()` (S; no ruling)

**Changes:**

- **`simSource.ts`:** add `jobsWithFiledContract`, filing one SIM job and leaving the other unfiled. Sim then draws one card and the line "1 job on today's sheet is on hold — no signed contract yet." The lookup-failed path moves to a test source.
- **`crew.html`:**
  - One builder, `crewMapsUrl(address, city)`, in the `maps/dir/?api=1&destination=` shape. The address link and a new 44 px **Navigate** button both use it.
  - A tap opens Maps directly, with no sheet. This differs from the owner side and is recorded as a D106+ default (Q10).
  - Remove `prompt()`. Arrival and Extra-work are switched off with "No job record yet — tell the office what you found". The forms get built when real jobs exist (fact 9).
  - New photo line: "📷 Before + after photos are required — the app can't take them yet; ask the office how to send them."

**Tests first:**

- `crewPage`: no `prompt(`, one maps builder, and one Navigate per card.
- `crewApi.test.ts:206-213` is rewritten: practice data now files one job and holds one. The unreadable case moves to a stub source.
- `qa_crew.test.ts:74` keeps "Can't confirm today's jobs", which is still the lookup-failed wording.
- Arrival and Extra-work are off with the reason, on the crew phone and in the preview.

**Browser:** sim at 390 and 320, crew phone and preview: the card, Navigate, the held line, both job buttons off with the reason. No dialog fires.

### C3 Sign-in without typing a UUID; off-roster codes (M; Q6 and Q7 defaults)

**Changes:**

- **Practice crew ids** become UUID-shaped, in obviously fake form (`00000000-0000-4000-8000-0000000000c1`…). This churns `simSource.ts` and `sim/harness.ts` (7 uses).
- **Owner app, `renderRosterList`:** a **Send sign-in link** button on each active person.
  - It builds `<origin>/crew#crew=<uuid>` and hands it to `navigator.share`, falling back to copy. Arbo sends nothing.
  - The link carries the crew code only (Q6).
- **`crew.html` boot:**
  - Read `#crew=`. If it is UUID-shaped, store `arboCrewId`.
  - Keep the fragment in the address until the page runs as the installed app (`display-mode: standalone` / `navigator.standalone`), then strip it with `history.replaceState`. In Safari it says "Add to Home Screen now, then open Arbo from there." iOS home-screen apps don't share Safari's storage, so the installed app must get the code itself.
  - Fallback: a "Paste your sign-in link" box in the installed app.
  - Check the crew manifest's `start_url`.
  - A bad link says "That sign-in link is broken — ask the office for a new one".
  - The fragment never reaches the server.
- **New `GET /api/crew/me?crewMemberId=`** (crew link, readable):
  - It returns `{ firstName, active }`, so the page shows "On this phone: Rudy — Not you?".
  - Unknown → 400 `unknown_crew`. Off the roster → 403 `off_roster`. Read failure → 503, named.
- **Off roster (Q7 default):**
  - `ackBriefing`, `crewQuiz` and `completeQuiz` (paid) refuse an inactive code with 403 `off_roster`. An unreadable roster fails closed and is named.
  - `reportNearMiss` and `crewReference` are never refused over the roster. They file or answer, and name "off the roster" or "roster not checked".
- **`crewWhy`** reads the error name on every status. It learns `off_roster` ("this crew code is off the roster — check with the office") and `unknown_crew`.
- **`submitGate`** holds GO on 403.
- **The roster's arm-twice text** loses "Their crew code still opens the crew door."

**Tests first:**

- New `crewSignIn.test.ts`:
  - fragment parse;
  - fragment kept in Safari and stripped once installed;
  - the paste box;
  - the bad-link line.
- `crewApi`:
  - `off_roster` on the paid routes;
  - roster read failure gives a 503 there, never a pass;
  - near miss and library still answer, named.
- `submitGate` branches: a 403 holds GO.
- `r26_owner-ui`: the arm-twice text and the share button.

**Browser and phone:**

- Browser: open `/crew#crew=<sim uuid>` at 390 and 320; the name line shows; "Not you?" works; the share button shows in the Office preview.
- On a real iPhone before C8: open the link, Add to Home Screen, and launch signed in.

### C4 The server owns the day (M; M11 per Q5; no migration)

**Changes:**

- **Day:** a briefing's day rides in `body.forDay`, so no migration is needed. `todaysBriefing(day)` adds `.eq('body->>forDay', etToday())`, and a row with no `forDay` is never served.
- **`ackBriefing`:**
  - Load today's briefing on the server. A different `content.id` gives 409 `not_todays_briefing`.
  - `evaluateGate` runs on the server's own body.
  - Check "already signed today" by the server's `training_event.created_at` in today's ET window, not by the phone's `started_at`. If it is signed, return `{unlocked:true, duplicate:true, signedAt}` with no new row.
  - A unique-index rejection of the time row counts as `duplicate`, and no event is written.
  - If the check can't be read, write anyway and name the unchecked state.
- **`crew.html`:**
  - Save `GATE.startedAt` in `localStorage` per crew member and briefing id. A reload or retry then re-sends the same start time, and 0011's index rejects a second paid row.
  - GO stays off while a sign-off is in flight.
  - A 409 reloads the briefing.
- **`GET /api/crew/briefing`** adds `signedAt`. `renderGate` then shows "Signed at 6:42 AM — logged. Not counted twice." and unlocks.
- **M11, in the `/api/crew/workorders` route (`server.ts:1342`), not in `crewWorkOrders`:**
  - It requires `crewMemberId` plus a signed-today ack, else 403 `briefing_not_signed`.
  - If the sign-off can't be read: 503, "Arbo couldn't check your sign-off — call the office".
  - The door returns which key matched, and only the owner key is exempt. The `x-arbo-preview` header alone exempts nothing.
  - Talk keeps calling `crewWorkOrders` directly, unchanged. The unused `briefingId` parameter goes.
  - The crew phone's call (`crew.html:645`) adds `crewMemberId`. The preview's call stays bare.

**Tests first** (`crewApi`, `crewBriefingRetry`, new `crewDay.test.ts`, `ownerTalk`):

- Yesterday's brief is not served.
- A mismatched id gives 409 and the page reloads.
- An edited body can't shorten the read floor.
- Two acks sent in parallel, and a reload, write one paid row.
- The signed state shows after a reload.
- Work orders without a sign-off give 403; the owner key passes; crew key plus `x-arbo-preview: 1` still gives 403.
- Talk's work-order answer still works.
- `crewWhy` maps `briefing_not_signed` and `not_todays_briefing`.
- `r26_crew-preview.test.ts:190` is rewritten to pin both calls: the crew phone's with its id, the preview's bare.

**Browser:** stubs for signed and unsigned at 390 and 320. A reload after signing shows "Signed at…". The preview still reads the day.

### C5 Crew write lane (M/L; needs Q0 yes and Q1 yes)

**Why:** read-only refuses every crew write, so the door can't be used daily without a lane.

**Changes (the Q1 default):**

- **New `src/db/crewWriteDoor.ts`,** on the `credentialStore.ts` pattern.
  - Its own switch: `ARBO_CREW_WRITES` exactly `live`, failing closed.
  - It hands out named operations only, never a table client:
    - `recordBriefingAck`: `time_entry` insert (`tailgate_ack`) and `training_event` insert.
    - `recordGate`: quiz time and event; `saveTrainingProfile` updates `crew_member.training_profile`, by id.
    - `fileNearMiss`: the lesson draft (a `training_item` insert, type `lesson`) plus `linkNearMissLesson` (the one `near_miss.generated_training_item_id` update, by id).
    - `addCrewMember`, and `deactivateCrewMember` (`active=false`, by id).
    - `recordCertification`: delete by `crew_member_id` + `type`, then insert.
    - `publishBriefing`, and `replaceBriefingBeforeSignOff` (`published=false` by id, plus an insert).
  - Inserts read back only their own new ids. The updates and the one delete above are the only ones allowed. Every other table, verb, rpc or storage call is refused by name.
- **Not in the lane:** arrival and change order, which need a `job` row.
- **`/health`** gains `crewWrites: 'on' | 'off'`. The C1 warnings key on it.
- **`canWrite()` stays false.** The roster and briefing-publish owner routes move onto the lane. Every other owner writer stays refused, and agent sweeps are untouched.
- **Same PR:** CLAUDE.md §3 and `docs/DATA_LINKS.md` name the lane as the second sanctioned exception.

**Tests first** (new `crewWriteDoor.test.ts`, plus `readOnlyMode`, `dataLinks`):

- Off unless exactly `live` (`LIVE`, `true` and `live ` all stay off).
- A list of every reachable table and verb, including the three non-insert operations, and nothing more.
- Anything else is refused by name.
- `getDb()` still refuses `time_entry` reads.
- `/health` names the flag.

**Browser:** `crewWrites: on/off` stubbed at 390 and 320. The near-miss and gate lines follow the flag.

### C6 Publish the next crew day's briefing from Office (M; needs C5 + Q2)

**Changes:**

- **`src/crew/tailgateTopics.ts`:** Claude drafts about 20 short topics.
  - De-identified, 3–5 spoken minutes.
  - Z133 clause pointers only, never its text (`NEVER_REPRODUCE`).
  - Each is marked "Claude's draft — change any word".
- **Owner route `POST /api/briefings`,** outside `/api/crew/`:
  - Body: `{ forDay, topic, body, standardRefs, vettedBy }`.
  - `forDay` is today or the next crew day in ET (Friday publishes Monday; Saturdays follow Q4).
  - `vettedBy` must be a named human. The banned-phrase gate applies.
  - It writes through `publishBriefing`. Republishing replaces the earlier briefing until the first sign-off, then is refused by name.
- **`GET /api/briefings`** returns today and the next crew day.
- **`index.html`, Crew & safety:** a **Crew briefing** card.
  - It shows each day's state in words: "Published by Mike, 8:12 PM", "None published for Monday", or "Couldn't read — not 'none'".
  - It shows "Signed today: N of M on the roster" from `training_event` and `crew_member` (crew link, readable). A failed read is named.
  - A composer: topic picker, editable text, "Your name", and an arm-twice Publish.
- **`beforeYouRoll`:** a `briefing` row ("No crew briefing published for today") on crew days, tapping through to the card.

**Tests first:**

- New `crewBriefingPublish.test.ts`:
  - no vetter gives 400; the crew key gets 401;
  - the next-crew-day bounds hold, including Friday to Monday;
  - replace-before-sign-off holds;
  - drafts carry pointers only and pass the phrase gate;
  - a published brief never enters the quiz pool.
- `r26_owner-ui` and `directionB_deadFeeds`: the card's failed read and its N-of-M are named.
- `directionB_roll` and the feeds-card counts are rewritten for the new row.

**Browser:** Office → Crew & safety at 390 and 320, sim and readonly-no-DB. Publish in sim through a stub. The crew door serves it on its day.

### C7 Work orders from the calendar and contracts (M/L; needs Q0, Q3 and Q4, plus Google reconnected per GO_LIVE §4)

**Changes (built to Q3's answer):**

- **New `src/crew/calendarWorkOrders.ts`:**
  1. Take today's events from `todayStops.ts` (read-only, in memory).
  2. Sort out crew time per Q4. Events outside crew time get a counted line ("N other events today not read as crew work"). Crew-time events with no address get their own line ("N crew-time events have no address — call the office"). Nothing is dropped silently.
  3. Look up the contract per Q3, using a new GET-only lister on the `driveRead.ts` pattern (single-quoted, escaped Drive query, pinned by a test). Nothing is added to `drive.ts`, and `findFolder` is not relied on.
  4. Give one of four states:
     - **Filed:** it becomes a work order.
     - **Looked, no contract:** "on hold — no signed contract yet".
     - **Couldn't match:** "Arbo couldn't match this address to a client folder — not a missing contract".
     - **Drive error:** `contractLookupFailed`, so R9 fails closed.
- **Keys:** the contract split and `assertEveryWorkOrderHasContract` key on the calendar event id, which stays on the server. `WorkOrderSource.jobId` and `CrewPayload.jobId` become `string | null` on purpose. `workOrder.ts` is SLOW::ARBO, so read its note first.
- **Payload through `buildCrewPayload`:**
  - Only the street and city parsed from the location, plus the booked time. Anything else in the location (a gate code) is dropped, and an unparseable location goes to "couldn't match".
  - `scope`: "On the contract — your lead has it".
  - Hazards: "Hazards not on file — walk the site before you start".
  - Permit: the UNKNOWN note.
  - `jobId: null`, with job actions off as in C2.
- **Contract file names carry the amount.** They are never logged or sent anywhere. Logs carry counts only.
- **Route:** `crewWorkOrders` uses this source while the jobs link is cut and says so (`source: 'calendar'`).
- **An unread calendar** reads "Can't read today's calendar — this is not an empty day. Don't start work; call the office."

**Tests first** (new `crewCalendarWorkOrders.test.ts`):

- **Fuzz:** a title with a name, 10-digit phone and source tag; a description with scope and "$1,850"; a location with a gate code. None of it reaches the payload except the street and city.
- Two filed events and one held event on the same day stay three separate work orders.
- Before and after the crew-time line.
- The four states are distinct.
- Address-less and out-of-crew-time events are counted.
- A Drive or calendar outage is never "Nothing scheduled".
- The assert still runs.

**Browser:** stubbed calendar and Drive at 390 and 320 for each state, calendar down included. The preview shows the same.

### C8 Field test (only if Q0 is yes)

**Before the test:**

- `CREW_ACCESS_KEY` is set, which is unverified today.
- The rulings are in, and C1–C7 are deployed. That first deploy also carries Direction B wave 3 (P14–P19), still undeployed per D105(h).
- Mike's preview has been checked.
- C3's real-iPhone check has passed.

**Then:**

1. Mike sends one sign-in link (Q6).
2. The crew member opens it, adds it to the home screen, launches from there, enters the door key once, and checks the name line.
3. The briefing was published the evening before (or Friday for Monday). Scroll, tick, timer, GO, then reload and see "Signed at…".
4. Answer the clock-in question, or see the named empty-pool line.
5. Today's cards, Navigate on each, a held job named. Walk the near-miss form up to Send without sending in production. Send only in practice data, unless Mike OKs one real report and keeps it.
6. Office: C6's card shows "Signed today: 1 of N". Claude reads `time_entry` through Supabase (counts only) to confirm one paid row.
7. D105(g): the preview's way back, on Mike's iPhone.

Afterwards, tick GO_LIVE §2 "Crew door".

## Which data link each crew route reads (§1B)

| Route | Link(s) | Read-only today | After C5 | What the crew reads when it can't |
|---|---|---|---|---|
| GET `briefing` | crew | reads; 404 (none for today) | same | "No briefing published for today yet — check with the office." |
| POST `briefing/ack` | jobs (`time_entry`), crew | `read_only` | lane | "Your sign-off could not be recorded (…)." plus "Do not start work — call the office." |
| GET `workorders` | jobs, permits; C7: Calendar + Drive | `link_cut`; C4: needs sign-off | C7 source | cut on purpose / "Can't read today's calendar…" / `briefing_not_signed` |
| GET / POST `quiz` | crew (+ `time_entry`) | GET reads; POST `read_only` | lane | named reason; empty pool named (C1) |
| GET `reference` | ops, crew | reads | same | "Library: … That is NOT 'nothing on file'" |
| POST `near-miss` | safety, crew | `read_only` | lane | warned before typing (C1) |
| POST `arrival`, `change-order` | safety, jobs | `read_only` | still refused | buttons off: "No job record yet — tell the office" (C2) |
| GET `me` (C3) | crew | reads | same | `unknown_crew` / `off_roster` / unreadable, each named |

## What needs Mike (in order)

1. **Answer Q0:** do crews start this month?
2. **`CREW_ACCESS_KEY` on Railway.**
   - Check whether it is set (unverified). If not, make one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   - Deploy by hand (GO_LIVE §1).
3. **Run the 11-row delete** (R29) in the Supabase SQL editor; Claude checks the counts after. This doesn't unblock this month's work orders.
4. **Rulings on Q1, Q2 and Q3,** each filed as R37 onward.
5. **After his yes to Q1,** set `ARBO_CREW_WRITES=live` and deploy. A build never sets it.
6. **Add the crew** in Office → Crew & safety, then send each person their link.
7. **Publish the first briefing** the evening before the field test.
8. **Reconnect Google read-only** (GO_LIVE §4) for C7.
9. **Pick the field-test crew member.** R29 #3 names "rudy or marco or temo".

## Questions for Mike (each with the default the build uses, or what waits on it)

0. **Do crews start using `/crew` this month, or is October your own daily use first?**
   - *Waits on him.* Until he answers, the build does C1–C4 only, and C5–C8 wait.
1. **Crew writes while Arbo is read-only.**
   - This would be an exception to R32, and a second exception to CLAUDE.md §3 after the Bouncie sign-in row. §3 holds "Import NOTHING involving active company activity" until Mike says the app is built, and sign-offs, roster phone numbers and near misses are company activity.
   - *Default (waits on his yes):* the narrow lane in C5, on its own switch, with CLAUDE.md and DATA_LINKS.md changed in the same PR.
   - *If no:* the crew door stays look-only, and crews sign on paper.
2. **Who writes the daily briefing?**
   - *Default:* Claude drafts topics (clause numbers only). Mike, or someone he names, publishes one per crew day under his own name, the evening before.
3. **Where this month's work orders come from.**
   - How contracts are filed today (OPS_CONVENTIONS:122-127, Conflict 8): central folders, named street, then amount, then city code; an unsigned folder; finished ones sometimes in a completed-jobs folder. Per-property `Signed Contracts` folders are only the brief's pilot layout.
   - The options:
     - (a) per-property folders;
     - (b) match by street in the central folder, checking the completed-jobs folder too;
     - (c) no work orders until job and contract records exist (not this month).
   - **How does Arbo tie a contract to *this* job?** A returning customer's folder can hold last year's contract, and a weekday-morning vendor visit or utility marking at that address would then read as a work order.
   - **Which crew list wins?** The R28 assistant already drafts 6:30am crew route texts from its own calendar and Drive reads, and C7 would be a second list that can disagree.
   - *Waits on him.* Only the street, city and time reach the crew phone either way.
4. **What marks crew time?**
   - *Default:* weekdays before 4 PM, with Saturday events not work orders (R16 Saturdays are estimate runs).
   - Mike's export says job events are Tangerine, but the repo uses Tangerine for Portsmouth estimates (Conflict 3). Should colour be the marker, and which colour?
   - Events outside crew time are counted, never dropped.
5. **M11: must a crew member sign today's briefing before getting work orders?** *Default:* yes. Mike's own key is exempt, and Talk is untouched.
6. **Should the sign-in link carry the door key too?**
   - *Default:* no. The link carries the crew code only, and the door key is typed once per phone.
   - The cost: the door key is 43 random characters, longer than the 36-character code C3 replaces.
   - Alternatives: a QR code holding the key, or the key riding the link. With the key in the link, changing the key cancels every link, and Mike re-sends from the roster.
7. **Off-roster codes.**
   - *Default:* refused for sign-off and the quiz (paid), with "off the roster — check with the office", and refused if the roster can't be read.
   - Near miss and library are never refused over the roster. They name "off the roster" or "roster not checked". (New scope he didn't ask for.)
8. **Crew without phones at the tailgate.** *Default:* one person per phone for now. The lead tells the office who attended.
9. **Photo line wording.** *Default:* "required — the app can't take them yet; ask the office how to send them."
10. **Crew Navigate.** *Default:* opens Maps directly, with no "Open in Google Maps?" sheet as on the owner side (D106+).

## Later (not this month)

- **Spanish (R27):** next after this plan. The foundation PR first, then the crew door (*usted*), then a phone read-through by a Spanish-reading crew member.
- **Crew-phone location: needs a ruling.** Bouncie stays owner-only (R31). The crew door gets no map, only Navigate. "Crew and trucks" on the MAPS plan is owner-only.
- **Photos:** camera or upload, before/after, damage and incident log. The photos link is cut.
- **Arrival and change order,** with their forms, on real jobs once job and contract records exist (R9).
- **Quiz authoring** (`quiz_question` publish), and the `clock_out_gate`. 10 vs 15 Friday questions is Mike's call.
- **New-hire safety-packet gate; permit photos at the estimate; attendance roll call** (OPS_CONVENTIONS §6).
- **Crew route yard → farthest → back.** `sequenceRoute` sorts by time only.

## Risks

- **Writes are the expensive failure.** The lane is limited to named operations, with a test that lists every reachable table and verb (the three non-insert operations included) and a switch that fails closed.
- **The M11 lock.**
  - It must live in the route, or Talk breaks.
  - It must key on the door's owner match, not the phone's header, or a crew phone skips it.
- **A calendar title, description or contract file name on a crew phone** would leak a name, phone or price. Only `buildCrewPayload` builds the payload, and C7's fuzz test pins it.
- **The crew-time marker is a proxy** (4 PM or a colour). Misreads are counted and named, never dropped.
- **There are two crew-day sources** (the R28 texts and C7) until Q3 says which wins.
- **Paid-time correctness.** C4 must never block a first sign-off. A failed check writes and names the gap. The duplicate guard depends on `localStorage` holding the start time, so with storage refused a double tap can still write two rows. That case is named, not hidden.
- **iOS sign-in storage** isn't proven until the real-iPhone check in C3.
- **Test churn:**
  - `crewApi.test.ts:206`, `r26_crew-preview.test.ts:190`, `crewPage`, `r26_owner-ui`, `directionB_roll`, the feeds-card counts, and the sim crew ids in `simSource.ts` / `sim/harness.ts`.
  - Each rewritten pin keeps its meaning and is listed in its commit.
- **The first crew deploy carries P14–P19** (undeployed, D105(h)).
- **Service worker:** after each deploy a crew phone needs two relaunches before it can be judged.

## Critique points not taken

None. All 28 were taken. The code check confirmed points 1–4, 6, 9, 13, 15, 17, 21 and 23; points 6 (the `findFolder` quoting) and 11 are handled as unverified.
