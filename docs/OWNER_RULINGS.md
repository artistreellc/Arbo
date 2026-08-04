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

## R12 — The crane brain is a SEPARATE APP. It is not an ARBO gap.
**Ruling: 2026-08-04.** Mike: *"crane brain is a whole other app."*

Catalog area G in `docs/origin/02_Feature_Catalog.html` lists five features
marked LOCKED IN — the crane load-plan estimator (photo → colour-coded
sections → estimated weight per section → pick-by-pick plan against the load
chart and reach), knuckle-boom support, first-pick calibration, aerial
distance measurement, and the crane load-chart database.

**They are not built in ARBO.** They were designed in the same July 31
conversation, which is why they sit in the same catalog, but they are a
different product with a different shape: image analysis, load-chart data,
and an OSHA/ANSI documentation trail that has nothing to do with reception,
scheduling, permitting, or the property twin.

**Correcting my own report.** Hours before this ruling I audited the LOCKED IN
list and called area G "the largest single gap between the brief and the
build". That framing was wrong — an out-of-scope feature is not a gap, and
calling it one puts phantom work on the board and makes the build look
further behind than it is. LOCKED IN in that catalog means "agreed in the
conversation", not "belongs in this repo".

**BUT IT INTEGRATES.** Mike, immediately after: *"that intergrates."* So
this is not "out of scope, forget it" — it is a separate build with a seam
back to ARBO, and the seam is ARBO's responsibility to keep open even though
the crane app is not built here.

What the seam is made of, stated so a future decision does not close it by
accident: ARBO already holds everything a load-plan estimator needs as INPUT
— the property twin, the tree records, the risk assessment with its
observations and geo data, the AR capture session, and the site access facts
(power lines, structures, the water-meter run). A crane app would consume
that and hand back a load plan, which lands on the ARBO side as a document
against the job, alongside the permit packet.

**The practical consequence for THIS repo:** do not build anything that makes
that handoff harder. Specifically, tree and RA data must stay
property-addressable and exportable rather than locked inside a screen, and
the job record needs to be able to carry a document reference it did not
generate itself. Both are true today. Nothing to build now; something to not
break later.

**The guardrail travels with the feature**, wherever it is built: from
`docs/origin/03_Guardrails_and_Rules.html` — *crane load plans are estimates
only, and never replace the operator's judgment or the certified load chart.*
Same never-clear discipline as the permit engine, and the same reason: the
system produces an estimate, a qualified human produces the decision.

**What this does NOT excuse.** The other two findings from that audit are
real ARBO gaps and stay open: the "go silent when Mike is on a real call"
guardrail (file 03, added because Claude talked over a live call) is absent
from the code, and the dead-time filler is LOCKED IN and absent.

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
