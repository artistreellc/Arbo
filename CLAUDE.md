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
