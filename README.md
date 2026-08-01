# Arbo — Tree Service CRM

Arbo is a standalone, AI-powered CRM command center for a tree service business.
It is the destination every lead flows into — website form, AI receptionist,
Gmail, phone — and the board every job moves across, from first call to paid.

It began as "Phase 1" built inside the marketing site (`art-is-tree`); this repo
is that foundation lifted into its own app, plus the next four roadmap items:
**real authentication, Gmail sync, email notifications, and Google Calendar
sync.**

---

## What's built

| Area | Status | Where |
|---|---|---|
| **Lead Inbox** — every inquiry from every channel in one triage list | ✅ | `/inbox` |
| **Job Pipeline** — lead → estimate → scheduled → done → paid, Kanban board | ✅ | `/pipeline` |
| **Job detail** — editable job, contact card, activity timeline, call/note logging | ✅ | `/jobs/:id` |
| **Dashboard** — new leads, open jobs, pipeline value, emergency alerts | ✅ | `/` |
| **AI Receptionist** — Claude-powered front desk that captures leads, tuned to your rules | ✅ | `/settings` + `/api/crm/receptionist` |
| **Real authentication** — Supabase Auth (per-user login), JWT-verified API, admin allowlist | ✅ | `/login` |
| **Email notifications** — emails you the moment a new/emergency lead lands (Resend) | ✅ | `api/crm/_notify.js` |
| **Gmail sync** — scheduled import of inquiry emails as leads, deduped & labeled | ✅ | `api/crm/sync/gmail.js` |
| **Google Calendar sync** — estimates & scheduled jobs pushed to your calendar | ✅ | `api/crm/sync/calendar.js` |
| **Business phone (calls/SMS) logging** | 🔜 Next | schema + `source: phone` ready |

---

## Architecture

```
Browser (React SPA, Vite)
   │   Supabase Auth session → Authorization: Bearer <user JWT>
   ▼
/api/crm/* (Vercel serverless functions)     ← hold the SERVICE ROLE key
   │   verify JWT + admin allowlist
   ├─► Supabase Postgres (crm_* tables, RLS on — service role only)
   ├─► Resend            (new-lead email notifications)
   └─► Google APIs       (Gmail import + Calendar events)
```

**Why the API layer:** the browser never gets the database service key, and the
public anon key has **zero** access to CRM tables (RLS on, no anon policy). All
customer PII flows through server functions only. The browser's anon key is used
solely for authentication.

### Endpoints
- `GET/PATCH/POST /api/crm/leads` — inbox list, status updates, convert-to-job
- `GET/POST/PATCH /api/crm/jobs` — pipeline board + job detail (auto-syncs Calendar on schedule)
- `POST/DELETE /api/crm/appointments` — estimates/jobs, mirrored to Google Calendar
- `POST /api/crm/activities` — log notes/calls/emails on the timeline
- `GET/PATCH /api/crm/settings` — business info + receptionist persona
- `GET /api/crm/integrations` — which optional integrations are connected
- `POST /api/crm/sync/gmail` — import inquiry emails (cron + manual)
- `POST /api/crm/sync/calendar` — reconcile un-synced appointments (cron + manual)
- `POST /api/crm/intake` — **public** universal lead capture (website, etc.)
- `POST /api/crm/receptionist` — **public** AI receptionist chat + auto-capture

---

## Setup

### 1. Database
Run the migrations in `supabase/migrations/` against your Supabase project
(Dashboard → SQL Editor, or `supabase db push`):
- `0001_crm_schema.sql` — contacts, leads, jobs, activities, appointments, settings; RLS on.
- `0002_admins.sql` — the `crm_admins` allowlist (seeded with the owner email).

### 2. Create your login
In Supabase → **Authentication → Users**, add yourself (email + password). Make
sure that email is in `CRM_ADMIN_EMAILS` **or** the `crm_admins` table.

### 3. Environment variables
Copy `.env.example` → `.env` for local dev, and set the same keys in
**Vercel → Settings → Environment Variables**. The essentials:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Browser auth client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server DB access (never prefix `VITE_`) |
| `CRM_ADMIN_EMAILS` | Comma-separated admin allowlist |
| `ANTHROPIC_API_KEY` | AI receptionist (optional) |
| `RESEND_API_KEY`, `NOTIFY_FROM`, `NOTIFY_TO`, `APP_URL` | Email notifications (optional) |
| `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REFRESH_TOKEN` | Gmail + Calendar sync (optional) |
| `CRON_SECRET` | Protects the scheduled sync endpoints |

Every optional integration **degrades gracefully** — the app runs fine with only
the Supabase keys set; unconfigured integrations simply show "Not connected."

### 4. Local dev & deploy
```bash
npm install
npm run dev      # Vite dev server on :3000 (API functions run on Vercel)
npm run build    # production build → dist/
```
Deploy to Vercel (`framework: vite`). The `vercel.json` wires SPA routing and two
cron jobs (Gmail every 15 min, Calendar reconcile hourly).

> **Cron & plan note:** sub-daily cron schedules require a Vercel **Pro** plan;
> on Hobby, crons run once per day. You can always trigger a Gmail import
> manually from **Settings → Sync now** regardless of plan.

---

## The integrations, in detail

### Real authentication
The Phase-1 shared-token gate is gone. The browser signs in with Supabase Auth;
every admin API call carries the user's JWT, which the serverless functions
verify with Supabase and check against the admin allowlist (`CRM_ADMIN_EMAILS`
∪ `crm_admins`). If neither allowlist is configured, the API **fails closed**.

### Email notifications (Resend)
`captureLead()` fires a best-effort email on every new lead — with a 🚨 EMERGENCY
subject when the lead is urgent — to the address in **Settings → Notify new leads
to** (falling back to `NOTIFY_TO`). No Resend key? Intake still works; no email
is sent.

### Gmail sync
`GET/POST /api/crm/sync/gmail` (Vercel Cron, or **Settings → Sync now**) runs a
Gmail search (`GMAIL_QUERY`) over the business inbox, captures each message as a
`source: gmail` lead, dedupes by Gmail message id, and applies a processed label
so nothing is imported twice. Uses one Google OAuth refresh token — no SDK.

### Google Calendar sync
Creating an appointment (from a job's detail page) or moving a job into a
scheduling stage with a date pushes a Google Calendar event and stores its
`google_event_id` on the appointment. `sync/calendar` is the safety net that
retries anything still pending/failed.

---

## Roadmap (what's next)

1. **Business phone.** Route the number through a provider (e.g. Twilio) so
   calls/texts log as `crm_activities` and missed calls create `source: phone`
   leads. Optionally connect the receptionist to voice (Vapi/Retell).
2. **Receptionist → live web widget & after-hours SMS**, using the same endpoint.
3. **Two-way Calendar sync** — drag-to-reschedule in Google reflects back into
   the pipeline.

Each is an additive layer on the inbox, pipeline, schema, and receptionist brain
already in place.
