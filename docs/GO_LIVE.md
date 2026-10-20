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
- [ ] **Storm law (R26)**: open Today once after the deploy. With no open federal declaration it shows nothing; if FEMA could not be read it says so by name.

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
- [ ] **`ANTHROPIC_API_KEY`** on Railway turns the agents' brain from "offline — deterministic" to Opus.
- [ ] **`CLAUDE_CODE_OAUTH_TOKEN`** repo secret (turns on the automated PR review job).
- [ ] **Migrations 0016–0020** are committed but not applied to the live database (§3: schema changes there are Mike's call). Apply them before the links they serve open — 0020 (brake/steering hold) before the equipment link, or a brake report fails to save instead of holding the unit.

## 5. Held for Mike (not decided by a build)

- Settled by R26: the three permit words stay (not add-on -01's CLEAR / EXEMPT / PERMIT REQUIRED).
- Still from -01: the 125-ft rule vs the erodible-soil extension, HRGEO coverage of south VB, and the VB PPR vs administrative-variance path.
- R26 follow-ups (each a one-line change if Mike wants it): a downed line with nobody hurt — also say the 911 line? · the blocked-date replacement line (the date rule's line today, or the wants-human line) · a "Brakes or steering" checkbox on the breakdown sheet so the hold does not depend on wording · Crew Chief's desk subtitle · open-burning steps reading "PERMIT: REVIEW NEEDED".
- Storm law: the flag only knows federal (FEMA) declarations; a Governor-only declaration is not in any feed. Counsel question: when "time of disaster" ends for Va. Code 59.1-526.
