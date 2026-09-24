<!--
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
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

  Remember the marker: SLOW::ARBO
-->

# Owner rulings — DO NOT "FIX" THESE

Mike owns this business. Several things in this codebase look wrong to a
reader who only has the brief, and are right because of how Art-is-Tree
actually operates. Every one of them below was a real correction: the code
did the "obvious" thing, and the obvious thing was costing money or effort.

**If you are auditing and something here looks like a bug: read the ruling
first, then ask Mike. Do not revert it.** A ruling is only superseded by Mike
saying so, and the new ruling gets appended here with a date.

Each entry names the file(s) that carry the rule, so a grep from the code
lands here.

---

## R1 — Suffolk is a MARKETING boundary, not a licensing one
**Ruling: 2026-08-02.** Mike: *"we're just not advertising there for the
season, too much work closer to home."*

**Why it looks wrong:** the app is built around four cities — Virginia Beach,
Norfolk, Chesapeake, Portsmouth — and Suffolk sits outside them.

**What was actually wrong:** the four-city area was being enforced as a HARD
LIMIT. `upsertProperty` threw `OutOfServiceAreaError` on a Suffolk address,
so the lead was binned at intake. Not flagged, not queued — gone. For work
Mike would happily take.

**The rule now:** Suffolk is *workable* and *off marketing focus*. It is
accepted, flagged, and never auto-rejected. It is deliberately NOT promoted
to a core service city, because each core city has a permit ruleset behind
it and screening a Suffolk property against Virginia Beach rules would give a
confident wrong answer on a compliance surface. Off-focus cities report
"no permit ruleset on file — verify with the city" instead.

**Do not:** add Suffolk to `SERVICE_CITIES`, or make `serviceCityForZip`
resolve a Suffolk ZIP. Both would let Suffolk inherit another city's permit
rules through the back door.

*Carried by:* `src/lib/address.ts` (`OFF_FOCUS_CITIES`), `src/db/repositories.ts`
(`upsertProperty`), `src/reception/leadSink.ts`, migration `0015`.

---

## R2 — The calendar IS Google Calendar. Do not rebuild it.
**Ruling: 2026-08-02, given twice.** Mike: *"You take the Google Calendar and
plant it into the app simple / Why do you make everything insanely
complicated."*

**Why it looks wrong:** the app has a `calendar_event` mirror in the database
and a `GET /api/calendar` endpoint, so a reader assumes the UI should render
from the mirror. An `<iframe>` looks lazy.

**What was actually wrong:** I built a custom week-grid off the mirror. Mike
did not want a second calendar to maintain; he wanted his calendar, in the
app.

**The rule now:** the Calendar tab is an `<iframe>` of Google Calendar. Mike
reads AND edits in Google's real UI. Arbo never writes to Google. The mirror
still exists because the agents and the Morning Brief read it — it is not a
user surface.

**Do not:** replace the iframe with a rendered view "for consistency".

*Carried by:* `src/app/index.html` (Calendar tab), `test/appUi.test.ts`.

---

## R3 — Arbo never sets a price. The number always originates with a human.
**Standing rule (§3), reinforced by how the money loop is built.**

**Why it looks wrong:** `POST /api/invoices` ignores an `amount` in the
request body, and a completed job with no `agreed_amount` refuses to produce
an invoice draft. Looks like a missing feature.

**The rule now:** the invoice amount is copied verbatim from
`estimate.agreed_amount`, which a human types after the signed estimate. No
agreed figure → no draft, and the reason is shown. The crew door carries no
money at all: a crew-filed change order has NO amount, and the office prices
it.

**Do not:** "helpfully" derive a price from the yard-check estimator, from
past jobs, or from OCR. Summing figures a human already agreed to is fine —
that is arithmetic. Producing a new number is not.

*Carried by:* `src/ops/invoicing.ts`, `src/ops/changeOrders.ts`,
`src/server/api.ts` (`createInvoice`, `crewChangeOrder`).

---

## R4 — Mike handles the leads. Arbo does not ingest them yet.
**Ruling: 2026-08-02.** Mike: *"I already took care of this you need to not
[store] anything until you've watched the system for a week or 2."*

**Why it looks wrong:** `docs/OPS_SWEEP.md` describes a sweep that ingests
leads, and the classifier is fully built.

**The rule now:** scheduled sweeps run READ-ONLY. They scan and report issues
— unmatched lead sources, calendar drift, data-integrity problems — and write
nothing. No lead rows, no Gmail labels, no calendar edits. The classifier
work continues, because the point is that the app can SEE every channel; the
storing comes later, on Mike's word.

**Do not:** re-enable ingestion because the runbook's Step A says to.

---

## R7 — Do not touch the website, Resend, or anything SEO-adjacent
**Ruling: 2026-08-02.** Mike: *"we would have to re configure the resend and
code on the site all of that and in turn you'd mess with my rankings for
something you're not even supposed to be working on."*

**What happened:** I built a classifier branch for the website contact-form
channel. In the app it was harmless — but making that channel actually useful
means reconfiguring Resend and the site, and the site's search rankings are a
live business asset. It was reverted (`bb77428`).

**The rule now:** Arbo's scope stops at the app. Anything that would require
changing artistreevabeach.com, its forms, or its mail plumbing is OUT — even
when the code change itself lives in this repo, if the change only pays off
by touching the site.

**Do not:** re-add the FormSubmit channel, or any other work whose value
depends on editing the website.

---

## R8 — Payment plans and financing are ALLOWED. Offer them gladly.
**Ruling: 2026-08-03.** Mike: *"its supposed to be the oposite we can set them
up on a payment plan"* and *"it can gladly pass our finiacing option and where
the app is."*

**Why it looks wrong:** `docs/VA_TRAINING_BRIEF.md` §1.3 lists "No payment
plan, no deferred payment, no 'pay us when you can'" among the hard-nos, and
the first implementation blocked exactly that. Mike overruled it — Art-is-Tree
really does offer financing and payment plans, and turning a caller away from
them loses work.

**The rule now:** ARBO offers financing and payment plans gladly, and shares
where the app is. There is deliberately NO payment-plan pattern in
`FINANCIAL_COMMITMENTS`. **Do not add one back from reading the brief.**

**What still holds:** ARBO may say a plan or financing is AVAILABLE. It may
never state terms, rates, instalments, or any figure — those are numbers, and
§3 no-price already blocks them. The rest of §1.3 stands: no discounts, no
waiving a haul or a stump, no "throw that in", no matching a competitor.

**The links are nullable on purpose.** `financing.applyLink` and
`financing.appLink` are null until Mike supplies the real ones. While null,
ARBO says Mike will send it rather than guessing a URL (§1.4 — never say
something Mike then has to lie to defend). Filling them in is a config edit,
not a code change.

*Carried by:* `src/reception/judgment.ts` (`FINANCIAL_COMMITMENTS`),
`src/policy/guardrails.json` (`financing`), `src/reception/systemPrompt.ts`,
`test/judgment.test.ts`.

---

## R5 — Opus is the brain
**Owner decision (§8A.2), re-affirmed 2026-08-03.** Agents run on
`claude-opus-5`. Do not downgrade an agent to a cheaper model for cost
reasons; that is Mike's call, not an optimisation to make quietly.

**Applied to the phone line, 2026-08-03.** Mike's separately-built ElevenLabs
agent ran on `gemini-2.5-flash` with the guardrails as prompt text. Asked
which way to go, Mike said **"we are using opus"** and **"guardReply()"**.
So ElevenLabs is VOICE ONLY and calls Arbo as its custom LLM at
`/voice/llm/chat/completions`; the conversation runs on Opus and every spoken
line passes `guardReply()` — a rule in code cannot be talked around, a rule in
a prompt can. The scaffold from that session is filed unmerged at
`docs/receptionist-r2/`.

*Carried by:* `src/agents/*` (`modelUsed`), verified in `agent_run`.

---

## R6 — AR is iOS-first: RealityKit + ARKit + LiDAR
**Ruling: 2026-08-02 (D51).** Resolves the brief's own §6B.4i vs §6T.4
conflict. Both camera tools build on Apple's stack for real depth occlusion.
Crew AR phones are iPhone 12 Pro+. The Expo/React Native surface remains the
cross-platform app for everything non-AR. Android AR waits.

---

## R9 — Everything is a LEAD until a signed contract is in the file
**Ruling: 2026-08-04.** Mike, in his own words:

> "when a customer contacts us, initially, it is a lead. Then after they text
> me or email me, a signed proposal or I take a picture myself on-site, it is
> still simply just a lead. Booked jobs are those contracts that you're
> putting in the signed contract file. Those are proposals that turn to
> contracts. That is the money. Those are what we want. Everything else is a
> potential lead. Then we will figure out which ones are the moneymakers from
> there."

So the line is not "we have talked a lot", not "it is on the calendar", and
**not "they signed the proposal"**. It is one fact: a proposal became a
contract and that contract is filed in Signed Contracts.

**Why this ruling is load-bearing.** The app already got it wrong with his
money. Eleven ingested leads landed in `job` at status `booked`, which the
crew door renders as work orders. Checked live on 2026-08-04: **11 jobs, all
booked, 0 contracts, 0 signed** — so every one of them is a job by the schema
and a lead by this ruling. He said cut, not delete, so the rows stay. What
changed is that nothing downstream is allowed to believe them.

**Fails closed.** An unreadable contract table is not evidence of a contract.
If the lookup fails, or a data source cannot answer the question at all,
NOTHING is dispatched and the note says which failure it is — an unreadable
day, not an empty one (§1B).

*Carried by:* `src/ops/jobBoundary.ts` (`authorizeBooking`, `splitByContract`,
`assertEveryWorkOrderHasContract`), the `crewWorkOrders` handler,
`jobIdsWithFiledContract()`, `test/jobBoundary.test.ts`, `test/crewApi.test.ts`.

---

## R10 — LSA cannot be read from Gmail. It needs the browser.
**Ruling: 2026-08-04.** Mike: *"You cannot access LSA from the email, the
Gmail. You need to have a web browser attachment and be able to get into our
Google Ads LSA."*

Verified against a real message the same night: the Google LSA notification
body carries only *"A potential customer called you on 08/03/2026 at 10:12
AM"* plus a link into the LSA console. No name, no phone, no address, no
free text. There is nothing in the mail to parse.

**So stop trying to parse it.** The notification is good for exactly one
thing — "an LSA lead landed at 10:12, go open LSA" — and any parser that
appears to extract more is extracting nothing and storing a blank row. That
is the failure the FormSubmit HTML-body note already exists to prevent, and
HomeAdvisor's parser already handles it correctly by pointing at their app
instead of pretending to hold details.

**Real LSA access is a separate build:** browser access into Google Ads LSA,
not an email classifier. Not started; needs Mike's word on how.

---

## R11 — The live advertising channels, in Mike's list
**Ruling: 2026-08-04.** Asked what is actually running:

> "Organic Website Traffic, LSA, Google Ads, Yelp, organic phone calls,
> referrals, and repeat customers. Oh, and the Tree Leads Today flyers."

And separately: **"TSP is Tree Leads Today as well."** So the CallRail
form-submission lead tagged *"TSP National Lead Gen Facebook"* — flagged in
the 23:00Z sweep as an unrecognised paid channel — is Mike's, and live. It
arrives through CallRail's form alert, not its own sender.

**Not on the list:** HomeAdvisor and Angi, consistent with them being
switched off seasonally on 2026-08-03.

**What has no email notification at all:** referrals, repeat customers, and
the flyers. Those arrive as phone calls through CallRail or as direct texts,
so no classifier can ever see them as a distinct channel — a sweep that
reports "channels seen" must not imply those are quiet.

---

## Open — Mike has not ruled yet

- **Friday questionnaire length: 10 or 15 questions.** Built PARAMETERISED
  (`defaultQuestionnaireConfig.questionCount`) so either answer is a config
  change, not a rewrite.
- **FormSubmit / website contact page** — deliberately NOT handled. See R7.
- **Doc-scan tool** (`docs/DOC_SCAN_TOOL_SPEC.md`). Proceeding on two stated
  defaults unless Mike says otherwise: OCR *proposes* the total on the confirm
  screen and never writes it (so Arbo cannot price from a photo), and a
  scanned address matching no existing property is HELD for Mike to match
  rather than creating a possibly-duplicate twin. See
  `docs/DOC_SCAN_RECONCILIATION.md`.

---

## R12 — The inbox check's channels, in Mike's words
**Ruling: 2026-09-21.** Mike: *"the gmail inbox check needs to be for only
cailrail, form submissions from tree leads today and the website and direct
emails only requesting an estiamate or sending in an approved work order"* —
then, corrected the same day when the exclusion was flagged back to him:
*"lsa and google ads and yelp stay on."*

**Net effect:** every previously-live channel stays live (CallRail call+form
— Tree Leads Today arrives through the CallRail form alert per R11 — website
form, LSA, Google Ads lead form, Yelp; HomeAdvisor/Angi stays seasonally off
per the 2026-08-03 ruling). The one ADDITION is **direct email**: a person
writing in to request an estimate, or sending an approved work order, is now
recognised (`provider: 'direct_email'`) instead of falling into "other mail".
Containment, since a direct email has no sender anchor: never a platform
sender (the D65 alarm path must keep working), never mail with an
unsubscribe footer (marketing), and only an actual ask. City permit mail
sighting stays — flagged to Mike with the ruling and not objected to.

---

## R13 — The receptionist speaks Mike's own prompt (the port)
**Ruling: 2026-09-21.** Mike rewrote the ElevenLabs dashboard prompt himself,
then said **"port it"** — because once the custom LLM is on, the dashboard
prompt stops driving replies and the server's config-built prompt governs.
Ported into `guardrails.json` (one source of truth), his words: the
emergency-first question ("is everyone safe"), the four project branches
(removal / pruning / stump grinding / land clearing), stump pictures texted
BY THE CALLER to 757-319-5131 (which also retires the old prompt's
we-text-you-a-link promise no code could keep), Miss Utility, the Virginia
Lawns referral for clean-ups, and the credential change: **spoken claims are
now "licensed and insured, Google Verified, 5 star rated" — BBB A+ left the
phone script.** The schema refinement and tests now pin the NEW ruling.

**Deliberately NOT ported, flagged:**
- His dashboard disclosure edit ended mid-sentence ("recorded for quality ");
  the server keeps the vetted legal line ("may be recorded for quality and
  training purposes"). Changing legal disclosure wording is its own ruling.
- The permit packet (`src/permitting/packet.ts`) still prints
  "Licensed & insured · BBB A+" — a held accreditation on city paperwork is
  a different surface than a phone claim. Mike's call if it should change.
- The prompt still tells emergency callers Mike is being alerted right away;
  the alert is still a console line until he rules on a channel.

---

## R14 — The business facts, in Mike's words (2026-09-21)
**Ruling:** payments are cash and check, cards carry a **4% surcharge**,
electronic payments accepted (Zelle, Venmo, Cash App, PayPal — Mike confirms
any fee); **yes we work with insurance companies** and Mike answers all
insurance questions on storm work and billing; **nobody needs to be home**
for an estimate — Mike can call onsite; estimates run **after work or
Saturdays** — Virginia Beach after 12, Norfolk/Chesapeake/Portsmouth in the
morning, **exact time only Friday afternoon** once the route is optimised;
typically **booked out 2–3 weeks**; everything included **except stump mulch
and cutting/stacking firewood**; **crane work regularly**; emergency
**tarping after the project, billed afterwards**; **add-ons/change orders
need Mike's approval**. All ported to `businessFacts` in guardrails.json —
she answers FROM these and invents nothing beyond them.

**Three parts of the same instruction NOT built yet — each crosses a
standing hard rule and needs Mike's explicit go:**
1. **"Add them to the Google Calendar for that upcoming Saturday."**
   Crosses *"Never modify calendar events. Ever."* and §3 (links cut). Until
   overridden, she takes the details for Saturday's route and Mike confirms
   Friday — she never claims to have put anyone on a calendar (§1B).
2. **Approved work orders filed to Drive → Signed Contracts, scanned, named
   `street name, dollar amount, city initials`.** The naming convention is
   now on record. Automating the filing crosses R4 (sweeps read-only, write
   nothing) and §3. The R12 classifier already SIGHTS approved work orders
   arriving, so the sweep can flag "needs filing" without writing.
3. **Every Sunday: pull the weekly schedule from Mike and tell each client
   their day and time.** Outbound customer messaging crosses *"agents cannot
   send anything"* + TCPA gates, and no send channel exists (Twilio needs
   Mike's credentials). Needs a channel ruling before any build.

## R17 — Read everything, surface what matters; customer contact may show on app cards
**Ruling: 2026-09-23.** Mike, on the inbox intent classifier build prompt:
*"yes to all of it use opus and build it."* Four boundaries moved — each is
his explicit override, on the record:

1. **The app UI may show customer name / phone / ZIP / address on surfaced
   mail cards.** This overrides the presence-only design of the inbox sweep
   FOR THE KEYWALL-GATED APP ONLY. §4.3 still rules logs, chat replies, and
   the watch's own report — those stay counts-and-ids, and `assertNoPii()`
   still guards the sweep's return path. The surfaced store
   (`src/ops/inboxSurface.ts`) serves `/api/inbox/*` behind the keywall and
   nothing else.
2. **Every non-obvious email thread is sent to the Opus model for intent
   classification** (`claude-opus-5`, Mike's pick over any cheaper model) —
   customer mail content goes to the Anthropic API on every sweep. Channels
   Mike switched OFF and city permit mail are not spent on the model.
3. **Learn-and-adapt stays human-in-the-loop.** The model proposes intents
   (2+ sightings), Mike approves/renames/rejects; his one-tap re-labels are
   absolute per-thread and feed back as REDACTED snippets only. In-app
   approvals and corrections are in-memory until committed to
   `src/policy/inboxIntents.json` — the UI says so, per §1B.
4. **A contract-approval card PROMPTS estimate→job conversion; the tap is
   Mike's and the endpoint refuses by name while the links are cut.** Never
   automatic.

What did NOT move: Gmail stays read-only (`gmail.readonly`, one-method
interfaces); nothing ignored is deleted — "ignored" means not shown, and the
log keeps every entry with a one-line reason; `ARBO_DATA_LINKS` stays off
until Mike runs the acceptance checks and flips it himself; Yelp stays a
surfaced channel (R12 wins over the prompt's five-intent table).

## R18 — Learning ON (conversation only), records kept, calendar writes during calls
**Ruling: 2026-09-24.** Mike, verbatim: *"lets change the rule let her start
learning but any major code writes to her full functionality or the rest of
the app need to remain blocked let her learn and adapt to converstaion and
pattern recogntion, addtionally she needs to be keeping a record as well as
adding this information to the google calender while the call is going on."*

What this changes:
1. **Arbo LEARNS — conversation and pattern recognition only.** She may
   remember callers across calls (repeat-caller recognition, what is already
   on file, how the caller likes to talk) and adapt her conversation to it.
   **Self-modification stays BLOCKED, structurally:** nothing in the learning
   layer can write code, change prompts, change guardrails, or touch the rest
   of the app. Learning is data she consults, never behavior she rewrites.
2. **She keeps a record of every call** — the captured qualification, caller
   number, and outcome. Served only behind the keywall (R17 boundary: app UI
   yes, logs and chat stay counts-and-ids).
3. **"Never modify calendar events. Ever." is AMENDED:** Arbo may **CREATE**
   events on Mike's Google Calendar during a live call — an unconfirmed
   estimate hold carrying what she captured, always marked as Arbo-created
   and unconfirmed ("Mike confirms the time"). She still NEVER edits, moves,
   or deletes any existing event, enforced by a one-method writer interface
   that cannot express an edit. Email remains never.

Blocked on Mike to go fully live: the Google consent must now cover BOTH
scopes (gmail.readonly + calendar.events) — same consent flow, one extra
checkbox. Until the token exists the calendar writer reports itself
unconfigured by name, never quietly.

## R19 — Data links reconnect ONE BY ONE (verified), website forms go direct to Arbo, webhooks for everything
**Ruling: 2026-09-24.** Mike, verbatim: *"contecting the links for the data
it needs one by one after a multiple step verification process and making
the resend website forms be sent directly to arbo"* — then, same session:
*"i want it to still be emailed to me but also go to arbo do you
understand"*, *"and make sure its using supabase the correct way"*, and
*"add webhooks for everything"*.

What this changes:
1. **§3's reconnect is authorized — but STAGED, never a single flip.**
   `ARBO_DATA_LINKS=live` now opens only the MASTER; every named link
   (`src/db/links.ts`) needs its own `ARBO_LINK_<NAME>=live`, set only after
   that link's verification passes (docs/DATA_LINKS.md: migrations parity,
   RLS + advisors clean — "using supabase the correct way" — row-count and
   content review with anything unexpected flagged to Mike, tests green,
   then open and verify live). Fail-closed at three doors: master, link,
   and the `from()` guard in `getDb()`.
2. **The Resend hard boundary is AMENDED for one wire:** Resend may notify
   Arbo of what it sends (webhook → `/webhooks/resend`), and Arbo may READ a
   sent form email's content via the Resend API. **The email copy to Mike is
   untouched — same submission, delivered twice on purpose.** The website
   itself stays untouchable (no site code, no DNS, no form endpoint change),
   and Arbo still NEVER sends email — the one Resend client in the codebase
   has a single GET method and no send path, pinned by test.
3. **Everything that can push to Arbo, does:** Resend email lifecycle,
   ElevenLabs post-call transcripts, Railway deploy events — one intake
   (`src/ops/webhooks.ts`), every route signature-gated, every unwired
   source NAMED in the status (§1B), stores in-memory and capped.

What did NOT move: importing business data stays gated (§3 — connecting a
link opens the door; nothing walks through it without its own ruling);
sweeps stay read-only (R4); logs stay counts-and-ids (§4.3); the website,
DNS, and SEO stay untouchable; deploy stays manual.
