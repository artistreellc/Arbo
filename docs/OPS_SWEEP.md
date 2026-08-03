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

# ARBOR Ops Sweep — runbook (Phase 5: live inbox monitor + calendar sync)

Executed by a Claude session in the ARBOR ops environment on a schedule
(hourly Routine) using the environment's authorized connectors: **Gmail MCP**,
**Google Calendar MCP**, **Supabase MCP** (project `wdpyysgxmwvvoyveihum`).
This is the deploy-time substitute for in-app Google credentials (O3): same
outcomes, zero new secrets. If the sweep ever moves in-app (service account),
this document is the spec.

## Law (non-negotiable, every run)

- **§4.3 — customer PII stays in the RLS-locked DB.** Names, phones,
  addresses, emails, transcripts NEVER appear in chat output, reports,
  commit messages, or the repo. Reports carry **counts and thread/row ids
  only**.
- **Read-only outward.** The sweep NEVER sends/replies to email, never
  creates/modifies/deletes calendar events, never contacts a customer.
  Recommend-only is law (§5B) — the app surfaces what the sweep ingests.
- **Never drop, always flag.** Anything ambiguous is ingested with an honest
  flag (`status='new'` + `qualification.reviewReason`) or skipped **and
  counted as skipped** — silent drops are forbidden (§3.7).
- **Classifier rules are code** — `src/reception/leadMail.ts` and
  `src/permitting/permitMail.ts` are the authority. This document summarizes
  them; when in doubt, read the source. Never loosen a sender/subject rule
  from inside a run.
- Run the mechanical work in ONE subagent per firing to keep the ops session
  lean; the subagent returns counts only.

## Step A — Lead inbox sweep (§5A #12/#13)

1. Search Gmail (label id for `ARBOR/processed` is `Label_3`):
   `{from:ads-account-noreply@google.com from:no-reply@callrail.com from:localservices-noreply@google.com from:awexpress.google.com from:homeadvisor.com from:angi.com from:angieslist.com from:messaging.yelp.com from:formsubmit.co} newer_than:2d -label:Label_3`

   > **2026-08-03 — Angi domains were missing from this query.** The
   > classifier gated `angi.com` / `angieslist.com` while the SEARCH never
   > fetched them, so the gate could never fire on real Angi mail. Harmless
   > only because the channel is off; the day Mike switches it on, Angi
   > leads would have been invisible. Both domains are in the query above
   > now. Caught by the 15:21Z sweep, not by a test.

   > **SPAM IS NOT VISIBLE THROUGH THIS CONNECTOR.** `in:spam`, `label:spam`
   > and `in:anywhere` all return nothing. A lead that Google files as spam
   > is invisible to every sweep. Do NOT report spam as "nothing relevant" —
   > report it as UNVERIFIABLE. §1B: "we cannot see it" and "there is
   > nothing there" are different facts.

   > **Cadence: every 5 minutes** (Mike, 2026-08-03), not hourly. The website
   > form is the reason — a homeowner who fills it in is shopping, and an hour
   > of silence is an hour a competitor answers first. The window stays 2 days;
   > only the firing interval changed.

   > **2026-08-02 — this query used to miss real leads.** LSA does NOT send
   > from `localservices-noreply@`; every LSA lead arrives from a per-lead
   > address `customer-request-<digits>@awexpress.google.com`, so the sweep
   > never saw one. The CallRail WEB FORM alert has its own subject line and
   > had no rule at all. Both are covered below. If a sender appears that
   > matches no rule here, it is NOT a non-lead — leave it unlabeled and
   > report it, exactly as the run that caught this one did.
2. Classify each thread by sender + subject (leadMail.ts rules):
   - `ads-account-noreply@google.com` + subject `Lead form response received`
     → **google_ads_lead_form**. Read body; extract labeled plaintext fields
     (`First name`/`Last name`/`Phone number`/`City`/`Street address`/`Brief
     description…`/`Campaign`).
   - `no-reply@callrail.com` + subject `Call/Voicemail/Missed call/Abandoned
     call/TXT from … via <TRACKER> for Art-is-Tree` → **callrail** event.

     > **2026-08-03 — four of these five matched nothing in code.** The gate
     > was `/^Call from .+/` alone. A real caller rang and then texted; both
     > mails ("Abandoned call from …", "TXT from …") fell through to
     > NOT_A_LEAD, silently, exactly like marketing. Fixed: `CALLRAIL_EVENT`
     > in leadMail.ts now matches all five, and each sets
     > `lead.kind` ∈ call / voicemail / missed / abandoned / text.
     >
     > `kind` was ALSO never set before. `src/server.ts` and
     > `src/server/api.ts` both compute `needsCallback` from
     > `qualification.kind` ∈ missed / abandoned / voicemail — so the callback
     > flag built for an abandoned call could never fire. It can now. When
     > ingest resumes, write `kind` into `qualification` and map
     > `kind === 'text'` → lead `source: 'text'`, everything else → `'call'`.
     Tracker (TSP/TLT/…) = Mike's source tag; name+phone from subject/body;
     `New Caller` vs `Nth call` = first-timer signal. Subject `TXT from …` →
     source `text`.
   - `no-reply@callrail.com` + subject `Form Submission Alert for Art-is-Tree`
     → **callrail_web_form** (a WEB FORM, not a call). Plaintext body uses
     DOUBLE colons: `Name::` / `Email::` / `Phone Number::` / `Zip Code::` /
     `Service Requested::`. The street address is jammed into the service
     field as `<scope> / Address: <street>` — split it. The form carries NO
     city: resolve it from the ZIP (`serviceCityForZip`). An unrecognized ZIP
     is a REVIEW flag, never a silent drop; an absent ZIP is UNKNOWN.
   - `customer-request-<digits>@awexpress.google.com` (or the legacy
     `localservices-noreply@google.com`) + subject containing `Potential
     Customer` → **lsa**. The customer's hand-typed words sit between the
     headline and `To connect with this customer` and routinely carry the
     budget, name, street, and phone — KEEP the whole block as details, it is
     the most valuable thing in the mail. A line starting with digits is only
     an address if it ends in a real street suffix ("1000 works if possible"
     is a budget, not a street). LSA gives no city on the wire, so
     `inServiceArea` stays UNKNOWN unless a ZIP resolves it.
   - `newlead@homeadvisor.com` / `@angi.com` / `@angieslist.com` + subject
     `New Opportunity: <service>` → **home_advisor — CHANNEL OFF.**

     > **Mike, 2026-08-03:** *"Not worried about Angi or homeadivsor we are
     > not going after them currently so don't add them to Arbo I'll let you
     > know when as we use them seasonally"*. HomeAdvisor and Angi are the
     > same company, so both domains are gated.
     >
     > The classifier still RECOGNISES these and returns
     > `channelOff: 'home_advisor'`. Report them as a single suppressed
     > count — "N HomeAdvisor/Angi, channel off" — never as leads and never
     > as nothing (§3.7). Off is a stated fact, not a blind spot. Flip
     > `SEASONAL_CHANNELS_OFF` in leadMail.ts when Mike says the season is on.

     The dormant parser, for when it comes back on, carries service, city and
     HomeAdvisor's own lead number —
     but NO name or phone (those are behind "View all details" in their app),
     so the row points Mike there instead of pretending to hold contact
     details. Other `@homeadvisor.com` senders are marketing → not a lead.
   - `reply+<token>@messaging.yelp.com` + subject `Message from <name> for
     Art-Is-Tree` → **yelp**. Per-thread sender, so match the DOMAIN. Body has
     `Job Requested` and `Postal Code`; replying happens inside Yelp, so there
     is no phone. Yelp routinely sends non-tree requests — the classifier sets
     `serviceOffScope` and the row is FLAGGED for review, never booked as tree
     work and never dropped.
   - Weekly/monthly summaries, "recommendations auto-applied", any
     `learn@callrail.com` marketing → **not a lead**. Label processed, no row.

   - `submissions@formsubmit.co` + subject `New estimate request from <name>
     — <service>` → **website_form**. The WEBSITE CONTACT PAGE, handled since
     Mike's 2026-08-03 instruction: *"Arbo can address the form submitted on
     website via Gmail access no need for site"*. R7 still stands — nothing
     here touches the site, the DNS, or the form endpoint; the rule reads the
     notification FormSubmit already sends to the inbox.

     > **THIS MAIL IS HTML-ONLY — there is NO plaintext part.** Verified on
     > the real messages 2026-08-03. Feeding `plaintextBody` to the parser
     > yields an EMPTY body and therefore a lead row with no name, no phone
     > and no address — a real customer stored as a blank. For this sender
     > pass the **htmlBody**; `parseWebsiteForm` reads the HTML table.

     Fields sit in a `<tr><td><strong>KEY</strong></td><td><pre>VALUE</pre>`
     table: `name` / `phone` / `email` / `address` / `serviceNeeded` /
     `urgency` / `message`. Entities are HTML-encoded (`&#039;`) and the
     parser decodes them. The form carries **no city, state or ZIP** — the
     address is a bare street line — so `inServiceArea` stays UNKNOWN, never
     false. A form with no city is not an out-of-area form.
3. Ingest (Supabase `execute_sql`, parameter-safe quoting):
   - Contact: match `select id from contact where phones @> array['<E164ish>']`;
     else insert (`name`, `phones`, `consent_source` = `'inbound_call'` for
     calls/texts or `'lead_form'` for forms, `consent_at = now()`,
     `is_first_timer` from the New-Caller signal when known).
   - Lead dedupe: skip if `select 1 from lead where qualification->>'gmailThread' = '<threadId>'`.
   - Insert lead: `source` ∈ `call` (calls/voicemails/LSA calls), `text`
     (TXT), `other` (web/lead forms); `details` = short human line (tracker,
     duration, form description); `qualification` jsonb MUST include
     `{"gmailThread":"<id>","provider":"<provider>","receivedAt":"<email ISO timestamp>"}`
     plus extracted facts; `status='new'`; **`created_at` MUST be set to the
     email's real received time (`receivedAt`), never left to default** — the
     app shows created_at as "when the customer reached out," and a backfilled
     batch that all reads "today" misleads Mike (fixed once by hand
     2026-08-02; this rule keeps it fixed).
   - **Out-of-area / spam-shaped lead forms** (city that doesn't resolve to
     VB/Norfolk/Chesapeake/Portsmouth): still insert, `status='new'`,
     `qualification.reviewReason='out_of_area_form'` — flagged, never
     silently dropped, never auto-qualified.
   - Property: only when a street address parses confidently to a service
     city — use the same normalization law as the app (unique
     `normalized_address`); when unsure, leave `property_id` null. Never
     store an out-of-area property (DB CHECK will refuse; that refusal is
     correct — catch it and leave the lead property-less).
4. Label every classified thread `ARBOR/processed` (Label_3) — leads AND
   non-leads — so the next run's query excludes them.

## Step B — City/permit mail sweep (§5A #35)

1. Search: `{from:vbgov.com from:norfolk.gov from:cityofchesapeake.net from:portsmouthva.gov} newer_than:2d -label:Label_3`
2. Classify per permitMail.ts: domain → city; Accela refs
   (`YYYY-DSC-######`, `YYYY-UTIL-#####`, `J##-######-RPA`); kind ∈
   ppr_review / cbpa_case / intake_request / duplicate_warning / payment /
   other_city_mail.
3. Dedupe on `gmail_thread_id`; insert into `permit_correspondence`
   (city, kind, case_ref, subject, address_text, gmail_thread_id,
   received_at). Label processed.

## Step C — Calendar → schedule sync (O3 outcome)

1. List the primary Google Calendar's events, window **now → +14 days**.
2. Skip: colorId `11` (payment reminders — Mike's convention, D21/D34),
   all-day events with no address, anything already synced.
3. For each event: address from location/title/description; parse city; ONLY
   proceed when it resolves to a service city — otherwise count as skipped.
   Kind: title containing estimate/est/quote/look → `estimate`; else `job`.
4. Upsert keyed on `calendar_event_id` (both tables have the column):
   - estimate: `scheduled_slot` = event start; property via
     address-normalized upsert; contact by name/phone when present in the
     event text.
   - job: `scheduled_for` = event start; `status='booked'`; `color_code` =
     event colorId.
   Update the stored start time when the event moved. NEVER delete rows for
   vanished events — flag counts in the report instead (a calendar read
   failure must not wipe the schedule).

## Report format (end of every run)

One short block, counts only, e.g.:
`sweep: 12 threads (7 leads in, 2 flagged out-of-area, 3 non-lead), 0 city
mails, calendar: 5 upserts (3 est / 2 job), 2 skipped (no address). Errors: none.`
If a step fails, say which and why (no PII) — a failed step is reported,
never papered over.
