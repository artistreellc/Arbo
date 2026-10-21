# PHONE SETUP — how calls and texts actually flow (as of 2026-10-20)

This is the live configuration Mike set up by phone on 2026-09-24 (R19, R20,
D73–D75). If you change any piece of it, change this file in the same PR.
**No secrets live here** — keys are Railway variables, named below.

**Since 2026-10-20 Quo is connected READ-ONLY (R33).** Mike: *"connect quo as
read only"*. Arbo reads Quo and writes nothing to it: no text (R22 is paused),
no webhook created, replaced or deleted. Arbo's Google sign-in is read-only
too, so no calendar hold is filed for a Sona call (R18 is paused). Details in
"Quo read-only (R33)" below.

## The numbers

| Number | What it is | Who answers |
|---|---|---|
| **757-319-5131** | Art-is-Tree's business line — Mike's iPhone, **T-Mobile**. The public number. Stays on T-Mobile: Mike ruled *"i dont want to port the number"*. | Mike. Unanswered calls forward to Quo after 20 s. |
| **757-606-9432** | Quo number ("Art-is-Tree LLC"), inbox `PN70xPKd5p`. | **Sona**, Quo's AI (R20: *"let sona handle it for a while while arbo learns from it"*). |
| 757-821-6983 | Arbo's own line (Twilio → ElevenLabs → Arbo's guarded Opus brain). **Retired by R36** — the Quo number is the one Arbo works through. | **Nobody — links CUT (R21), not coming back (R36).** Still rented in Twilio; releasing it is Mike's call, never Arbo's. Nothing deleted. |

Never change the public number anywhere — Google, the website, and SEO are
out of scope (CLAUDE.md hard boundary). Quo sits *behind* 757-319-5131.

## Twilio + ElevenLabs links — CUT (R21)

Mike: *"disconnect the twilio and eleven labs links while we develop off
sona"*. Cut in code, not deleted. Doors refused with 503 `link_cut`: the
voice bridge `/voice/llm`, `/webhooks/elevenlabs`,
the Phone line page (`/talk`), the spoken brief, `/webhooks/twilio/sms`.
Boot log: `[links] CUT while Sona handles calls (R21): elevenlabs, twilio`.
(The Phone line page was "Talk to Arbo" until Mike renamed it on 2026-10-20;
"Talk" now means only the R30 button in the app's header.)

To reconnect (Mike's call only): set `ARBO_LINK_ELEVENLABS=live` and/or
`ARBO_LINK_TWILIO=live` on Railway, redeploy by full SHA.

## Missed calls → Sona (T-Mobile conditional forwarding)

Dialed once from the business iPhone. It is a carrier setting, not code.

| Code | Effect |
|---|---|
| `**61*17576069432*11*20#` | **ON (what Mike dialed, confirmed working):** forward unanswered calls to Quo after **20 s** of ringing. |
| `*#61#` | Check whether it is on. |
| `##61#` | Turn it off. |
| `**67*17576069432*11#` | *(not set)* also forward when busy / declined. |
| `**62*17576069432*11#` | *(not set)* also forward when the phone is off / no signal. |

The `11` (voice service) is required on T-Mobile — the short form without it
(`**61*…**20#`) returned an error. Declined calls and phone-off calls still
go to T-Mobile voicemail until the two optional codes are dialed.

## Sona → Arbo (automatic, R20 / D75)

- At every boot Arbo looks up its own Quo webhooks (messages, calls,
  call-summaries, call-transcripts) at `https://$RAILWAY_PUBLIC_DOMAIN/webhooks/quo`
  using **`QUO_API_KEY`** (Railway). **Read-only (R33):** it uses the hooks
  Quo already has, exactly as they are, and learns their signing keys — it
  never creates, replaces or deletes one. A missing hook (or one whose key
  Quo won't show) is named on the Sona panel and in Settings as *"Quo webhook
  missing — Arbo is read-only and won't create it; texts and calls are read
  from Quo's record instead"*, never as a failure. Boot log proof:
  `[quo] wired READ-ONLY — created 0, reused N, missing N, failed 0, 1 number(s)`.
  (Before R33, and again only if Mike sets `ARBO_QUO_SEND=live`, Arbo created
  any missing hook itself: `[quo] wired — created N, reused N, …`.)
  What a missing hook costs: **calls** — nothing, Arbo reads Sona's calls from
  Quo's record every 10 minutes; **texts** — new Quo texts stop appearing live
  in the Texts list and stop starting the assistant (R28), but the customer
  study (R24) still reads every text thread from Quo every 30 minutes. When
  the missing one is the texts hook, the Quo line adds *"New Quo texts won't
  show under Texts — read them in the Quo app."* and the Texts panel says
  *"Quo line: texts webhook missing — Arbo is read-only and won't create it.
  New Quo texts don't show here; this is not zero texts."*
- Per Sona call: rule check (code guard + Opus read), call record,
  repeat-caller memory. **No calendar hold (R33):** Google is connected
  read-only, so the call card says *"Calendar holds are off — Google is
  connected read-only (Mike, 2026-10-20). Sona's requested time is shown on
  the call card for you to book."* and shows it, when the caller gave one.
  A caller who gave no time gets *"… The caller gave no time — call them to
  set one."* instead.
  State on `GET /api/quo`, on Today and on Leads › Calls & texts.
  *R26:* the code guard now also flags a promised day or time ("we'll be
  there Tuesday") — expect more SONA BROKE A RULE cards for dates, which is
  the rule working, not a new fault.
- **Arbo also reads Sona's calls from Quo's own record (D80)** — the last
  7 days at every boot, then the last day every 10 minutes — so a call the
  webhook missed is still learned. On 2026-09-24 the webhook delivered 8
  Sona calls that Arbo answered 200 and dropped without a word; every
  unused event is now named (`notUsed` on `/api/quo`, a red line on the
  Sona panel, a `[quo] event not used —` log line). A call from before the
  current deploy is learned WITHOUT a calendar hold (the card says "book it
  yourself"; while Google is read-only, R33, it says holds are off like every
  other call), because an earlier deploy may already have filed one. Boot
  log proof: `[quo] read Quo's record — learned N call(s)`.
- **PAUSED by Mike's ruling R33 (2026-10-20): Arbo sends no text.** What
  follows is how the R22 text works once Mike sets `ARBO_QUO_SEND=live`.
  Until then the catch-up button is shown disabled with *"Quo is read-only —
  send from the Quo app."*, the follow-ups do not run, and the boot log says
  `[outreach] READ-ONLY (R33)`.
- **Arbo texts through Quo (R22)** — the ONE outbound path: the "still
  interested in a quote?" template, past-week catch-up on Mike's tap or
  `ARBO_OUTREACH_CATCHUP=live`, 48-hour follow-ups while `ARBO_OUTREACH=live`.
  Gate: consent (they called in), STOP (Quo's WHOLE history, plain words
  count, re-read before every send), 8am–9pm ET, no price/diagnosis/date.
  Never texted: our own numbers (Quo lines, 757-319-5131, 757-821-6983),
  anyone on the line right now, anyone Mike already called back **from the
  Quo line**, anyone whose Sona hold Google confirmed. Quo refuses every send until Mike
  completes US texting registration in Quo → Settings → Trust center; the app
  names that state.
  **Blind spot (audit M13, 2026-10-20):** the "already called back" and
  "already texted" checks read Quo only. A call back or text from the
  business iPhone (757-319-5131, T-Mobile, not ported) never reaches Quo, so
  Arbo cannot see it — the outreach panel and every card say so, and Mike's
  "Don't text" tap is the way to hold someone back. A caller who asked Sona
  for an estimate is "booked" only when Google confirmed the hold; one whose
  hold Arbo cannot see (after a restart, or still being filed) is held back
  by name (`hold_unknown`), and one whose hold FAILED is a normal follow-up.
  While Google is read-only (R33) no hold is made at all, so nobody is
  "booked" from one: a caller who asked Sona for an estimate is a normal
  follow-up for Mike to book himself — never `hold_unknown`, never "failed".

**Still to do in Quo (Mike's side, Sona settings):**
1. Sona answers **immediately** — not after ringing Mike in the Quo app. The
   2026-09-24 test call ended at 2 s with Sona silent.
2. Sona's greeting must carry the AI + recording disclosure (legal line:
   *"I'm Art-is-Tree's AI assistant, and this call is being recorded for
   quality purposes."*). The observed greeting had neither.
3. Sona's instructions must carry Mike's rules (no price, no diagnosis, no
   promised date, credentials, four cities). Until then Arbo's slip check is
   the only net, and it catches slips *after* the call.
4. R23: Sona must never screen or hang up on a "Spam Likely" or unknown
   caller — the instruction line is in `docs/OWNER_RULINGS.md` R23.
5. R26: Sona's emergency instruction should carry the two safety lines Arbo's
   own line now says in code (`src/policy/guardrails.json`,
   `emergency.safetyLines`): *"If anyone is hurt, hang up and call 911 now."*
   and *"If a power line is down or touching the tree, stay far away from it
   and call Dominion Energy at 1-866-366-4357."* Claude's draft wording —
   Mike may change it in both places.

**Carrier check (Mike's side, R23):** T-Mobile Scam Shield "Scam Block" OFF,
iPhone Silence Unknown Callers OFF — either one stops a call before the
20-second forward to Sona can fire. State not yet confirmed.

## Texts

| Line | How texts reach Arbo | State |
|---|---|---|
| Quo 757-606-9432 | Quo webhook (above), photos included — Arbo shows them view-only (R34): an opaque id per photo, the bytes read from Quo when Mike looks, never stored. Outbound: none — the R22 text is paused (R33). | Live, read-only. |
| Arbo 757-821-6983 | Twilio "A message comes in" webhook → `/webhooks/twilio/sms?key=…`, key = **`TWILIO_SMS_WEBHOOK_KEY`** (Railway). Receive only — empty TwiML reply. | **CUT (R21).** Twilio console paste never done. |
| Business 757-319-5131 | iOS blocks every app from native SMS. Optional bridge: an iPhone Shortcuts "Message" automation POSTing `{from, text}` to `/api/relay/text` with header `x-arbor-key` = the app key. Words only, never photos. | Built; Shortcut **not set up**. |

The receptionist script still tells callers to text photos to
**757-319-5131** (`src/policy/guardrails.json` → `photos.method`), which
Arbo cannot see. Pointing it at the Quo number is Mike's prompt decision —
not changed.

## Quo read-only (R33, Mike 2026-10-20)

Mike, verbatim: *"Connect Google as a read only and connect quo as read
only"*. A Quo API key cannot be limited to reading, so Arbo enforces it in
code:

- **One switch: `ARBO_QUO_SEND`.** Read-only unless it is exactly `live`
  (lower case, nothing else — `LIVE`, `true`, a trailing space, or no value
  all stay read-only). **Only Mike sets it, on his explicit word** — it turns
  every Quo write back on at once: the R22 text and Arbo registering its own
  webhooks. Then a manual deploy by full SHA.
- **Refused while read-only, by name:** sending a text (the sender itself,
  the outreach engine, the catch-up route `POST /api/outreach/catchup` → 409
  `quo_read_only`), creating, replacing or deleting a webhook. Nothing leaves
  Arbo for any of them.
- **Still read:** phone numbers, conversations, calls, texts, transcripts,
  summaries, the R24 study, who has not heard back, and the webhook intake.
- **Boot log:** `[quo] READ-ONLY (R33) — ARBO_QUO_SEND is not "live": …`
  (or `[quo] WRITES ON — ARBO_QUO_SEND=live …`). Settings shows a
  **READ-ONLY** chip on the Quo row.

**The hosted assistant (R28) is not behind this switch.** It reaches Quo
through its OWN Quo connection in Mike's Claude Console vault, not Arbo's
`QUO_API_KEY`. Its Quo send tools (`send-message` and every contact, note or
task write) are on `always_ask` in `agents/arbo/agent.yaml`, so each one waits
for Mike's tap in the Arbo app. Mike's read-only choice for Arbo means: **keep
them on `always_ask`** (they are), or tell Claude to turn them off. Same for
its Gmail send, calendar booking and Drive writes — its own Google connection,
also `always_ask`, also not switched by R33. One assistant Google write runs
WITHOUT asking: saving a new Gmail draft (`create_draft`, an R28 default) —
Mike's call whether that stays.

## Notes on calls Mike answers himself

- Calls answered **in the Quo app** are transcribed by Quo and kept by Arbo
  as notes (`handledBy: mike`) — never auto-filed.
- Calls answered on the **native iPhone** line: iOS 18.1+ records and
  transcribes on tap; a Share-sheet Shortcut can POST `{with, text}` to
  `/api/relay/call-notes` (header `x-arbor-key`). Shortcut **not set up**.

## Other webhooks (R19)

| Source | Endpoint | Key (Railway) | State |
|---|---|---|---|
| Railway deploys | `/webhooks/railway?key=…` | `RAILWAY_WEBHOOK_KEY` | Live (webhook `3b974247`). |
| Resend | `/webhooks/resend` | `RESEND_WEBHOOK_SECRET` | Not wired — not needed; the Gmail sweep reads every form within 5 min. |
| ElevenLabs post-call | `/webhooks/elevenlabs` | `ELEVENLABS_POSTCALL_SECRET` | **CUT (R21).** |
