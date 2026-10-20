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

## R20 — Sona (Quo) answers the missed calls for now; Arbo learns from every one
**Ruling: 2026-09-24.** Mike, verbatim: *"i think we should use quo and re
think this whole section, its ai agent handles calls and sounds way better
than 11 labs"*, then *"im just going to turn call forwarding on to quo and
let sona handle it for a while while arbo learns from it"*, then *"auto do
it"*.

What this changes:
1. **Missed business calls go to Quo's AI (Sona), not Arbo's own voice.**
   Mike's T-Mobile number forwards unanswered calls after 20 seconds to the
   Quo number (757-606-9432). The number stays on T-Mobile — no port (his
   call: "i dont want to port the number").
2. **Arbo learns from every Sona call automatically.** Quo pushes each call,
   transcript, summary and text to Arbo; Arbo checks Sona's words against
   the rules (the same code guard as Arbo's voice, plus an Opus read for
   dates, credentials and service area), files the calendar hold Mike's way,
   keeps the record and remembers the caller.
3. **What does NOT move:** Arbo still never sends anything — the Quo client
   has no message or call method. The rules still bind: Sona's slips are
   flagged, not excused. The ElevenLabs line stays live but idle until Mike
   decides whether to retire it.

Known gap, named: Sona's rules are Quo-side instructions, not a live code
guard — a slip is caught after the call, not prevented during it.

## R21 — Twilio and ElevenLabs links CUT while development runs off Sona
**Ruling: 2026-09-24.** Mike, verbatim: *"make sure you disconnect the
twilio and eleven labs links while we develop off sona"*.

What this changes: Arbo's own phone line — Twilio number 757-821-6983 →
ElevenLabs agent → Arbo's guarded Opus bridge — is CUT in code
(`src/integrations/vendorLinks.ts`). Every door those links open refuses by
name (503 `link_cut`): the voice bridge, the ElevenLabs post-call webhook,
Talk to Arbo, the spoken brief, and the Twilio incoming-text webhook. Same
fail-closed shape as the data links: open only when `ARBO_LINK_ELEVENLABS`
/ `ARBO_LINK_TWILIO` is exactly `live`.

What did NOT move: nothing is deleted — the agent, the number, the bridge
code, and every secret stay where they are. Sona (Quo) is not behind these
switches. Reconnecting is Mike's call, one variable each.

## R22 — Arbo may TEXT via Quo: the "still interested in a quote?" text
**Ruling: 2026-09-24.** Mike, verbatim: *"set up the ability to send texts
via quo to have people reach back out to 7573195131 if they are still
intrested in a quote for the past week only and after that use the same
templet for follow ups"*.

What this changes:
1. **"Agents cannot send anything" gets ONE exception: a text, via Quo,
   from the Quo line (757-606-9432).** The sender is a single file
   (`src/integrations/quoSend.ts`) that nothing may call except the outreach
   engine, and the engine runs every text through the compliance gate that
   already existed in code and had never been wired
   (`inspectMessage`: consent, STOP, 8am–9pm ET, no price / diagnosis / date
   promise) plus Quo's own record (STOP and "already texted" are read from
   Quo before every send, so a redeploy can never forget them).
2. **One template, Mike's words, in the policy file he owns**
   (`guardrails.afterHoursAndOverflow.quoteFollowUpText`). It carries the
   business name and "Reply STOP to opt out"; a template that fails the
   gate sends nothing, by name.
3. **The past-week catch-up:** everyone who reached the Quo line in the
   last 7 days and has not heard from us — one text. Runs on Mike's tap in
   the app or the `ARBO_OUTREACH_CATCHUP=live` switch.
4. **Follow-ups after that:** the same text, 48 hours after any new inbound
   inquiry that has not booked an estimate and has not heard from us.
   Automatic only while `ARBO_OUTREACH=live` (fail-closed like every
   switch).
5. **Who never gets texted:** a number we only dialed; a solicitor or wrong
   number — decided from the caller's WORDS, never a carrier label (the
   spam-likely ruling, R23); anyone who texted STOP; anyone
   Arbo or Mike already texted in 30 days; a number Sona already booked;
   our own numbers; group threads; anyone Mike excludes in the app.
   *Tightened by the pre-ship review (D78), same ruling, no new scope:*
   STOP is read from the whole history, never a window, and plain words
   count ("please stop", "opt me out", "do not text me"); a texter's words
   are read like a caller's; nobody is texted mid-call or after Mike already
   called them back; the business line and Arbo's own line count as ours.

What did NOT move: email never; calendar edits never; Twilio and ElevenLabs
stay cut (R21); sweeps stay read-only (R4); logs stay counts-and-ids (§4.3)
— numbers appear only in the keywalled app; nothing is sent to anyone who
did not contact the business first (the call-in is the consent basis,
compliance.json). Quo's US texting (A2P 10DLC) registration is Mike's to
complete in Quo → Settings → Trust center; until it is approved Quo refuses
every send and the app says so by name.

## R23 — "Spam Likely" can be a client: a carrier label is never evidence
**Ruling: 2026-09-24.** Mike, verbatim: *"Spam likely calls could be clients
a lot of spam likely calls come in as clients"*.

What this means:
1. **No code path may drop, screen, skip, or down-rank a call or a number
   because of a carrier label** ("Spam Likely", "Scam Likely", unknown
   caller). Audited the same day: no code reads the label anywhere. Brief
   §2.1 ("answer every call — the label is not evidence") is carried by
   `src/reception/judgment.ts` and pinned by `test/judgment.test.ts`.
2. **Solicitor / wrong number is decided only from the caller's own words**,
   spoken to Sona or texted: the Sona extractor's `callerType` and R22
   outreach. A hang-up stays a possible client.
3. **Mike-side settings (outside the code):** T-Mobile Scam Shield "Scam
   Block" must be OFF (it drops Scam Likely calls before the phone rings, so
   the 20-second forward to Sona never fires); iPhone Silence Unknown Callers
   OFF; never decline a Spam Likely call — let it ring out so it forwards to
   Sona (or dial the busy/declined forward in `docs/PHONE_SETUP.md`).
4. **Sona (Quo side):** never tell her to screen or hang up on sales calls.
   Her instructions should say: *"Answer and help every caller. Never treat
   a call as spam because of a caller-ID label or an unknown number; if
   unsure, take their name, number and address and let Mike decide."*

**Named, not changed — waits on Mike's go.** Arbo's own voice line (cut
under R21) has solicitor triggers a real customer can say: "your google
listing" (answering "how did you hear about us?") and "final notice" (a
city notice about a tree); "press one" also matches inside "express one".
A spam turn sets a sticky `screened` flag that suppresses that call's
record. Proposed before that line is reconnected: drop those two triggers,
word-boundary matching, and a call-wide customer veto. `intent.ts` and
`receptionist.ts` are SLOW::ARBO and are not touched without his go.

## R24 — Arbo may READ everything (read-only): the customer study
**Ruling: 2026-09-27.** Mike, verbatim: *"Give Arbo read only access"*, then,
asked to confirm it may read customer names, numbers and messages from Quo
and his Drive lead logs: *"Yes it can read only everything"*.

What this changes:
1. **Arbo may READ every customer thread on the Quo line** — Sona's calls,
   the calls Mike answers or makes, every text in both directions (Mike's
   and his hourly assistant's, which go out through Quo) — **and the
   hourly assistant's Drive lead logs and ops notes** (folder
   `1aP2VLR3mU7B95JELfwDFIZUqL1btBNQE`). Opus reads each customer's record
   and writes one note: who, what they want, where it stands, what was
   told to them, what is next (`src/ops/quoStudy.ts`).
2. **Read-only, structurally.** The Drive reader is GET-only on a
   `drive.readonly` credential; the study calls only Quo's read methods and
   holds no sender. Pinned by `test/quoStudy.test.ts`.
3. **Reading is not importing.** §3's "import nothing" still holds for
   Arbo's database: notes live in memory, show only in the keywalled app,
   and are rebuilt from the sources after a redeploy. No lead rows, no
   Drive/Gmail/Calendar/Quo writes, nothing sent.

What did NOT move: email never; calendar edits never (R18 holds only);
texting only via R22; logs stay counts-and-ids (§4.3).

## R25 — Build the whole platform: premium, installable, every section, field-test ready
**Ruling: 2026-09-28.** Mike, verbatim: *"I want this app to look and feel as
if it is a 20,000 dollar project. No template for the design it needs to be
hand built and original. It's needs to be focused on easy of use but
severely complex in it functions. I need you to finish this apps framework
and coding for all parts. It needs to be optimized for mobile and be able to
be as an actual app on home screens of phones both major operating systems.
It needs to be compatible of connect to lidar and it needs a public works and
permits handcrafted data base. The crew portal needs to be designed as well
and. Build this app from the ground up with your brief and is add ons and use
your skills and plug ins to research the best things for it and how it will
be the operating system of my tree service. Train its brain and reference all
complexity and issues as an adaptive learning interface and over come all.
Make the 8 agents you need to have working in each section of the app and the
opus brain a complete list of problems a human might face via a simulated
learning environment. Keep working until you have a finished project that is
ready to be field tested and to go live."*

What this changes:
1. **Scope gate opened by the owner.** "Current approved scope: receptionist
   + permitting" becomes **every section of the app** (CLAUDE.md updated).
   Mike's instruction is the approval; add-ons still follow the read order
   and conflicts still stop and ask.
2. **Design is hand-built.** An original design system — no UI kit, no
   template, no CSS framework — shared by the owner app and the crew portal.
3. **Installable on iPhone and Android home screens** as a web app (manifest,
   service worker, icons, offline shell). App-store listing is a separate
   step (developer accounts) and is not implied.
4. **LiDAR.** Arbo reads point-cloud files exported by phone LiDAR scanning
   apps and measures from them. A web app cannot drive the iPhone LiDAR
   sensor directly; that limit is said on screen, never hidden.
5. **Public works & permits database**, handcrafted per city with a source
   and a verified-on date for every fact; permit language stays PERMIT LIKELY
   / REVIEW NEEDED / NO OVERLAY–VERIFY and never "you're clear".
6. **Eight section agents** on the existing binder, and a **simulated
   learning environment**: a catalog of problems real people bring to a tree
   service, run against the brain and scored against Mike's rules. The brain
   "learns" by lessons Mike approves — nothing retrains itself, rewrites its
   own rules, or changes code (R17 boundary).

What did NOT move: data links stay cut until Mike opens them one by one
(§3, R19) — "go live" is his process, not an optimisation; nothing is
imported from live business activity beyond R24's read-only study; email
never; calendar edits never (R18 holds only); texting only via R22; logs
stay counts-and-ids (§4.3); the website, Resend and SEO stay out of scope;
deploys stay manual.

## R26 — The pre-deploy review answers (Mike, 2026-10-20)

Mike answered all 16 questions on his private pre-deploy review page
(2026-10-18) and then said in the session: *"Done"*. Every answer was **Yes**,
none carried a note. The answers live in the review page's own store
(`answers/<id>`, written 2026-10-20 03:57–04:00 UTC). In order of weight:

1. **Deploy** the reviewed build (R25 + the three QA rounds, #41). Data links
   stay cut; nothing new turns on.
2. **The Grok "Arbo for Claude" package is reference only, not an add-on.**
   It does not replace the Master Build Brief. Useful parts are taken on
   purpose, one by one (see `docs/research/GROK_HANDOFF_REVIEW.md`).
3. **R25 stands** over the package's "no Claude Code build — Jack's veto".
   Personas in another system's documents have no standing in Arbo.
4. **Keep the three permit words** (PERMIT LIKELY / REVIEW NEEDED / NO
   OVERLAY–VERIFY) over add-on -01's CLEAR / EXEMPT / PERMIT REQUIRED. This
   settles the -01 vocabulary conflict; its other held items stay held.
5. **Approved to build** (each listed with the default Claude used where the
   page asked for a detail and the note was left empty — Mike may change any):
   - Sourced Virginia facts from the package into the Permit Desk, marked
     UNCONFIRMED until checked (VA811 dig-site steps, imported fire ant
     quarantine, power-line statute by section, pest regulatory status).
   - A code guard that blocks a spoken or drafted date promise.
   - A brake or steering defect keeps a unit off the schedule until signed
     back on. *Default: Mike signs it back on (no designate).*
   - Emergency script tells a caller to call 911 when someone is hurt and
     Dominion when a line is down. *Default wording drafted by Claude,
     shown to Mike to change.*
   - A TCIA/credential question is answered "licensed and insured".
   - An owner-only storm-law awareness flag (Va. Code 59.1-526/527).
   - Spanish-speaking callers are recognised. *Default: detect and flag only;
     what a Spanish caller hears is still Mike's call.*
   - Screen decisions: one label per permit state everywhere (the badge
     wording); page headings on Book, Queue, Numbers, Settings; desk names
     lined up; an emergency lead reaches Today and badges the Leads tab; the
     "Crew door" tile in More becomes a look-only preview that cannot sign.

What did NOT move: everything in "Hard boundaries" and §3 — no sends beyond
R22, no email, no calendar edits beyond R18 holds, links cut, deploys manual.

## R27 — A Spanish version of the whole app for Spanish-speaking employees (Mike, 2026-10-20)

Mike, verbatim: *"The whole app needs to be able to have a Spanish version as
well for our Spanish speaking, employees"*

This is new scope, approved by Mike in his own words. Defaults Claude used
where he did not say (Mike may change any):

1. **Both apps, every screen.** The crew door and the owner app each get an
   English / Español switch, remembered per phone. Server text shown on those
   screens (briefings, quiz, work-order steps, desk findings, feed states)
   follows the same switch. English stays the default.
2. **Data is not translated.** Names, addresses, notes and anything a person
   typed stay exactly as entered — a translated note is a changed note.
3. **Customers are not part of this.** What callers hear and what customers
   are texted stay as R26 left them (detect and flag only).
4. **Legal and safety labels keep the English term beside the Spanish.**
   Permit words, STOP WORK and the 811 / Dominion / 911 lines show both
   ("PERMISO PROBABLE · PERMIT LIKELY"), because the city, the utility and
   the inspector work in English. The Spanish never says "clear" or "exempt"
   either ("libre", "exento", "no necesita permiso" are banned the same way).
5. **A person checks it before the field.** Claude's Spanish is reviewed by a
   second, independent translation pass, and safety text is back-translated.
   Before crews rely on it, a Spanish-speaking crew member reads the safety
   briefing and the quiz on a phone and says it reads right.

## R29 — The layout review answers: Direction B, and sixteen more (Mike, 2026-10-20)

*(R28, the hosted assistant, is filed with its own build.)*

Mike answered every question on the Arbo Layout Review page (his taps, read
back from the page's database on 2026-10-20). His words where he typed any:

1. **Direction B — screens named for the job.** The dock becomes Today ·
   Leads · Calendar · Estimate · Office; every hub shows live counts and every
   tap lands on the exact thing. (Yes: fold Calls into Leads as a "Calls &
   texts" segment, with a red Sona flag just as loud; split Queue into
   Follow-ups, Money, Fleet, Crew & safety, with the R26 desk name as the small
   line above each title; move Yard check into Estimate; one feeds card per
   screen that still names every dead feed, §1B; build the 15 quick fixes
   first.)
2. **Back stays as built** — the labeled ‹ Back on every screen except Today,
   dock tabs included.
3. **Spanish (R27):** address the crew as *usted*; the crew door first, the
   office app next, the long owner-only text last; a Spanish-reading crew
   member checks the briefing, quiz and work orders on a phone before crews
   rely on them — Mike's note: *"rudy or marco or temo"*.
4. **Call scripts:** a downed power line with nobody hurt keeps the **Dominion
   line only — NOT 911** (Mike chose no; his note: *"call dominion"*). A
   blocked date promise is replaced with *"Let's get you on the schedule —
   Mike will confirm the exact time."* A blocked goodbye still closes warmly
   ("Have a good one") before the call ends. Emergency detection stays
   sensitive even if "hurt the tree" sometimes alerts.
5. **Trucks:** a "Brakes or steering" checkbox on the breakdown sheet holds
   the unit in one tap; the word list stays as the backup.
6. **Leads:** tapping Good lead on an emergency counts as handling the alarm
   (built in R26, confirmed).
7. **Database:** restore the paused Supabase project. Done 2026-10-20
   (ACTIVE_HEALTHY); migration 0020 (the brake hold) applied live and checked.

**The 11 mistaken job rows (Mike, 2026-10-20: "Delete the 11").** The §3
lesson's 11 `job` rows (status booked, written 2026-08-02, dated Aug 3–4)
were still in the database. Before reading any real data, Mike chose to
delete them. A full copy was made first — `archive.job_mistaken_import_20260802`,
in its own schema with every grant revoked, verified identical row for row.
The delete removes only those 11 rows (`delete from public.job where id in
(select id from archive.job_mistaken_import_20260802);`). Supabase's tool
would not run a delete from Claude's session, so Mike runs that one line in
the Supabase SQL editor and Claude checks the counts after. His 37 leads, 26
contacts and 14 properties are untouched. Restore, if ever wanted:
`insert into public.job select * from archive.job_mistaken_import_20260802;`

## R30 — Talk: tap a button in Arbo and talk to it, no third party (Mike, 2026-10-20)

Mike, verbatim: *"i need their to be a voice feature for when im driving and
it can update me"* — offered three ways, he picked *"Talk back and forth"* —
then: *"no i want to tap a button in arbo and i can talk to it no third
party"*.

What this changes:
1. **A Talk button inside Arbo**, in the header of every screen. One tap opens
   Talk and starts it: Arbo speaks a short update, then answers questions out
   loud, hands-free, until Mike says "that's all" / "stop" / "goodbye", taps
   End, leaves Talk, or locks the phone.
2. **No third party for the voice.** The iPhone's own speech listens and
   speaks (the browser's built-in recognition and voice). No ElevenLabs, no
   Twilio, no Claude app, no connector, no new vendor or account, no new
   dependency. The thinking is Arbo's existing brain (`BRAIN_MODEL`, R5) on
   the `ANTHROPIC_API_KEY` already set — the same brain the desks use.
3. **Read-only, structurally.** `POST /api/talk` has four tools — the update,
   Sona's calls, today's stops and work orders, the trucks — each built on
   the reads the app's screens already make. None can send, book, edit, file,
   approve, sign a truck back on, or write anything; there is no tool that
   could. A feed that is cut or unreadable is named, never a zero (§1B).

Defaults Claude used where Mike did not say (he may change any):
- Arbo says customer **names** (the app already shows them, R17) but never a
  phone number, email or street address — "call back from the Arbo app".
- Every answer passes the brain's guard (no price, no promised day, permit
  words only, never "clear", no phone number, and never a claim that Arbo
  sent, booked or changed something — it cannot). A blocked answer is sent
  back to the brain once with the rule named; blocked again, it becomes "I
  can't say that one out loud". The guard was written for callers, so a few
  harmless owner questions are held back too (anything about Suffolk,
  "TCIA", a dollar figure).
- A customer's name or city reaches the brain short and plain (letters only,
  40 characters at most), so a caller's own words cannot steer what Arbo says.
- After three quiet listens in a row it stops listening ("Tap Start when you
  need me") rather than leave the mic open in the truck.
- The first listen of a launch waits up to 20 seconds for the iPhone's
  "Allow" prompt. Only a REFUSED mic switches Talk to typing for the rest of
  the launch; a mic taken by a call or Siri, or one that never opened, types
  for now and is tried again on the next Start.
- Not in Talk yet (each one more tool, on Mike's word): who is waiting on
  Mike from the R24 customer study, and R28 approvals.

Open — Mike's call, not a build's: **two things are called "Talk"**. The new
header button is this ruling. The More tile "Talk / Voice with Arbo" and
Today's "Talk to Arbo" button still open the old receptionist page (R21: off
while Sona answers calls). Renaming those (e.g. "Phone line / Arbo's
receptionist") is an R21 surface, so it waits for Mike's word.

Open — Mike's call, not a build's: whether the **installed home-screen app**
can listen on his iPhone is not something Apple has promised. If it cannot,
Talk falls back to a typing box (the keyboard's own mic still works). The
choices then are (a) use Talk from a Safari tab, or (b) one tap per question
with the keyboard mic. Field test first (docs/GO_LIVE.md §6).

What did NOT move: R21 — the ElevenLabs/Twilio links and the old `/talk`
receptionist page stay cut; Talk does not use the receptionist or its prompt.
Data links stay cut (§3, R19). Logs stay counts-and-ids (§4.3) — the log line
for a turn is counts and milliseconds, never a word said. The route sits
behind the owner key; the crew key never opens it, and with no
`APP_ACCESS_KEY` it is locked.

*Carried by:* `src/voice/ownerTalk.ts`, `src/server.ts` (`POST /api/talk`),
`src/app/index.html` (the Talk block and sheet), `src/app/sprite.svg`
(`i-mic`), `test/ownerTalk.test.ts`.

## R31 — Bouncie truck tracking, built dormant (Mike, 2026-10-20)

Mike, verbatim: *"how do i add the bouncie api keys for live tracking"*, then
*"why dont you build and then i add later"*.

1. **Truck positions for Mike only.** The Bouncie OBD trackers report where
   each truck is; Arbo shows it on the Fleet card as one line per unit in
   words (never coordinates on the card) and serves it to the coming map
   screen from one owner-only route. The crew door and the crew key never
   reach it; the policy engine already walls `tracking`/`bouncie` off every
   crew surface.
2. **Mike's own switches, all off until he acts.** `BOUNCIE_CLIENT_ID` and
   `BOUNCIE_CLIENT_SECRET` on Railway, then Settings → Connect Bouncie, then
   the webhook in Bouncie's portal with `BOUNCIE_WEBHOOK_KEY`, then
   `ARBO_LINK_BOUNCIE` exactly `live` (fail-closed, like R21). Until then an
   authentic Bouncie update is answered (so Bouncie never switches the
   webhook off) and dropped unread, counted by name in Settings.
   Steps: `docs/BOUNCIE.md`.
3. **Read only, memory only.** One sign-in (Bouncie's own approval page,
   started behind the owner key) and GET reads; the only POST is the sign-in
   token swap. Nothing is written to Bouncie and nothing goes into Arbo's
   database. The sign-in is kept on the storage disk, like Google's.

Defaults Claude used (Mike may change either): positions show around the
clock (not the office phone's 8am–8pm Mon–Sat hours); the sign-in is not
refreshed while positions are cut, so turning them on may need one Reconnect.

What did NOT move: §3 — nothing imported; R4 — sweeps read-only; §4.3 — logs
carry counts and the last 4 of a device id at most, never a place or a VIN;
agents still cannot send or spend; deploys stay manual.

*Carried by:* `src/integrations/bouncie.ts`, `src/server.ts` (the Bouncie
blocks), `src/app/index.html` (Settings card, Fleet line), `test/bouncie.test.ts`.

**Amended by Mike's spec 2026-10-20.** Mike, verbatim: *"Client ID:
`arbo-app`"*, *"Redirect URI:
`https://arbor-server-production.up.railway.app/api/bouncie/callback`"*,
*"Client Secret and API Key are being added to Railway ... as
`BOUNCIE_CLIENT_ID`, `BOUNCIE_CLIENT_SECRET`, `BOUNCIE_API_KEY`. Never
hardcode them or put them in the repo."*, then his tasks: *"Check the repo
first for any existing Bouncie code or routes ... This is an add-on, not a
rewrite."*, *"Build `GET /api/bouncie/callback`: take the authorization code,
exchange it for tokens using Bouncie's OAuth flow (check docs.bouncie.dev,
don't guess endpoints), and"* *"store the tokens server-side in Supabase"*,
*"Add a token refresh, and a read-only pull of vehicles and trips/locations."*,
*"Location data is admin-only and tracked only during working hours, per the spec."*,
and *"Run the Section 11 self-audit after these steps and report back before
deploying"*.

What this changes in R31:
1. **The callback is `/api/bouncie/callback`** — answered before the `/api`
   key gate (Bouncie's redirect carries no key; the single-use state minted
   behind the owner key is its lock). The first build's `/bouncie/callback`
   is retired: a named 410 pointing at the new address, so there is one door.
   The Client ID is `arbo-app`, read from `BOUNCIE_CLIENT_ID` only.
2. **Item 3's "nothing goes into Arbo's database. The sign-in is kept on the
   storage disk" is replaced:** the sign-in is kept in Supabase, in one table
   (`integration_credential`, migration 0021), sealed with AES-256-GCM under
   a key derived from `BOUNCIE_CLIENT_SECRET`, reached through one narrow door
   (`src/db/credentialStore.ts`) that touches that table and nothing else. It
   holds Arbo's own sign-in, not company data, so it is not one of the
   business data links — but §3 (every Supabase link cut until the app is
   built) and this spec meet there, and that is Mike's call, not the code's.
   So the door has its own switch and is CUT unless `ARBO_LINK_CREDENTIALS`
   is exactly `live`: while cut, Arbo sends nothing to Supabase for the
   sign-in and Connect refuses by name. A disk sign-in from the first build is moved in
   once, then removed from the disk. Practice mode (`ARBO_DATA_LINKS=sim`)
   opens no database, so there the disk file stays. The rotated refresh token
   is saved before the new access token is used; if Supabase will not take
   it, the old row stays and the new pair is held unused until it is saved.
3. **Trips are read too** (`GET /v1/trips`, owner-only `GET /api/fleet/trips`),
   read only, one truck and one day at a time.
4. **The default "positions show around the clock" is replaced:** positions
   and trips follow `withinWorkingHours()` — 8am–8pm, Monday to Saturday, the
   office phone's hours. Outside them Arbo reads nothing, holds nothing (a
   minute tick drops what was held, whether or not anyone asks), and
   answers Bouncie's webhook 200 while dropping the update unread. "After
   hours" is its own named state, never "no trucks".
5. **`BOUNCIE_API_KEY`** is read for presence only. Bouncie's docs name no
   separate API key, so it is never sent or shown until Mike says which
   portal field it is.

Open, for Mike, at the amendment (four of these are answered below): applying
migration 0021 live (his go only); what `BOUNCIE_API_KEY` is; whether the
day's trips may be reviewed after 8pm (built: no); whether keeping the
sign-in in Supabase while the business links stay cut is what he meant
(built: cut by its own switch until he says — setting
`ARBO_LINK_CREDENTIALS=live` is his yes, and opens that one table only).

*Carried by (amendment):* `src/db/credentialStore.ts`,
`supabase/migrations/0021_integration_credential.sql`,
`src/integrations/bouncie.ts`, `src/server.ts`, `src/env.ts`,
`src/app/index.html`, `docs/BOUNCIE.md`, `test/bouncie.test.ts`,
`test/credentialStore.test.ts`.

**Answered by Mike, 2026-10-20 (after the §11 audit).**
1. **The sign-in row.** Mike, verbatim: *"Yes, allow the sign-in row"*.
   Arbo keeps the Bouncie sign-in as one sealed row in Supabase
   (`integration_credential`) while the business data links stay cut — the
   single sanctioned exception to §3's cut (CLAUDE.md §3,
   `docs/DATA_LINKS.md`). Migration 0021 was applied live by Claude on this
   go and checked: RLS on, 0 policies, anon and authenticated have no
   SELECT, 0 rows. `ARBO_LINK_CREDENTIALS=live` is set on Railway at deploy;
   the switch still fails closed (anything but exactly `live` is CUT).
2. **`BOUNCIE_API_KEY`.** Mike's answer (not verbatim): it came from the
   portal's *Users & Devices → Authorize My Devices* — the per-user
   Authorization Code. Arbo does not need it: Connect Bouncie gets its own
   fresh code (and a browser Connect invalidates the portal one). It stays
   presence-only — a yes/no in `src/env.ts`, its value never read, sent or
   logged — and Settings says: *Not needed — Connect Bouncie gets its own
   code. You can delete BOUNCIE_API_KEY from Railway.*
3. **Keeping the sign-in alive.** Mike, verbatim: *"Keep the sign-in alive"*.
   Once a day Arbo renews the Bouncie sign-in even outside working hours
   (Sunday included), so Monday works without a Reconnect. This replaces
   R31's default "the sign-in is not refreshed while positions are cut".
   The keep-alive ONLY swaps the refresh token (`POST /oauth/token`,
   `grant_type=refresh_token`) and stores the rotated pair through the
   credential store; it reads no vehicle, trip or position, and never runs
   while `ARBO_LINK_CREDENTIALS` is cut or the sign-in is not connected. It
   reuses the single-flight refresh (rotation saved before use; a refused
   save keeps the old row), runs from the minute tick when the last renewal
   is 20 hours old or more, is named in Settings when it fails (*couldn't
   renew the sign-in at* the time it failed *— tap Reconnect if it keeps
   failing*), and is retried no more than hourly. Its log line carries the
   state only.

Also from the audit: a store cut on purpose is its own state
(`sign_in_cut`), grey like every gap by choice — never the amber of
"Arbo can't open the saved sign-in".

Still open, for Mike: whether the day's trips may be reviewed after 8pm
(built: no); whether *Last report was after hours — not shown* and the
webhook's last-arrival time may still show (`docs/BOUNCIE.md`, *Waiting on
Mike* #5 and #7).

*Carried by (answers):* `src/integrations/bouncie.ts` (`keepAlive`,
`sign_in_cut`), `src/env.ts`, `src/server.ts`, `src/app/index.html`,
`supabase/migrations/0021_integration_credential.sql` (header),
`docs/BOUNCIE.md`, `docs/DATA_LINKS.md`, `docs/GO_LIVE.md`, `CLAUDE.md` §3,
`test/bouncie.test.ts`, `test/credentialStore.test.ts`.

## R-READONLY (number assigned at merge) — Arbo and its agents may READ the data; nothing is written (Mike, 2026-10-20)

*Draft, filed with the read-only build — the number is assigned when it merges.*

Mike, verbatim: *"give arbo and its agents read only data access and run
systems checks every couple hours while you contuin to build"*.

What this changes:
1. **A third exact value for the master switch: `ARBO_DATA_LINKS=readonly`.**
   Arbo and its agents READ Mike's records through the one door with no
   `ARBO_LINK_*` variable. Exactly `readonly` — any other spelling stays CUT,
   and it can never be taken for `live`. Turning it on or off is one Railway
   variable and a manual deploy (`docs/DATA_LINKS.md`).
2. **Nothing is written, anywhere — enforced at the door, not by remembering.**
   The read-only client hands out `from` → `select` and nothing else; every
   write verb and every other client surface (rpc, schema, storage, functions,
   realtime, auth) is refused by name, and its fetch lets only GET/HEAD leave.
   A refused tap says: *"Read-only: Arbo can look but not save. Nothing was
   written."*
3. **The agents still run their sweeps** (R4: sweeps are read-only by rule)
   and say on every tick that their run log and events were not saved; their
   runs show in the app from memory, marked not saved.

Defaults Claude used where Mike did not say (Mike may change any):
- **Four links stay CUT even in read-only**, because reading them would put a
  false or misleading state on a screen: *calls* (Sona's calls live in Quo —
  empty tables would read "no calls yet", R21); *photos* (nothing files a photo
  yet); *jobs* (the 11 mistaken rows, R29 — until a count check shows the
  delete ran); *permits* (`permit_correspondence` holds rows no Arbo code
  writes — unexplained, so shut per DATA_LINKS step 3). Opening one is a
  one-line change after Mike rules.
- **A lead older than 14 days is an "older lead"**: no EMERGENCY alarm, no
  tab badge, no "Call back needed", no open loop, no Call back button, and
  Talk does not list it. It shows on Leads under its own heading with its date.
  Whether anyone is contacted is Mike's call, never Arbo's.
- The hourly sweep keeps its hourly clock; "every couple hours" is read as the
  cadence of the systems checks run while building, not a change to the app.

What did NOT move: §3 — nothing is imported; sweeps stay read-only (R4); email
never; calendar edits never (R18 holds only — the R18 hold path is Google, not
this database, and is not switched by this mode); texting only via R22 behind
`inspectMessage` (Mike's tap, or automatically only while `ARBO_OUTREACH=live`
or `ARBO_OUTREACH_CATCHUP=live`) — read-only mode does not switch it; logs stay
counts-and-ids (§4.3); the `/api` door still needs `APP_ACCESS_KEY` (read-only
real rows are never keyless); the crew door stays shut without
`CREW_ACCESS_KEY`; deploys stay manual.

*Carried by:* `src/db/client.ts` (`dataLinksReadOnly`, `canWrite`,
`readOnlyDb`), `src/db/links.ts` (`READ_ONLY_KEPT_CUT`, `ReadOnlyError`),
`src/db/notSaved.ts`, `src/ops/leadAge.ts`, `test/readOnlyMode.test.ts`,
`test/dataLinks.test.ts`.
