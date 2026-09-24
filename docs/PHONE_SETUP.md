# PHONE SETUP — how calls and texts actually flow (as of 2026-09-24)

This is the live configuration Mike set up by phone on 2026-09-24 (R19, R20,
D73–D75). If you change any piece of it, change this file in the same PR.
**No secrets live here** — keys are Railway variables, named below.

## The numbers

| Number | What it is | Who answers |
|---|---|---|
| **757-319-5131** | Art-is-Tree's business line — Mike's iPhone, **T-Mobile**. The public number. Stays on T-Mobile: Mike ruled *"i dont want to port the number"*. | Mike. Unanswered calls forward to Quo after 20 s. |
| **757-606-9432** | Quo number ("Art-is-Tree LLC"), inbox `PN70xPKd5p`. | **Sona**, Quo's AI (R20: *"let sona handle it for a while while arbo learns from it"*). |
| 757-821-6983 | Arbo's own line (Twilio → ElevenLabs → Arbo's guarded Opus brain). | **Nobody — links CUT (R21)** while development runs off Sona. Nothing deleted. |

Never change the public number anywhere — Google, the website, and SEO are
out of scope (CLAUDE.md hard boundary). Quo sits *behind* 757-319-5131.

## Twilio + ElevenLabs links — CUT (R21)

Mike: *"disconnect the twilio and eleven labs links while we develop off
sona"*. Cut in code, not deleted. Doors refused with 503 `link_cut`: the
voice bridge `/voice/llm`, `/webhooks/elevenlabs`, Talk to Arbo, the spoken
brief, `/webhooks/twilio/sms`. Boot log: `[links] CUT while Sona handles
calls (R21): elevenlabs, twilio`.

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

- At every boot Arbo registers its own Quo webhooks (messages, calls,
  call-summaries, call-transcripts) at `https://$RAILWAY_PUBLIC_DOMAIN/webhooks/quo`
  using **`QUO_API_KEY`** (Railway). Boot log proof:
  `[quo] wired — created N, reused N, failed 0, 1 number(s)`.
- Per Sona call: rule check (code guard + Opus read), calendar hold filed
  Mike's way, call record, repeat-caller memory. State on `GET /api/quo`
  and the Today / Calls screens.
- **Arbo also reads Sona's calls from Quo's own record (D80)** — the last
  7 days at every boot, then the last day every 10 minutes — so a call the
  webhook missed is still learned. On 2026-09-24 the webhook delivered 8
  Sona calls that Arbo answered 200 and dropped without a word; every
  unused event is now named (`notUsed` on `/api/quo`, a red line on the
  Sona panel, a `[quo] event not used —` log line). A call from before the
  current deploy is learned WITHOUT a calendar hold (the card says "book it
  yourself"), because an earlier deploy may already have filed one. Boot
  log proof: `[quo] read Quo's record — learned N call(s)`.
- **Arbo texts through Quo (R22)** — the ONE outbound path: the "still
  interested in a quote?" template, past-week catch-up on Mike's tap or
  `ARBO_OUTREACH_CATCHUP=live`, 48-hour follow-ups while `ARBO_OUTREACH=live`.
  Gate: consent (they called in), STOP (Quo's WHOLE history, plain words
  count, re-read before every send), 8am–9pm ET, no price/diagnosis/date.
  Never texted: our own numbers (Quo lines, 757-319-5131, 757-821-6983),
  anyone on the line right now, anyone Mike already called back. Quo refuses every send until Mike
  completes US texting registration in Quo → Settings → Trust center; the app
  names that state.

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

**Carrier check (Mike's side, R23):** T-Mobile Scam Shield "Scam Block" OFF,
iPhone Silence Unknown Callers OFF — either one stops a call before the
20-second forward to Sona can fire. State not yet confirmed.

## Texts

| Line | How texts reach Arbo | State |
|---|---|---|
| Quo 757-606-9432 | Quo webhook (above), photos included. Outbound: the R22 text only. | Live. |
| Arbo 757-821-6983 | Twilio "A message comes in" webhook → `/webhooks/twilio/sms?key=…`, key = **`TWILIO_SMS_WEBHOOK_KEY`** (Railway). Receive only — empty TwiML reply. | **CUT (R21).** Twilio console paste never done. |
| Business 757-319-5131 | iOS blocks every app from native SMS. Optional bridge: an iPhone Shortcuts "Message" automation POSTing `{from, text}` to `/api/relay/text` with header `x-arbor-key` = the app key. Words only, never photos. | Built; Shortcut **not set up**. |

The receptionist script still tells callers to text photos to
**757-319-5131** (`src/policy/guardrails.json` → `photos.method`), which
Arbo cannot see. Pointing it at the Quo number is Mike's prompt decision —
not changed.

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
