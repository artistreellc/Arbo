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
   `{from:ads-account-noreply@google.com from:no-reply@callrail.com from:localservices-noreply@google.com from:awexpress.google.com from:homeadvisor.com from:messaging.yelp.com from:formsubmit.co} newer_than:2d -label:Label_3`

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
   - `newlead@homeadvisor.com` + subject `New Opportunity: <service>` →
     **home_advisor**. Carries service, city, and HomeAdvisor's lead number —
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

   > **Still unhandled as of 2026-08-02:** FormSubmit
   > (`submissions@formsubmit.co`, "New estimate request from …") — the
   > website contact page. Leave unlabeled and report until a rule exists.
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
