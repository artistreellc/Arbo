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

# ARBO — read this before you touch anything

Arbo is Mike Campbell's AI reception & ops platform for Art-is-Tree LLC
(Virginia Beach / Norfolk / Chesapeake / Portsmouth). Mike owns it. He writes
the prompts and makes the calls; your job is to build.

## Read these first, in this order

1. **`docs/OWNER_RULINGS.md`** — things that look like bugs and are not.
   Every one was a real correction. **Do not "fix" them.**
2. `DECISIONS.md` — the full decision log (D1…), newest at the bottom.
3. `docs/ARBO_SPEC.md`, `docs/GAMEPLAN.md` — what this is and where it's going.
4. `docs/OPS_SWEEP.md` — the ops runbook. Its Law section is binding.

## Hard boundaries — these have burned before

- **Do not touch the website, Resend, or anything SEO-adjacent.** Mike's
  rankings are a live business asset and are not in scope. A change that
  *implies* reconfiguring the site (e.g. wiring a website form channel) is
  also out of scope. This is why the FormSubmit work was reverted.
- **Do not ingest or store leads.** Mike handles them. Scheduled sweeps are
  READ-ONLY: scan, report issues, write nothing — no lead rows, no Gmail
  labels, no calendar edits. (Ruling R4.)
- **Never modify calendar events. Never send email.** Ever.
- **No customer PII in chat output or logs** — counts and ids only (§4.3).
- **Deploy is manual.** Auto-deploy stays OFF.

## §3 — The data links are CUT. Do not reconnect them.

**Owner instruction, 2026-08-03.** Mike: *"there should be no data in the app
yet as its not done"* and *"no one said delete just cut all data links to the
app till we finish the rough build."*

**The switch:** `ARBO_DATA_LINKS` must be **exactly `live`**. Anything else —
unset, empty, `off`, `true`, `LIVE`, a trailing space — leaves the link CUT.
It fails closed on purpose: the expensive failure is an unfinished app quietly
touching live customer data, not a screen saying it cannot see. Two doors
enforce it — `hasDb()` gates every handler and repository, and `getDb()`
refuses on its own, so a caller that forgets to check still cannot reach a
real table. The agent scheduler gates on `hasDb()`, so the same switch stops
the timed sweeps. *Carried by:* `src/db/client.ts`, `test/dataLinks.test.ts`.

**Nothing was deleted, and nothing should be.** Mike said cut, not delete. His
rows are still in Supabase, untouched. Do not "clean them up".

**Why this exists — my mistake, written down so it is not repeated.** I
ingested Mike's leads into the app. He told me to stop. I reverted the *code*
and never checked the *rows it had already written*, so 11 of his leads sat in
the `job` table for a day, status `booked` — which the crew door renders as
work orders. Reverting a writer does not unwrite what it wrote. **When you
turn something off, go and look at what it already did.**

**Use simulations instead.** `src/dev/seed.ts` writes obviously-fake records
(`SIM-` names, `555-01xx` numbers, streets that do not exist) so no screen
ever needs a real customer to have something to render. It refuses on a
non-empty database, because a seed that merges into live rows makes simulated
and real indistinguishable.

**To reconnect:** only when Mike says the rough build is done. Set
`ARBO_DATA_LINKS=live`. That is his call, not an optimisation to make quietly.

## Guardrails that live in code, not prose

Never price · never diagnose · never promise a date · never claim a credential
the company doesn't hold · TCPA consent + permanent STOP + 8am–9pm ET quiet
hours · permit vocabulary is PERMIT LIKELY / REVIEW NEEDED / NO OVERLAY–VERIFY
and **never "you're clear"** · agents cannot spend money or send anything.

**§1B is the spine of this codebase:** a dead feed is NAMED, never rendered as
a confident zero. "We couldn't read it" and "there's nothing there" are
different facts and must never render the same. Most defects found in review
have been a violation of exactly this.

## How to work

Every cycle: **tests first → `npm run check` → adversarial review of your own
diff → fix what's confirmed → screenshots before ship → commit → push →
deploy by full SHA → verify.** Mike has asked for this repeatedly; skipping
the review step is how holes get left.

**Two speeds, and pick the right one (owner instruction, 2026-08-03).**

- **Complex code: three lines, then stop and reread them.** Not at the end of
  the file — every three lines. Read what you just wrote and ask the audit
  question: does this already exist somewhere, does it break anything below
  it, is it the pattern this codebase already uses, and am I about to cause
  one of the issues that keep happening? Mike's words: *"just making sure
  your not causing these issues anymore."* This is where the defects come
  from, so this is where the brakes go.
- **Easy, non-complex sections: go fast.** Wiring, plumbing, boilerplate,
  copy, a route that mirrors four others — speed up. He does not want the
  brakes on the parts that cannot hurt him.

The recurring defect this catches: writing a fix, claiming it in the commit
message, and never rereading to confirm it actually took. That has now
happened twice (the library composer, then the fleet composer).

- Ask before *rejecting* something rather than flagging it. Three rules
  inferred from the brief turned out narrower than how Mike actually runs the
  business (lead dates, the LSA sender, Suffolk). Flagging is cheap; silently
  binning real work is not.
- Simplicity over cleverness. "Why do you make everything insanely
  complicated" is a direct quote. The calendar is an iframe for this reason.

## Deploying (Railway)

Project `d3ebeebe-1acd-4af7-a1c8-d88ba7d7e155` · service
`11ddf5d4-34f2-4123-8791-10cf4ecfdbf2` · env
`4e98f38f-090a-4db4-af5a-fd57d7c15902`.

Deploy by **FULL SHA** via `railway-agent`. The agent call often times out at
60s even when the deploy succeeds — do not retry blindly, read
`list-deployments` instead.

**Then verify all three:**
1. build log `git_ref` matches your SHA,
2. `db connected` in the deploy log,
3. the live deployment has **`snapshotId: null`**.

A provenance-less *snapshot* deployment has raced and won twice. A green
status alone does not prove what is running.

Outbound curl to `arbor-server-production.up.railway.app` is 403'd from the
sandbox — verify through Railway logs and Supabase, not curl.

## Stack

Node/TS, `node:http` (zero frameworks), Supabase Postgres (service role),
Railway, vitest, Playwright for screenshots. Migrations in
`supabase/migrations/` — apply them live via the Supabase MCP AND commit the
`.sql` file. Agents run on `claude-opus-5`; do not downgrade for cost.
