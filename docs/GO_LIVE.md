# Arbo — field test and go-live checklist (R25, 2026-09-28)

What is built, what a field test proves, and the switches only Mike throws.
Nothing on this list is flipped by a build; each is Mike's call (§3, R19).

## 1. Put it on the phones (5 minutes)

| Who | Phone | Steps |
|---|---|---|
| Mike | iPhone | Safari → the Arbo address `/app` → Share → **Add to Home Screen**. It opens full-screen with the ring icon. Enter the access key once. |
| Mike | Android | Chrome → `/app` → ⋮ → **Install app**. |
| Crew | any | Open `/crew` → add to home screen the same way → enter their crew code, then the **crew door key**. |

The crew door key is the Railway variable **`CREW_ACCESS_KEY`** — pick any
long phrase, set it on Railway, give it to the crew. It opens the crew
routes only; it can never open Mike's side. Until it is set, the crew door
opens with Mike's key only.

## 2. What to field-test (links still cut — nothing live is touched)

- [ ] **Today**: hero, Day Ring and systems strip load on the truck's signal; with no signal the offline bar shows and nothing pretends to be current.
- [ ] **Measure**: scan a real trunk with 3d Scanner App (free) or Polycam → export **point cloud** (PLY/LAS/XYZ) → More → Measure → open the file. Tape the trunk at 4.5 ft and compare DBH. Note any tree where Arbo's DBH is off by more than 2 in.
- [ ] **Permits**: run the job check on three real addresses you already know the answer for, one per city. Anything wrong → tell Arbo; the fact gets corrected with its source.
- [ ] **Agents**: More → Agents → Run all eight. Every desk should say LINK CUT for its database inputs — that is correct while the links are cut.
- [ ] **Crew door**: one crew phone, the door key, the gated briefing (scroll + tick + timer).
- [ ] **Night**: open the app after dark — it follows the phone; More → Appearance pins Day or Night.

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

## 5. Held for Mike (not decided by a build)

- Add-on -01 wants CLEAR / EXEMPT / PERMIT REQUIRED as outputs; the brief and the code say never "you're clear". The code keeps PERMIT LIKELY / REVIEW NEEDED / NO OVERLAY–VERIFY until Mike rules.
- Also from -01: the 125-ft rule vs the erodible-soil extension, HRGEO coverage of south VB, and the VB PPR vs administrative-variance path.
