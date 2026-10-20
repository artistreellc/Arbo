# Arbo — field test and go-live checklist (R25, 2026-09-28)

What is built, what a field test proves, and the switches only Mike throws.
Nothing on this list is flipped by a build; each is Mike's call (§3, R19).

## 1. Put it on the phones (5 minutes)

| Who | Phone | Steps |
|---|---|---|
| Mike | iPhone | Safari → the Arbo address `/app` → Share → **Add to Home Screen**. It opens full-screen with the ring icon. Enter the access key once. |
| Mike | Android | Chrome → `/app` → ⋮ → **Install app**. |
| Crew | any | Open `/crew` → add to home screen the same way → enter their crew code, then the **crew door key**. |

Mike's own look at the crew page is the **Crew** tile in More, or the
**Crew preview** shortcut on the installed app's icon (press and hold). It is
look-only: nothing there signs, files or clocks in (R26).

The crew door key is the Railway variable **`CREW_ACCESS_KEY`** — pick any
long phrase, set it on Railway, give it to the crew. It opens the crew
routes only; it can never open Mike's side. Until it is set, a crew phone
shows "the crew door key isn't set up yet — ask Mike" and asks for nothing
(a phone already holding a working key keeps working).

## 2. What to field-test (links still cut — nothing live is touched)

- [ ] **Today**: hero, Day Ring and systems strip load on the truck's signal; with no signal the offline bar shows and nothing pretends to be current.
- [ ] **Measure**: scan a real trunk with 3d Scanner App (free) or Polycam → export **point cloud** (PLY/LAS/XYZ) → More → Measure → open the file. Tape the trunk at 4.5 ft and compare DBH. Note any tree where Arbo's DBH is off by more than 2 in.
- [ ] **Permits**: run the job check on three real addresses you already know the answer for, one per city. Anything wrong → tell Arbo; the fact gets corrected with its source.
- [ ] **Agents**: More → Agents → Run all eight. Every desk should say LINK CUT for its database inputs — that is correct while the links are cut.
- [ ] **Crew door**: one crew phone, the door key, the gated briefing (scroll + tick + timer).
- [ ] **Night**: open the app after dark — it follows the phone; More → Appearance pins Day or Night.
- [ ] **Emergency wording (R26)**: read the 911 / Dominion lines in `src/policy/guardrails.json` (`emergency.safetyLines`, `emergency.alertLine`). They are Claude's draft; change any word.
- [ ] **Brake hold (R26)**: file a practice breakdown that mentions brakes — the unit shows HELD, NOT SCHEDULABLE; only your key signs it back on.
- [ ] **Storm law (R26)**: open Today once after the deploy. On a calm day it shows nothing. While NWS has a storm alert out and FEMA has no declaration, one muted line reminds you Governor declarations are not in any feed. A FEMA declaration counts for 30 days after its incident ends. If FEMA could not be read it says so by name — if that line shows on a normal day, the FEMA query needs a look.

## 3. Phone calls to close the permit gaps (from the research)

1. Norfolk CBPA — which number is current: 757-664-4368, 757-664-4752 or 757-664-4363?
2. Virginia Beach — fee and contents of the "PPR – Tree Removal Only" form.
3. Portsmouth — street-tree pruning/removal rule and department; does an Olde Towne COA cover tree removal on a lot?
4. Right-of-way permit fees and lead times: Virginia Beach, Chesapeake, Portsmouth.
5. SPSA commercial yard-waste rate.
6. DPOR — does tree work alone need a contractor license?

## 4. Go-live switches (Mike only, one by one)

- [ ] **Reconnect Google** — Settings → Google (Gmail read, calendar holds, Drive read).
- [ ] **Open the data links one at a time** after each passes its verification (`docs/DATA_LINKS.md`, R19). The app runs fully with them cut; opening one is never an optimisation.
- [ ] **Quo texting registration** (A2P) before any R22 text goes out.
- [ ] **Bouncie truck tracking** (R31) — built and switched off. Steps in `docs/BOUNCIE.md`: the Bouncie portal app with Client ID `arbo-app` and the Redirect URI `https://arbor-server-production.up.railway.app/api/bouncie/callback` → `BOUNCIE_CLIENT_ID` / `BOUNCIE_CLIENT_SECRET` and `ARBO_LINK_CREDENTIALS=live` (the sealed sign-in row — Mike, 2026-10-20: "Yes, allow the sign-in row"; migration 0021 is applied live 2026-10-20) → deploy → Settings → Connect Bouncie → `BOUNCIE_WEBHOOK_KEY` → deploy → turn on the webhook in the Bouncie portal → `ARBO_LINK_BOUNCIE=live` when ready. Arbo renews the sign-in once a day ("Keep the sign-in alive"); `BOUNCIE_API_KEY` is not needed and can be deleted. Owner only; the crew door never shows it.
- [ ] **The business assistant (R28)** — built and switched off. Steps in `docs/ASSISTANT_SETUP.md`, in order: Console → Agents → Arbo → Edit → Raw → paste `agents/arbo/agent.yaml` → Save · a vault with the five accounts (Gmail, Calendar, Drive, Quo, Square) · a cloud environment on **Limited** networking with the listed hosts · on Railway `ARBO_AGENT_ID`, `ARBO_AGENT_ENVIRONMENT_ID`, `ARBO_AGENT_VAULT_ID` (optional `ARBO_AGENT_SESSION_BUDGET_USD`, `ARBO_AGENT_CREW_NUMBERS`) · deploy · `ARBO_AGENT=live` · deploy. Once on, exactly four things start it: each inbound Quo text, missed call or finished call; a Gmail sweep every 30 minutes 7am–9pm ET; the crew summaries at 6:30am ET; and the **daily office check at 7am ET, Monday to Saturday** (weather for today's and tomorrow's jobs, invoices unpaid past their terms, equipment due for service, anything waiting on you — its report on Today and in Activity; no switch of its own). Every email, text, calendar booking, Drive write and Square call waits for your OK in the app; a customer text allowed before 8am or after 9pm ET is refused until 8.
- [ ] **`ANTHROPIC_API_KEY`** on Railway turns the agents' brain from "offline — deterministic" to Opus.
- [ ] **`CLAUDE_CODE_OAUTH_TOKEN`** repo secret (turns on the automated PR review job).
- [x] **The Supabase project `arbor` was paused** — restored 2026-10-20 on Mike's yes (R29); ACTIVE_HEALTHY. If Supabase pauses it again for being idle, restore it the same day (Supabase dashboard → the project → Restore) — a paused project can only be restored for a limited time.
- [x] **Migration 0020** (brake/steering hold) applied live 2026-10-20 after the restore, and checked. (0016–0019 were already applied, `docs/DATA_LINKS.md` step 1.)
- [ ] **Delete the 11 mistaken job rows** (R29, Mike: "Delete the 11"). The backup `archive.job_mistaken_import_20260802` is made and verified. Supabase → project arbor → SQL Editor → New query → `delete from public.job where id in (select id from archive.job_mistaken_import_20260802);` → Run. Afterwards `public.job` holds 0 rows; leads stay 37.

## 5. Held for Mike (not decided by a build)

- Settled by R26: the three permit words stay (not add-on -01's CLEAR / EXEMPT / PERMIT REQUIRED).
- Still from -01: the 125-ft rule vs the erodible-soil extension, HRGEO coverage of south VB, and the VB PPR vs administrative-variance path.
- R26 follow-ups (each a one-line change if Mike wants it): a downed line with nobody hurt — also say the 911 line? · the blocked-date replacement line (the date rule's line today, or the wants-human line) · a "Brakes or steering" checkbox on the breakdown sheet so the hold does not depend on wording · Crew Chief's desk subtitle · open-burning steps reading "PERMIT: REVIEW NEEDED".
- Storm law: the flag only knows federal (FEMA) declarations; a Governor-only declaration is not in any feed. Counsel question: when "time of disaster" ends for Va. Code 59.1-526.

## 6. Talk (R30) — test it on your iPhone, parked

Talk is the **mic button marked "Talk"** at the top right of every screen.
One tap and Arbo reads you what needs you, then listens; ask anything about
today, Sona's calls or the trucks and it answers out loud. Say **"that's
all"** (or "stop", or "goodbye") or tap **End** to finish. It is read-only:
it tells you things, it cannot send, book or change anything. Your iPhone
does the listening and the speaking; Arbo's own brain does the thinking.
While the data links are cut it says so ("cut on purpose — not zero").

Start it while parked — Virginia law is about holding the phone, and nothing
after the first tap needs a touch.

- [ ] **Home-screen app**: tap Talk. You should hear "Pulling your update",
      then the update. The first time, the iPhone asks to allow the
      microphone and speech recognition — tap **Allow**; Arbo waits up to 20
      seconds for it. When the line under the big button says
      **Listening…**, ask "what's at stop two?". It should answer out loud and
      listen again. Then say "that's all".
- [ ] **Same test in a Safari tab** (the Arbo address `/app`). Apple has never
      said the home-screen app may listen; Safari can. If only Safari works,
      tell Claude which — the choice of what to do about it is yours.
- [ ] **Silent switch on**: do you still hear it?
- [ ] **In the truck**: does the voice come through the truck's speakers over
      Bluetooth/CarPlay, and does it still hear you? Is the volume normal
      after the first answer, or does it drop?
- [ ] **Lock the screen mid-answer**: it stops; back in the app it says
      "Paused when the screen locked".

**If it cannot hear you, read Claude the exact line under the big button.**

| The line says | What to do |
|---|---|
| "The microphone is off for Arbo…" | Allow the microphone: Safari → the **aA** button → Website Settings → Microphone → Allow (and Settings → Safari → Microphone → Ask or Allow). |
| "Speech recognition isn't available right now…" | If Settings → General → Keyboard → **Enable Dictation** is off, turn it on. Then tap End, then Start — it tries the mic again. |
| "I lost the microphone — a call or Siri may have it…" | Finish the call (or Siri), then tap End, then Start — it tries the mic again. |
| "I can't hear you in this mode…" | The mic never opened, twice. Tap End, then Start to try again; if it keeps saying this, try the Safari tab. The typing box works either way — tap it, then the mic on the keyboard. |
| "Talk is locked…" | Check the key in Settings. If the key is right, `APP_ACCESS_KEY` is not set on Railway. |
| "Arbo's brain is off — there's no AI key…" | `ANTHROPIC_API_KEY` is not set on Railway. |
| "Arbo's brain didn't answer — try again." (or "…didn't answer (503)…") | Arbo's brain failed or took too long that turn. Say it again — Talk keeps listening. |
| "I can't say that one out loud…" | The answer broke one of your rules (a price, a promised day, a permit "clear", a phone number, a claim that Arbo did something…) twice — Arbo gets one second try first — and was held back. Ask another way, or look in the app. |

Also tell Claude: your iPhone model and iOS version, home-screen app or
Safari, and whether you heard the voice at all.

## 7. The assistant (R28) — its first days on

After `ARBO_AGENT=live` and the deploy (§4), check in the app:

- [ ] **More → Assistant → Status** reads **ON**. If it says the environment is
      not Limited, or could not be read, nothing starts — fix Step 3 of
      `docs/ASSISTANT_SETUP.md` and it starts within a minute.
- [ ] **A test text** to the business line from your own phone: a card appears
      under "Waiting for your OK" on Today. Deny it with a note; Activity shows
      the agent got it.
- [ ] **The office check** (7am, Monday to Saturday): Today shows one line for it
      — running, done, or that it did not run — and, once done, its report
      under that line. Until Square's read tools are loosened, it stops for
      your Allow on each Square lookup first. A day it says "did not run"
      means Arbo was off or down between 7 and 10am — not that there was
      nothing to report.
- [ ] **A late text**: Allow on a customer text after 9pm is refused with a line
      that says why; the card stays for the morning. Your crew numbers
      (`ARBO_AGENT_CREW_NUMBERS`) are not held.
- [ ] **A booking**: every calendar booking waits for your Allow. If a card
      ever names a guest, Google would email them an invite — deny it unless
      you mean it.
