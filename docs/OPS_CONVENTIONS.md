# OPS CONVENTIONS — how Art-is-Tree actually runs

**Source:** Mike's Claude memory export dated 2026-10-20 (33 notes), read as
data and checked against `docs/OWNER_RULINGS.md`, `DECISIONS.md`, `CLAUDE.md`
and the code on 2026-10-20.

**How to read this file**
- Rules only. No customer, crew, vendor or family names (only Mike), no phone
  numbers, addresses, plates, account numbers or price figures. Where the
  export named a person, this file names the rule.
- Mike prices; Arbo never does (R3). Pricing notes keep only who-decides and
  process facts. The figures stay out of this repo.
- This file changes no behaviour. Where the export disagrees with a ruling,
  a decision or the code, it is listed under **Conflicts for Mike** at the
  bottom, both sides quoted. No winner is picked here.
- Each line ends with where it stands in Arbo:
  - **Carries:** Arbo already does it (file named).
  - **Later:** Arbo should carry it (where). If it crosses a hard boundary,
    it still needs Mike's go first.
  - **Out:** not Arbo's job, and why.

---

## 1. The week and the day

- **Mike runs the crew Monday to Friday from the 8:30 AM yard start.** Weekday
  mornings are crew time. **Carries:** `src/scheduling/config.ts`
  (estimate window afternoons only), `src/ops/morningBrief.ts` (jobs in the
  morning, estimates in the afternoon).
- **Anything else that lands on a weekday morning gets flagged** (vendor
  visits, utility marking, deliveries), because it competes with that day's
  crew job. **Later:** the 7am office check and Today.
- **Estimates run weekday afternoons and Saturdays.** On Saturday, Norfolk,
  Chesapeake and Portsmouth go in the morning and Virginia Beach after 12.
  **Carries:** `src/policy/guardrails.json` (`businessFacts`),
  `src/ops/routePlanner.ts`. See Conflict 6 (the slot finder has no Saturday).
- **No Sunday estimates.** Sunday is emergencies only. Only Mike can make an
  exception. When he does, the customer hears that Sunday estimates are not
  usual unless it is an emergency. **Carries (partly):** Sunday is not a
  working day in `src/scheduling/config.ts`; `agents/arbo/agent.yaml` books
  weekdays or Saturdays. **Later:** say "never Sunday" outright in
  `agent.yaml` (on Mike's word; that file is pinned by test).
- **No estimate goes on a day unless Mike says so.** See Conflict 4.
- **Estimates are Mike's.** An estimator in training now covers some. See
  Conflict 5.
- **Routes.** Estimate routes start and end at Mike's home. Crew routes start
  and end at the yard and run out to the farthest job, then work back. Mike's
  home address never appears in anything a customer sees. **Carries:**
  `src/ops/routePlanner.ts` (home ZIP), `agents/arbo/agent.yaml` (yard-out
  routing, home address rule).
- **Cluster by ZIP. No zigzag. No double-booking.** **Carries:**
  `src/scheduling/clustering.ts`, `src/ops/routePlanner.ts`, D19.
- **Fill each crew day to the daily quota Mike sets.** Job length scales with
  job size; count drive time between jobs. **Carries (partly):**
  `agents/arbo/agent.yaml` (internal length bands; see Conflict 7). **Later:**
  the quota in the route planner, owner-only, never shown to a customer.
- **Capacity:** about 260 working days a year, about 200 productive (rain,
  breakdowns, no-shows). **Carries:** `src/scheduling/config.ts`
  (`productiveDayFactor`, D22).
- **Adding someone to a day:** run the route first, slot them where they fit,
  show Mike the plan and who would need to reconfirm, and text nobody until
  he OKs it. New or changed times go to Mike as one batched approval list
  (draft text, window, route result, the source line relied on). Once he OKs
  a time, the customer is texted the same day. **Carries (partly):** R28
  approvals, one item at a time (`src/assistant/*`, `src/app/index.html`).
  **Later:** a batched list with the route result on it (route engine still
  to build).
- **Arrival windows, never exact times.** Estimates get about a 30-minute
  window. Crew jobs get a one-hour window (job length and drive time vary).
  **Later:** `agent.yaml` (Mike's word). Today Arbo gives no time at all
  until Mike confirms (R14, `src/reception/datePromise.ts`), and its words
  promise an "exact time" — see Conflict 22.
- **Rental properties:** when Mike says it is a rental and no notice is
  needed, it goes on the route with no text to the customer. **Later:** route
  planner and `agent.yaml`.
- **No signed contract, not on the crew schedule.** **Carries:** R9,
  `src/ops/jobBoundary.ts`, `agents/arbo/agent.yaml`.
- **Talking to Mike about jobs:** a job is "street + amount"; names are for
  estimates. Calendar titles do not change for this. **Later:** owner-only job
  cards. Talk is Conflict 15.
- **Crew and estimates are reported separately**, never mixed in one update.
  **Carries (partly):** `src/ops/morningBrief.ts`. **Later:** Talk and the
  assistant's updates.
- **Storm and tree-on-house jobs:** Mike brings in a construction service for
  roof debris and the tarp. **Later:** only if Mike changes what callers hear
  (R13 — the script is his). R14's "tarping after the project, billed
  afterwards" stands until then.
- **Subcontractors:** stump grinding, cranes, and sometimes climbing are
  subbed. Each sub needs a current certificate of insurance; requests go out
  and sit unreturned. Track one per sub, flag missing or expired, and WARN
  (never block) when a job with that sub is scheduled — Mike decides on the
  day. **Later:** Office → Crew & safety. (Today `agent.yaml` only checks the
  company's own insurance documents before a risky job.)
- **Damage to a customer's property:** today it is a phone call and nothing
  written down; most small damage is fixed by buying the part. Wanted: the
  crew photographs it and Arbo documents the whole incident. **Later:** the
  documentation (crew door + incident log). Pricing the part is Conflict 17.
- **Continuity:** Mike's position is that the business needs him; plans are
  written that way, not for a Mike-less company. The late-phone
  auto-reschedule idea is Conflict 16.

## 2. Calendar, contracts and money

- **The calendar is Google Calendar** (R2). Estimates go on Google Calendar,
  never the phone's own calendar. **Carries:** `src/app/index.html` iframe.
- **The calendar is the client record.** Check it before reading handwriting
  off a form photo. **Carries (partly):** the calendar mirror the agents read
  (R2), `docs/OPS_SWEEP.md` Step C. **Later:** the doc-scan confirm screen
  checks the calendar first.
- **Event layout:** name, source tag and 10-digit phone in the title; scope in
  the description; address in the location. See Conflict 2 for the format and
  tag set.
- **Colours:** city colours for estimate visits; Sage = won; Graphite =
  declined, no more follow-up (an older note said brown; Google has no brown,
  and the later rule says Graphite); a declined lead's event is recoloured,
  never deleted; completed jobs may go purple (Mike has not said when).
  **Carries:** `src/scheduling/config.ts` (city colours, Sage). D36 records
  Arbo recolouring a won estimate Sage through `markEstimateWonOnCalendar()`
  (`src/scheduling/scheduler.ts`), but nothing calls it today, so Arbo
  recolours nothing; CLAUDE.md says never modify a calendar event. See
  Conflict 3.
- **Contracts:** Mike scans signed contracts and files them himself, named
  street first, then the job amount, then the city code. Unsigned ones wait
  in an unsigned folder until signed. Finished jobs' contracts sometimes move
  to a completed-jobs folder, so check both when matching. **Carries:** R14 #2
  (naming on record), R12 (the sweep sights approved work orders and can flag
  "needs filing"). See Conflict 8.
- **Attach the signed contract to the estimate and job events.** **Out** for
  Arbo's code: that is an edit (hard boundary). It stays Mike's (or his chat
  assistant's) job.
- **Work orders:** never filled out on Arbo's own. Only when Mike gives the
  scope and price and asks, and Mike reviews before anything goes out. On the
  form: always the date of estimate; the F items checked with Y circled
  unless told otherwise; every job at least chip truck and chipper checked
  and 2 GM; with two options, check boxes only for the lesser one
  and label the other "Option)". Attach the company's certificate of
  insurance to every work-order email. Mike wants the 3-business-day right
  to cancel in the terms. **Later:** the digital work order (in build); the email
  goes through the R28 assistant on Mike's OK.
- **Deposits, cancellation fee, job minimum, payment terms, late surcharge,
  crew rates:** Mike sets them; deposits are on select jobs at his discretion
  (to commit customers before they demand a date); the deposit counts toward
  the cancellation fee; late terms are set to stay inside Virginia usury
  limits. **Carries:** R3, `agents/arbo/agent.yaml` (never mention the
  minimum, reminders never restate an amount). But `src/ops/invoicing.ts`
  carries its own default payment terms — see Conflict 19.
- **Invoices:** the proposal doubles as the invoice; a separate invoice goes
  only to a customer paying electronically. **Carries (partly):**
  `src/ops/invoicing.ts` (amount only from `agreed_amount`, R3), R28 Square
  on Mike's OK. The code drafts an invoice for every finished job — see
  Conflict 19.
- **Payment methods:** as in `guardrails.json` `businessFacts`. The export
  holds Mike's per-method fees; `businessFacts` still says "Mike confirms
  whether any fee applies". **Later:** update `businessFacts` on Mike's word.
- **Keeping wood or mulch on site** lowers the price, but how much depends on
  the site — never a flat amount. **Carries:** the no-price guard (R3).
- **Discounts:** see Conflict 9.
- **Financing.** The export names two paths: a third-party lender linked on
  the website (Arbo's apply link stays null until Mike supplies it, R8), and
  in-house financing tied to a membership concept that has not launched.
  **Carries:** `guardrails.json` `financing` (financing and payment plans
  are offered now, R8). Whether R8's payment plans are the membership
  financing is Conflict 21.
- **Master client list in Drive:** Mike expects new customers added.
  **Out** for Arbo's database (§3). **Later:** the R28 assistant could draft
  the addition for Mike's OK.
- **Daily lead log and "Ops State" doc in Drive:** written by Mike's chat
  assistant (one log per day, rebuilt rather than side sheets, including the
  assistant's own actions). **Carries:** Arbo reads them, read-only (R24,
  `src/ops/quoStudy.ts`). Arbo writes neither.
- **One rulebook:** see Conflict 1.

## 3. Calls, Sona and lead sources

- **Sona (Quo's AI) answers missed calls; Arbo learns from every one** (R20).
  **Carries:** `src/integrations/quo.ts`, `src/ops/quoIntake.ts`.
- **Ring delay and voicemail:** see Conflict 14.
- **Answer every call.** A "Spam Likely" label is never evidence; the flyer
  tracking numbers show up that way. The office number is also being spoofed,
  so some missed calls are fake — still treated as possible clients.
  **Carries:** R23, `src/reception/judgment.ts`.
- **Never hang up first on anyone who mentions trees, stumps or yard work.**
  If a caller asks for another company, don't repeat our name — keep going
  with the intake. **Later:** Sona's Quo-side instructions (list in
  `docs/PHONE_SETUP.md`); Arbo's slip check could flag a Sona-first hang-up.
- **Sona never books.** She may take a preferred day or time and say the
  office will confirm. She tells callers estimates are afternoons and
  Saturdays, and she collects city and ZIP with the address. **Carries
  (partly):** the R26 date-promise flag on Sona's words (`docs/PHONE_SETUP.md`),
  `guardrails.json` `leadQualification` (address, ZIP). **Later:** Sona's
  instructions. See Conflict 4.
- **No transfers to Mike's phone** — Mike: *"Just take their info."* See
  Conflict 13.
- **When the estimator in training is out, Mike still wants call updates.**
  **Carries:** the Sona panel and Today (R20).
- **A missed call with no Sona record** means the caller hung up before it
  rolled over; only a callback finds out why. **Carries:**
  `src/ops/loopCloser.ts` (`callback_still_open`).
- **Echo on some Sona calls** (she hears her own voice as the caller's) loses
  more leads than the ring delay. Fix the audio loop first. **Out** of code —
  Quo-side; note it in `docs/PHONE_SETUP.md` when fixed.
- **Job seekers who call:** ask three things — done tree work before? valid
  driver's licence? driven big trucks before? — and pass the answers to Mike.
  Arbo never schedules or advances a candidate; Mike decides who gets a call
  back. Candidates also come
  from walk-ups, word of mouth and job boards. **Later:** a job-seeker intent
  in `src/reception/intent.ts` and Sona's instructions. `agent.yaml` already
  lists candidates for Mike without contacting them.
- **Tag the lead source from the channel; never ask the caller how they
  heard.** **Carries:** no such question in `src/reception/*`. Tag set: see
  Conflict 2.
- **Flyer calls via call tracking (CallRail):** the account belongs to the lead
  vendor; Art-is-Tree only gets the notification emails. Billing counts the
  first call from a number only; bad leads can be sent back for credit. Never
  credit these calls to Google Ads. **Carries:** R11,
  `src/reception/leadMail.ts`. **Later:** invoice reconciliation (brief §6O).
- **HomeAdvisor and Angi leads are ignored.** **Carries:** R11, R12.
- **"Check for updates" means one full pass:** Quo texts, calls, transcripts
  and missed calls, then Gmail (open call-tracking emails fully — the summary
  is in the HTML body), then the calendar — every time, not just at the start.
  **Carries:** Quo's own record (D80), the inbox sweep (D64, R12), Talk opens
  with an update (R30, `src/voice/ownerTalk.ts`).
- **Read whole email threads; filter on what is shown, not what is read;
  classify by intent.** Contract approvals often come as a plain reply.
  **Carries:** R17, `src/ops/inboxIntent.ts`.

## 4. Texting and follow-up habits

- **Never claim to be Mike.** **Carries:** Arbo's own words name Arbo or
  Art-is-Tree (`guardrails.json` `callOpen`, `quoteFollowUpText`).
  **Later:** say it outright in `agent.yaml`. Intro wording: Conflict 11.
- **Text hours:** see Conflict 10.
- **No "correction" texts for small mistakes.** Don't flood customers — leave
  it, learn, get it right next time. **Carries (partly):** R22 sends one text
  per 30 days. **Later:** `agent.yaml` (Mike's word).
- **No double-texting:** read the whole thread, Mike's own outgoing texts
  included, before writing. **Carries:** `src/ops/outreach.ts`
  (`already_texted`, `called_back`).
- **Know a new lead from a follow-up on a past estimate.** Search past dates
  on the calendar before saying "no record". **Carries:** the study's stages
  (`src/ops/quoStudy.ts`). **Later:** the calendar-history line in
  `agent.yaml`.
- **Follow up every 2 days after an estimate until it is won, lost or closed;
  the first one carries proof of insurance.** **Carries:**
  `src/ops/followUps.ts` — as a recommendation for Mike. The export says
  Arbo auto-sends the proof — see Conflict 20.
- **No win-back nudges to old, cold estimates.** **Carries:** R22 (past week
  only), R32 (`src/ops/leadAge.ts`, older than 14 days is an "older lead").
- **Tell Mike when an estimate was missed or never confirmed.** He says Arbo
  either says too little or buries him; give him what he needs to act on.
  **Carries (partly):** `agent.yaml` (voice-memo updates). **Later:** a check
  for an estimate missed or never confirmed on our side. Today
  `no_show_saver` (`src/ops/followUps.ts`) covers only a customer who missed
  the window, and `src/ops/loopCloser.ts` only an estimate that went quiet
  after the visit.
- **Quote or drop.** Read the actual source and quote the line relied on; if
  it can't be quoted, say "I can't verify that." Never answer from
  assumption. **Carries:** §1B. **Later:** the quote-the-line habit in
  `agent.yaml`.
- **Driving mode:** see Conflict 15.

## 5. Do-not-contact (the rule, never the list)

- Anyone who declined or went with someone else: no reply to the decline, no
  follow-ups, no reminders, no check-ins — unless THEY contact us first.
  Their estimate event is recoloured, never deleted.
- A do-not-contact list exists. It is checked before any outreach. It never
  goes in this repo.
- Exceptions are narrow and per person, set by Mike (e.g. tell one person one
  date and nothing else).
- People on hold (moving, waiting on a neighbour, postponed) are NOT declines;
  follow up when their timing comes.
- Mike can drop someone from updates and callback lists until they call in.
- Some customers Mike handles personally; Arbo does not text them unless Mike
  says so. Some have their own contact hours; honour them.
- **Carries (partly):** `src/ops/outreach.ts` skips STOP, solicitors, wrong
  numbers, booked callers and anyone Mike excludes in the app. **Gap:** see
  Conflict 12. **Later:** a durable do-not-contact flag checked by
  `outreach.ts` and the R28 assistant (needs Mike's write ruling — §3, R32).

## 6. Crew safety program

- **Standards.** Virginia's own tree-work rule, 16VAC25-73, is the primary
  citable authority. Overhead lines: Va. Code 59.1-406 to -414 — the 10-foot
  limit, utility safety arrangements COMPLETE before work starts, 5 working
  days for the utility to start. **Carries:** `src/reference/corpus.ts`,
  `src/permitting/publicWorks/facts.ts`.
- **ANSI Z133 and A300 are paywalled.** Cite by clause and topic, never
  reproduce, never invent a clause or clearance number. Mike: Arbo *"always
  gives credit where it's due — never cites it like it's its own work."*
  References, not rules — the person on the ground owns the cut. Art-is-Tree
  uses its own licensed copies; a white-label company brings its own licence.
  **Carries:** `src/reference/corpus.ts` (`NEVER_REPRODUCE`, §6U.3).
- **Accountability, not punishment.** A crew member's profile is a
  corrective-action record (observation → retraining → verified closure).
  The headline is closure, never a violation count or a leaderboard.
  **Carries (partly):** blameless near-miss filing (`src/safety/nearMiss.ts`,
  D60). **Later:** the closure ledger in Crew & safety.
- **A finding from a photo is never pinned on a named person by the agent;**
  a human attributes it. **Later:** the safety agent.
- **Daily tailgate before crews roll:** one de-identified topic, 3 to 5
  spoken minutes, attendance captured, tap to acknowledge. **Carries
  (partly):** `src/crew/briefingGate.ts` (gated briefing, acknowledgment).
- **Clock-in and Friday questions are paid time.** 10 or 15 Friday questions
  is still Mike's call. **Carries:** `src/crew/briefingGate.ts`,
  `src/training/questionnaire.ts`.
- **Cert expiry tracked;** no expiry date means unknown, not current.
  **Carries:** `src/safety/certifications.ts`.
- **A brake or steering defect holds the truck** until Mike signs it back on.
  **Carries:** `src/fleet/breakdown.ts` (R26, R29).
- **New hires:** the safety packet is sent and the signed safety agreement is
  back BEFORE they go out on a truck. **Later:** a crew-door gate; sending the
  packet goes through the R28 assistant on Mike's OK.
- **Permit photos are taken at the estimate,** before leaving — a forgotten
  photo costs a second trip. **Later:** the Estimate screen and the crew door.
- **Payroll and tax paperwork belong to the bookkeeper.** **Out** — Arbo stays
  out of it.
- **Open, Mike's call:** the crew roster with roles and certs; how long safety
  records are kept; whether a ticket silent on PPE counts as a gap.

## 7. Equipment and vehicles (kinds, not units)

- **Kinds in use:** chip truck, chipper, dump truck, bucket truck, mini track
  loader with a dangle-style log grapple (not a bucket or jaw), stump
  grinder. Cranes are rented or subbed. Every job's work order lists
  at least the chip truck and chipper.
- **Units go out of service for long stretches** (rebuilds, legal matters).
  Arbo reads a unit's status and never assumes it is available. **Carries:**
  `src/fleet/breakdown.ts`, Bouncie positions (R31), the office check's
  "equipment due for service" (`agent.yaml`).
- **Legal matters about equipment are Mike's and his lawyer's.** **Out.**
- **Personal vehicles are not company fleet.** **Out.**

## 8. Permitting practice

- **Virginia Beach runs two ordinances, split by watershed** (per the
  export, read against city code on 2026-09-13).
  - North (Chesapeake Bay side, Appendix F): the buffer is a VARIABLE width,
    not less than 100 feet, and runs past erodible soils; if a protected area
    touches any part of a lot of 3 acres or less, the whole lot is regulated;
    removing vegetation in the buffer needs an administrative variance;
    sight-line removals must be replaced; a variance means a written
    application, a fee, a water-quality assessment and a sign posted at least
    15 days. A board variance adds a hearing and mailed notice.
  - South (North Landing, Northwest River, Back Bay, small coastal south —
    Appendix G): within 50 feet of a wetland or shoreline, vegetation "shall
    not be cleared, cut or mown". A lot lawfully created for single-family or
    duplex use before 1992-03-24 is exempt — the lot's creation date decides.
  - **Not carried as written.** `src/permitting/publicWorks/facts.ts` and
    `src/permitting/cities.ts` hold a fixed 100-ft buffer, a PPR filing for
    RPA tree work, and a variance only for a denied or edge-case PPR — see
    Conflict 18. **Later:** the Appendix G facts, marked UNCONFIRMED until
    checked (the R26 pattern). `docs/BUILD_R25.md` says add-on -01's
    Appendix F/G facts feed the permits database; `facts.ts` has no
    Appendix G fact yet. HRGEO coverage of south Virginia Beach is held for
    Mike (`docs/GO_LIVE.md` §5).
- **Waterfront, creek or wetland job in Virginia Beach:** confirm which
  watershed the parcel is in before quoting — the two ordinances give
  opposite answers, and south-side shoreline work inside 50 feet may not be
  permittable at all. **Later:** the Permit Desk and Estimate screen.
- **Norfolk, Chesapeake, Portsmouth** run standard Bay Act rules.
  **Carries:** `src/permitting/cities.ts`.
- **Not verified:** whether Virginia Beach needs a general tree-removal permit
  on private land outside these areas. Never say either way. **Carries:**
  `vb-outside-overlay` in `src/permitting/publicWorks/facts.ts`
  (UNCONFIRMED, "Verify with the city").
- **Screen every overlay, not just the Bay Act:** CBPA/RPA, FEMA flood, local
  floodplain and land-disturbance, each city's resilience overlay (Norfolk's
  coastal resilience overlay is the real case). **Carries:**
  `src/permitting/screening.ts`.
- **Words:** PERMIT LIKELY / REVIEW NEEDED / NO OVERLAY–VERIFY, never "clear".
  The export's six output states (incl. CLEAR / EXEMPT) were settled by R26
  #4 — the three words stand. **Carries:** D28, `src/permitting/screening.ts`.
- **Plain words for tree crews:** "What it is → How you know → What it means
  for the job." **Later:** Permit Desk copy.
- **Arbo never files a permit;** Mike files. **Carries:**
  `src/permitting/packet.ts` (`neverAutoFiled`).

## 9. Insurance and credentials

- **Approved credentials (per the export):** licensed and insured; BBB A+.
  The company carries a general liability certificate of insurance. Arbo's
  own words allow less — see Conflict 23.
- **What it does NOT hold:** TCIA membership (lapsed mid-2026) — never claim
  it.
- **Not confirmed:** separate commercial auto and inland marine coverage were
  noted as needed, not as held; whether the liability policy excludes felling
  or work above a certain height is unverified. So Arbo never tells anyone
  the company is covered for a specific job, truck or machine — Mike confirms.
- **Carries:** `guardrails.json` `credentials` (spoken claims "licensed and
  insured, Google Verified, 5 star rated", R13), `src/lint/forbiddenStrings.ts`
  (D7), `src/sim/judge.ts`, `src/assessment/pruneEstimate.ts` (an ISA
  credential only with a real cert number), R26 (a TCIA question gets
  "licensed and insured"), `agent.yaml` (never claims TCIA, ISA or any other
  membership or certification; "Never tell anyone the company is covered for
  something"). The permit packet still prints BBB A+ (R13, open
  for Mike; Conflict 23).
- **Insurance questions:** Art-is-Tree works with insurance companies; Mike
  answers every insurance question himself. **Carries:** `businessFacts`.
- **Proof of insurance** rides the first estimate follow-up, and Mike can
  bring a copy. **Carries:** `src/ops/followUps.ts`,
  `src/reception/knowledgeBase.ts`.

## 10. Talking to Mike

- Direct action over explanation. Don't stall, don't repeat a mistake, don't
  over-explain. **Carries:** `agent.yaml` (short voice-memo updates).
- Mike works from his phone. **Carries:** R25 (installable app).
- Verify before answering; read the source; say plainly when something can't
  be checked. **Carries:** §1B.
- **Open reminders:** when Mike sets one, repeat it every time until he says
  it is done. (The export's list is empty today.) **Later:** a Today card, on
  Mike's word.
- Mike runs a second AI assistant alongside his chat assistant; they share a
  log folder in Drive and Mike relays between them. R26 #2 made only that
  assistant's "Arbo for Claude" package reference only; no ruling covers its
  ongoing notes or the shared log.
- Mike wants voice. **Carries:** Talk (R30).

## 11. Out of scope

- Website, SEO, Google Ads and Google Business Profile notes: out of Arbo's
  scope (website/SEO boundary).
- Price figures (rates, targets, minimums, deposits, fees, crew rates): Mike
  prices; Arbo never does (R3).
- Personal notes (vehicles, design tastes, a notes vault, a chamber
  application): not Arbo.
- A client-data workbook built from contracts and calendar exports: Arbo
  imports nothing from it (§3).
- Market context only: most customers do not remember who did their last tree
  work, and no major storm has hit in about 25 years — why property memory
  matters (D45, `src/ops/growthForecast.ts`) and why storm outreach is not
  running (R28).

---

## Conflicts for Mike

Each one: what the export says, what the repo says. Nothing changes until
Mike answers. (Export paths are inside the memory export, not this repo.)

1. **Which rulebook binds Arbo.**
   Export (`projects/Co Work Chat/preferences.md`, 2026-10-08): "All
   Art-is-Tree operating rules live in ONE doc: 'Arbo Operating Rules' … If a
   rule isn't in that doc, it doesn't exist."
   Repo: `CLAUDE.md` "Source of Truth" (brief, add-ons, running code wins) and
   `docs/OWNER_RULINGS.md`. That doc is not in this repo.

2. **Calendar title format and source tags.**
   Export (`preferences.md`, 2026-10-06): "Format: 'Client Name - TAG -
   10-digit phone'"; tags TT (both flyer numbers), LSA, GA, O, Web, Call
   (untracked direct calls, "not O"), Ref, Rpt, WU, Y; "Web" replaced "WL".
   Repo: D34, `src/scheduling/eventFormat.ts`: space-separated "Client Name
   SOURCE 10-digit-phone"; tags TT, WEB, YELP, REFERAL, REC, GG, LSA, TLT,
   TSP, WL; a phone call maps to WEB. `src/reception/estimateHold.ts` writes
   "Name - phone" with no tag; `agent.yaml` titles start "Arbo HOLD
   (unconfirmed, Mike confirms Friday):".

3. **Calendar colours.**
   Export (`topics/operations-workflow.md`): "Job (work-day) events go on
   Google Calendar in orange (Tangerine)"; city colours given for Virginia
   Beach, Norfolk and Chesapeake only.
   Repo: `src/scheduling/config.ts` (D34): "Portsmouth: '6', // Tangerine";
   "Booked jobs/admin ride the calendar DEFAULT color".

4. **Times on the calendar before Mike picks the day.**
   Export (`operations-workflow.md`, 2026-09-28): "Never put estimate times on
   the calendar or offer them to customers on my own — including
   AI-receptionist 'preferred times'; log those as all-day 'NEEDS DATE'
   markers and ask Mike which day." And (2026-10-07) Sona "never books".
   Repo: R18/R20 — a timed hold per Sona call (`src/reception/estimateHold.ts`:
   at the caller's asked-for window, else 30 minutes from now;
   `docs/PHONE_SETUP.md` "calendar hold filed Mike's way");
   `guardrails.json` `businessFacts` takes details "for Saturday's route";
   `agent.yaml` books "an unconfirmed hold for that day".

5. **Two estimates at once.**
   Export (`people/` estimator note, 2026-10-06): two estimates "can overlap
   without conflict when [the estimator in training] covers one."
   Repo: D19 — "`DoubleBookingError` if the slot is taken"
   (`src/scheduling/scheduler.ts`); one estimator assumed.

6. **Saturday in the slot finder.**
   Export (and R14): estimates on Saturdays.
   Repo: D22, `src/scheduling/config.ts` `DEFAULT_SCHEDULING.workingDays` is
   Monday–Friday; only `src/ops/routePlanner.ts` plans a Saturday.

7. **Job-length bands.**
   Export (`operations-workflow.md`, "CREW DAY RULES", 2026-09-27) and
   `agents/arbo/agent.yaml` ("Job length follows the contract amount …") give
   different bands and a different full-day figure. Figures not repeated here.

8. **Who files contracts and drafts work orders.**
   Export (`operations-workflow.md`, 2026-09-25): "MIKE scans them himself …
   Claude does NOT scan/convert/upload contracts"; (`preferences.md`,
   2026-10-04) work orders: "never fill one out on my own — only when Mike
   gives the scope/price and asks".
   Repo: `agent.yaml`: "file signed contracts, and draft contracts and
   proposals" (each Drive write on Mike's OK); `docs/DOC_SCAN_TOOL_SPEC.md`
   saves scans to Signed Contracts after a confirm screen.

9. **Discounts.**
   Export (`topics/pricing.md`): Mike "already gives a [figure omitted]
   discount to military, first responders, and seniors".
   Repo: R8 "no discounts"; `src/reception/judgment.ts` blocks "a discount";
   `agent.yaml` "no discounts". Question: may Arbo say the discount exists
   (no figure), the way R8 lets it say financing exists?

10. **Hours for customer texts.**
    Export (`operations-workflow.md`, 2026-09-28): "Don't text customers
    outside business hours (late-night texts caused a complaint …)".
    Repo: 8am–9pm ET, any day (`src/legal/compliance.json` `quietHours`,
    `src/ops/outreach.ts`, R28 #5). Elsewhere the office phone's hours are
    8am–8pm, Monday–Saturday (R31).

11. **How a first text introduces itself.**
    Export (`preferences.md`, 2026-10-05): intro "I'm Mike's assistant, Arbo",
    only on the first text or after more than 2 days of silence; never claim
    to be Mike.
    Repo: R22 template "This is Art-is-Tree. … Call or text Mike at [business
    line]." (`guardrails.json` `quoteFollowUpText`); R28 / `agent.yaml`: a
    text the agent starts "names Art-is-Tree and ends with 'Reply STOP to opt
    out.'"

12. **A decliner can still get the R22 text.**
    Export (`areas/do-not-contact.md`, 2026-09-27): "anyone who declined us or
    said they went with someone else — stop contacting them. No follow-ups, no
    reminders, no 'checking in.' Only respond if THEY reach out first."
    Repo: R22 sends "48 hours after any new inbound inquiry that has not
    booked an estimate and has not heard from us". `src/ops/outreach.ts` skips
    STOP, solicitors, wrong numbers, booked callers, already-texted, and
    Mike's exclusions — but the exclusions live in memory only (lost on every
    redeploy), a decline message is not a skip reason, and the study's "lost"
    stage (`src/ops/quoStudy.ts`) is not consulted.

13. **Transfers to Mike.**
    Export (`projects/Co Work Chat/people/` estimator note, 2026-10-08): Sona
    does not transfer or forward callers to Mike's phone — "Just take their
    info."
    Repo: `guardrails.json` `callRouting.incident`: "Attempt a live warm
    transfer to Mike's personal cell" (Arbo's own line, cut under R21).

14. **Ring delay and voicemail.**
    Export (`areas/ai-receptionist.md`, 2026-10-07): Mike wants the forward
    at 10 seconds (it was about 20; callers took the long ring for voicemail);
    its dial code leaves out the `*11` service code. (`areas/call-tracking.md`,
    2026-10-06): "No voicemails … missed calls go right to Sona".
    Repo: `docs/PHONE_SETUP.md`: forward after 20 s; "The `11` (voice
    service) is required on T-Mobile — the short form without it … returned
    an error"; "Declined calls and phone-off calls still go to T-Mobile
    voicemail …".

15. **Talk while driving.**
    Export (`preferences.md`, 2026-09-26): in driving mode, "write phone
    numbers and times out the way you'd say them"; (`operations-workflow.md`,
    2026-09-27) jobs are named to Mike as "Street $Amount".
    Repo: R30 defaults (`src/voice/ownerTalk.ts`): never a phone number, email
    or street address; the guard holds back a dollar figure.

16. **Auto-reschedule when Mike is late.**
    Export (`operations-workflow.md`, 2026-09-14): if the phone "has not
    reached the job/estimate location within 2 hours of the scheduled Google
    Calendar time, Arbo reaches out to the customer and reschedules
    automatically."
    Repo: `CLAUDE.md` — agents cannot send anything (R22 and R28 are gated
    exceptions), never promise a date, never edit a calendar event.

17. **Pricing a part after damage.**
    Export (`operations-workflow.md`, 2026-09-14): "Arbo searches the web to
    identify and price the part".
    Repo: R3 — "The number always originates with a human";
    `guardrails.json` `callRouting.incident.neverQuoteRepairCost`. Question:
    is an internal parts-cost lookup allowed when no customer sees it?

18. **Virginia Beach buffer width and the tree-removal path.**
    Export (`topics/permitting.md`, 2026-09-13): the RPA has "a VARIABLE
    WIDTH buffer 'not less than one hundred (100) feet.' Not a fixed 100 ft",
    which also reaches past highly erodible soils; for tree work, "existing
    vegetation may be removed only pursuant to an administrative variance."
    Repo: `src/permitting/publicWorks/facts.ts` — `vb-rpa-buffer` "a 100-ft
    vegetated buffer"; `vb-ppr-tree-removal-form` "RPA tree work is filed as
    a Preliminary Project Request (PPR)"; `vb-cbpa-admin-variance` "A denied
    or edge-case PPR can proceed through a CBPA administrative variance"
    (also `vb-single-tree-by-email`, `src/permitting/cities.ts`).
    `docs/GO_LIVE.md` §5 already holds "the 125-ft rule vs the erodible-soil
    extension … and the VB PPR vs administrative-variance path."

19. **Payment terms and who gets an invoice.**
    Export (`topics/pricing.md`, 2026-09-14): "the proposal doubles as the
    invoice; a separate invoice is sent only when the customer pays
    electronically"; payment is due within a net period counted in business
    days, then a surcharge repeats on a fixed cycle until paid (figures
    omitted).
    Repo: `src/ops/invoicing.ts` — `DEFAULT_NET_DAYS` counts calendar days;
    `lateFeeOwed()` charges the late fee once; `buildInvoiceDrafts()` drafts
    an invoice for every completed job with an agreed amount.
    `src/ops/loopCloser.ts` `work_done_never_billed` flags every completed
    job with no invoice as urgent. Question: do the net periods match,
    should the surcharge repeat, and should Arbo draft invoices only for
    electronic payers?

20. **Proof of insurance: auto-sent or recommended.**
    Export (`areas/ai-receptionist.md`): "Follow-up every 2 days after an
    estimate; auto-sends proof of insurance after every estimate".
    Repo: `src/ops/followUps.ts` — "it never sends anything. Every action is a
    recommendation for Mike"; the proof rides the FIRST follow-up only.
    `CLAUDE.md`: "agents cannot spend money or send anything" (R22 and R28
    are the gated exceptions); Arbo's own code never sends email.

21. **Payment plans now, member financing later.**
    Export (`areas/roots-club.md`): in-house financing is a perk of a
    membership program that has not launched, separate from the third-party
    lender — "Two distinct financing paths Arbo must distinguish between."
    Repo: R8, Mike: "we can set them up on a payment plan";
    `guardrails.json` `financing.offerLine`: "We do offer financing and
    payment plans". Question: are R8's payment plans the membership
    financing? If so, may Arbo offer them before the program launches?

22. **Arrival window or exact time.**
    Export (`preferences.md`): give "a ~30-minute arrival WINDOW … not an
    exact time, so the route has flexibility"; (`operations-workflow.md`,
    2026-09-28) crew jobs get a one-hour window.
    Repo: R14 "exact time only Friday afternoon"; R29 #4's replacement line
    "Mike will confirm the exact time." (`guardrails.json`); `agent.yaml`:
    "The customer is told Mike confirms the exact time Friday afternoon".

23. **Which credentials Arbo may name.**
    Export (`profile.md`): "Approved business credentials: licensed and
    insured, BBB A+".
    Repo: `agent.yaml`: "only 'licensed and insured, Google Verified, 5 star
    rated'. Never claim TCIA, ISA or any other membership, certification or
    award."; R13: "BBB A+ left the phone script"; the permit packet still
    prints "Licensed & insured · BBB A+" (R13, open). Question: may written
    words (emails, the permit packet) say BBB A+?
