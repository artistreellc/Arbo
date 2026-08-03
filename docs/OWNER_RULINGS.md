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

## R5 — Opus is the brain
**Owner decision (§8A.2), re-affirmed.** Agents run on `claude-opus-5`. Do not
downgrade an agent to a cheaper model for cost reasons; that is Mike's call,
not an optimisation to make quietly.

*Carried by:* `src/agents/*` (`modelUsed`), verified in `agent_run`.

---

## R6 — AR is iOS-first: RealityKit + ARKit + LiDAR
**Ruling: 2026-08-02 (D51).** Resolves the brief's own §6B.4i vs §6T.4
conflict. Both camera tools build on Apple's stack for real depth occlusion.
Crew AR phones are iPhone 12 Pro+. The Expo/React Native surface remains the
cross-platform app for everything non-AR. Android AR waits.

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
