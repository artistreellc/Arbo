# Railway security incident, 2026-10-21: what Arbo had there and what to rotate

**Names only. No value of any key is written here, in chat or in a log.**

## What happened (from Railway's own pages, read 2026-10-22 ~01:30 UTC)

- Mike received "Urgent: Railway Security Disclosure – Rotate Credentials"
  (2026-10-21, 9:08 PM ET).
- The notice was checked against Railway's status page, status.railway.com,
  read directly rather than through the email's links. Its log:
  - 21:59 UTC: Railway says it detected anomalous activity on systems that
    store customer environment variables. Some may have been decrypted.
  - Railway's advice is to revoke and reissue **every** environment variable
    stored in Railway and to review service logs.
  - Railway says it asked AI providers to revoke keys proactively.
  - Builds and deploys are paused platform-wide. New variables cannot take
    effect until builds return.
- Railway's guides list: <https://blog.railway.com/p/security-disclosure-wednesday-october-21st>

## What Arbo's own checks found (read-only, 2026-10-22)

- **Supabase API logs, last 48 hours** (2026-10-20 01:30 → 2026-10-22 01:29 UTC):
  - 725 requests in total.
  - **Every one** came from a single address on Railway's network, using
    Arbo's own service-role key with user agent `node`.
  - **All were GETs.** That matches Arbo's read-only mode.
  - No other address used the key. Postgres logs show only routine checkpoints.
  - Supabase keeps no older logs here, so this does not cover what happened
    before 2026-10-20.
- **GitHub (artistreellc/Arbo):**
  - Every commit since 2026-10-20 is by Claude or Mike.
  - Every branch is one Arbo made.
  - Webhooks and deploy keys could not be read from this sandbox, because
    the proxy refuses that API path. Mike checks those himself (step 8).
- **Railway:** the connector is signed out, so neither deploy logs nor
  variables could be read. Variables are never read from here anyway.

## What Arbo keeps in Railway (from `src/env.ts` and `.env.example`)

Not every name below is set in production. Rotate the ones that are.

| # | Variable(s) | What someone could do with it | Where to rotate it |
|---|---|---|---|
| 1 | `ANTHROPIC_API_KEY` | Run AI on Mike's bill. With the same key: start the hosted assistant's sessions, whose vault holds Gmail/Quo access | console.anthropic.com → API keys: revoke, create new; check Usage for unexpected spend |
| 2 | `SUPABASE_SERVICE_ROLE_KEY` (a legacy JWT), `SUPABASE_ANON_KEY` | Read and write **every** table, customer records included (bypasses RLS) | Supabase → Project Settings → API Keys: create a new **secret** key (`sb_secret_…`, which `env.ts` accepts), then **disable the legacy JWT keys** |
| 3 | `QUO_API_KEY` | Read every call and text; send texts as the business line | Quo → Settings → API: delete the key, create a new one |
| 4 | `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` | Read Mike's mail (what the token was granted) | myaccount.google.com → Security → Third-party access: remove Arbo. Google Cloud → APIs & Services → Credentials → the OAuth client: reset the secret. Then the read-only reconnect (GO_LIVE §8) |
| 5 | `GOOGLE_PRIVATE_KEY` (+ `GOOGLE_CLIENT_EMAIL`) | Act as the service account (Drive/Calendar it was shared) | Google Cloud → IAM → Service accounts → Keys: delete the old key, add a new one |
| 6 | `GOOGLE_MAPS_API_KEY`, `TOMTOM_API_KEY` | Spend map quota | Google Cloud → Credentials: regenerate the key (and restrict it); developer.tomtom.com: new key |
| 7 | `TWILIO_AUTH_TOKEN` (+ `TWILIO_ACCOUNT_SID`) | Send texts and calls on the Twilio account (number retired by R36, account still live) | Twilio Console → API keys & tokens: create a secondary token, promote it |
| 8 | `ELEVENLABS_API_KEY`, `ELEVENLABS_BRIDGE_SECRET`, `ELEVENLABS_POSTCALL_SECRET` | Spend voice credits; forge calls into Arbo's webhooks | elevenlabs.io → API keys: new key. The two secrets: new values in Railway **and** in the ElevenLabs agent's webhook settings |
| 9 | `VAPI_API_KEY` (legacy) | Vapi account use | Vapi dashboard: delete the key (Arbo doesn't need it) |
| 10 | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Read sent form mail. A key with send rights could also send as the domain | **Careful, CLAUDE.md hard boundary.** Check first whether this is the same key the **website** sends with. If it is, rotating it stops the site's form mail until the site gets the new key. That is Mike's call with whoever runs the site. Arbo never touches Resend itself |
| 11 | `APP_ACCESS_KEY`, `CREW_ACCESS_KEY` | Open Arbo's owner app or crew door | Make a new long random value for each (a password manager can generate one). Enter the new owner key on Mike's phone after the deploy |
| 12 | `TWILIO_SMS_WEBHOOK_KEY`, `RAILWAY_WEBHOOK_KEY`, `BOUNCIE_WEBHOOK_KEY` | Post fake events into Arbo | New random values in Railway **and** where each is pasted: Mike's iPhone text relay, the Railway webhook, Bouncie's portal |
| 13 | `BOUNCIE_CLIENT_SECRET`, `BOUNCIE_API_KEY` | Bouncie is dormant (keys_missing) | If either was ever set, rotate it in the Bouncie portal. If not, nothing to do |

**Not secret, nothing to rotate:** `SUPABASE_URL`, the `ARBO_*` switches,
`APP_NAME`, `NODE_ENV`, `GOOGLE_PROJECT_ID`, `GMAIL_OAUTH_CLIENT_ID`,
`TWILIO_ACCOUNT_SID`, `TWILIO_PHONE_NUMBER`, `BOUNCIE_CLIENT_ID`,
`ARBOR_DRIVE_ROOT_FOLDER_ID` and the `ARBO_AGENT_*` ids.

**Exposed but not rotatable:** these carry phone numbers and a ZIP. Note them;
there is nothing to reissue.
- `OWNER_ALERT_PHONE` and `OWNER_HOME_ZIP` (Mike's own number and ZIP).
- `ARBO_AGENT_CREW_NUMBERS` (crew phones).

**Also held on Railway, outside the variables:**
- **The `/data` volume** (`ARBO_SECRET_DIR`) holds the Google token from the
  in-app reconnect and Bouncie's sealed tokens. Removing Arbo at Google
  (row 4) kills that token.
- **The private deploy config** (`private/deploy.config.json`, D46) may carry
  a copy of the Supabase key. Revoking the key (row 2) makes that copy useless.

## Order for Mike (on the phone, now — none of this needs builds)

1. Anthropic key: revoke it, and look at Usage for spend you don't recognise.
2. Supabase: make the new secret key, then disable the legacy keys.
   - Arbo then reads nothing until the redeploy. That is the safe direction:
     it shows named gaps, not a confident zero.
3. Quo key.
4. Google:
   - remove Arbo from your account's third-party access;
   - reset the OAuth client secret;
   - delete the service-account key;
   - regenerate the Maps key.
5. Twilio token, ElevenLabs key, Vapi key, TomTom key (if set).
6. Resend: only after checking it isn't the website's key (row 10).
7. Keep every new value in your password manager. **Do not paste any of them
   into chat.**
8. GitHub → Settings → Security log and Applications: look for anything you
   didn't do since 2026-10-20. Check the repo's Settings → Webhooks and Deploy
   keys too.
9. Re-authorize the Railway connector for Claude when Railway's dashboard is
   back. Its old sign-in was invalidated in the incident.

## When Railway builds are back (Claude)

1. Mike puts every new value into Railway's variables himself. Claude never
   reads them.
2. Claude deploys main by **full SHA**, then checks:
   - `git_ref` matches;
   - `db READ-ONLY (ARBO_DATA_LINKS=readonly)` and `quo wired READ-ONLY` appear;
   - the access-door line;
   - `snapshotId: null`.
3. Claude re-reads the Supabase API logs to confirm only the new key is in use
   and the legacy key has stopped.
4. Mike enters the new `APP_ACCESS_KEY` on his phone once. Re-pairing:
   - crew phones re-enter the new crew key;
   - the iPhone text relay gets the new webhook key.
