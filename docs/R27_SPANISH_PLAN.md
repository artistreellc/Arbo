# R27 — The Spanish version: the build plan

**Status (2026-10-22):** Foundation built (D110, branch `es-foundation`) — the
runtime (`T`, `tf`, `tn`, `esPick`, `esPair`), per-door dictionaries inlined at
serve time, both switches (Office → Appearance and the key screen;
the crew door's header toggle), the glossary, the ban list in every
never-say-clear guard, `withEs`/`enSha` twins, the review ledger and the
customer fence. Nothing is translated yet beyond the switches' own words:
Spanish mode shows every screen in English, marked "en inglés". The plan's
safety-label table is in the ledger as a draft, so no safety label is served
in Spanish until its review is recorded. **Phase A is next** (crew door
first). Not deployed.

Mike, 2026-10-20: *"The whole app needs to be able to have a Spanish version
as well for our Spanish speaking, employees"* (ruling R27). This is the plan
the build follows. It came from six read-only inventories of every string in
both apps and the server, one architect's draft, and two adversarial critiques
(correctness, and safety/legal/language). Claude made the final calls below;
the questions at the end have defaults and do not block the build.

## Size

About 1,150 owner-app strings, about 150 crew-door strings and about 1,350
server strings. Of the server strings, roughly 1,000 are owner-only bodies of
text: the Learn scenarios, the Permit Desk facts and the Agents desk.

## The design

### Three kinds of text, one path each

1. **Screen copy** in `index.html` and `crew.html`. The English stays in the
   code exactly as it is and is the dictionary key. Spanish lives in
   `src/app/i18n/<door>-<unit>.es.json`, one file per build unit. The server
   inlines the door's dictionary into the page at serve time, the same way
   the sprite is inlined, so it works offline and the crew page carries only
   crew strings. The call site wraps its copy:
   - `T('No new leads')` for fixed text;
   - `tf('{n} calls today', {n})` when a value goes in;
   - `tn(n, one, many, vars)` for a count.

   A sentence is never built by gluing Spanish pieces together.
2. **Server text**, meaning the lines, notes, reasons and steps that server
   modules write. The English field stays byte-identical. A Spanish twin goes
   under `es` with the same field names. Each twin carries `enSha`, the
   fingerprint of the exact English it was translated from. If the English
   later changes, the twin is not served: the English shows, with a small
   "en inglés" mark, until someone re-translates it. A corrected safety line
   can never keep an old Spanish meaning.
3. **Data** is never translated: names, addresses, notes, anything typed,
   transcripts, model-written text, and weather-service headlines. It is
   passed into a template only as a value.

### The switch

- **Owner app.** An "English | Español" choice sits in Office → Appearance, plus
  a small toggle on the key screen, because an employee meets that first. It
  is remembered per phone under `arboLang`. A change reloads the page, which
  is the simple way to leave no half-translated screen.
- **Crew door.** A header toggle on every screen, door-key screen included,
  remembered under `arboCrewLang`.
  - Before the day's briefing is signed, a change reloads, and the gate
    restarts (scroll, tick and timer) in the new language.
  - After sign-off, a change redraws the work orders, library and quiz in
    place. It never reloads, because that would re-lock the day and write a
    second paid sign-off.
- The two doors keep separate settings, so Mike's crew preview can be set to
  Spanish without flipping his own app.
- English is the default everywhere. Only the exact stored value `es` turns
  Spanish on; anything else stays English (fail closed).
- If a dictionary is broken, the page stays in English and says so in both
  languages. It never shows a blank screen (§1B).

### Safety and legal labels: Spanish first, English beside it (R27 #4)

Labels lead with what to do, so a clipped label still shows the obligation:

| English (badge) | Spanish half |
|---|---|
| PERMIT LIKELY | PROBABLEMENTE SE NECESITA PERMISO |
| PERMIT: REVIEW NEEDED | PERMISO: HAY QUE REVISAR |
| NO OVERLAY — VERIFY W/ CITY | VERIFIQUE CON LA CIUDAD — EL MAPA NO MOSTRÓ ZONA PROTEGIDA |
| PERMIT SCREEN PENDING | CHEQUEO DE PERMISO SIN HACER |
| HELD (brake/steering) | NO SE MANEJA — FRENOS/DIRECCIÓN |
| NO AERIAL WORK | NO PUEDE TRABAJAR EN ALTURA |
| NO EXPIRY DATE | FALTA LA FECHA DE VENCIMIENTO |

The rest of the safety and legal set gets the same treatment:
- the chips EMERGENCY, POWER LINES, STRUCTURES, CALL FIRST, TICKET REQUIRED,
  STOP WORK, DOWN, EXPIRED, NO RECORD and UNCONFIRMED;
- the lines for 911, 811, Dominion and stop work.

Each of these shows the Spanish with the **full English line beneath it**,
smaller and marked as English.

Other wording rules:
- STOP, the carrier keyword, is never translated.
- Credential wording is quoted in English with a Spanish gloss.
  "Licenciado" (it means a degree) and "acreditado" are never used.

### Banned in Spanish, as in English

Every Spanish string is checked:
- in tests;
- at runtime wherever an English "never clear" guard runs today (screening,
  permit board, utility markings, judge, brain).

Before matching, the text is normalized: accents folded, lower case, and
non-breaking and thin spaces collapsed. The banned words and phrases:
- libre (via libre, zona libre, paso libre);
- exento;
- no necesita / no requiere / no hace falta permiso;
- despejado;
- luz verde;
- listo para cortar;
- sin fecha de vencimiento (it reads as "never expires");
- rescate aéreo;
- zona marcada (used for an overlay);
- licenciado;
- acreditado;
- the safety-board stems "está calificado" and "autorizado para trepar";
- the Spanish never-price and money-threat terms, as phrases.

### Quiz and briefing stay correct

- Quiz answers stay keyed by option position.
- A Spanish twin is served only when it has the same number of options in
  the same order.
- Each translated item is checked for whether the keyed answer is still the
  only correct one, before its twin is served.
- Grading never sees Spanish.
- A briefing signed in Spanish records the language. If a Spanish reader was
  shown the English fallback, the sign-off says so, and the Training board
  flags it ("go over it with them"). It never blocks the gate (§4.7).

### Dates and numbers

- Display dates use `es-US`, so money and decimals stay `$1,234.50` and
  `14.5`. A decimal comma on a DBH would be dangerous.
- Times that machines compare (quiet hours, Friday checks, ET day) stay
  `en-US` forever.
- Feet and inches stay.

### Never touched (customer-facing, R27 #3)

These stay byte-identical, and tests prove it by output:
- the receptionist;
- voice;
- the portal;
- customer texts and the STOP handling;
- the public pages;
- talk.html;
- calendar titles;
- model prompts.

### Fail-safe additions that follow from Spanish use

- A Spanish breakdown report holds a unit exactly like the English words do:
  - frenos, "breaks", sin frenos;
  - timón, volante;
  - dirección only next to a defect word, because alone it also means
    "address".
- A near miss typed in Spanish is matched to Spanish hazard words, electrical
  first. It is always flagged for Mike to confirm the category by hand.

## How quality is checked

1. **Glossary first.** One glossary (`src/i18n/glossary.ts`) binds every
   unit. It uses neutral Latin-American Spanish in the "usted" register, and
   keeps the English beside the trade terms crews use, e.g. "ayudante de
   tierra (groundie)", "zona de caída (drop zone)", "astilladora (chipper)".
   The known false friends are pinned:
   - conductor (electrical) → cable / línea eléctrica;
   - utility → la compañía de luz;
   - applied → SOLICITADO.
2. **Two independent passes.** One agent translates a unit and a second
   reviews it blind. For every safety-class string, a third back-translates
   it to English without seeing the original. A meaning drift blocks it.
3. **Mechanical gates.**
   - Parity: no stale or missing keys.
   - Tokens: numbers, § cites, phones, ft, and qualifiers such as "working
     days" ↔ "días hábiles" and "at least" ↔ "al menos".
   - Negation: a dropped NO fails.
   - Hedges stay hedges: "may apply" never becomes "applies".
   - English byte-identity: the whole existing suite passes in English.
   - Data passthrough: test data that equals a dictionary key stays as typed.
   - Customer fence.
   - Layout: Spanish at 320 and 360 px, compared against the English
     baseline.
4. **A review ledger.** `src/i18n/reviewed.json` records a fingerprint for
   each safety-class string. A later edit that is not re-reviewed fails the
   build.
5. **A person.** Before crews rely on it, a Spanish-speaking crew member reads
   the briefing, the quiz and the work orders on a phone (R27 #5).

## Order of work

1. R26 merges and deploys first, because it rewrites the same screens.
2. **Foundation (one PR):**
   - the runtime (`T`, `tf`, `tn`, `esPick`);
   - dictionary inlining;
   - both switches;
   - the glossary;
   - the ban list and gates;
   - `withEs` and `enSha` for server twins;
   - the safety-pair helper;
   - the test stubs every harness needs.
3. **Phase A, in parallel units:**
   - the whole crew door, plus the server text it shows (work orders,
     hazards, permit notes, gate reasons, library);
   - every owner-app screen's own copy (Direction B's screens): Today, Leads and
     Calls & texts, Calendar, Estimate, Properties on file, Follow-ups, Money,
     Fleet, Crew & safety, Numbers, Settings, Office, Permit rules, Agents,
     Measure, Teach Arbo;
   - the shared safety labels.
4. **Phase B:** the owner-only server prose:
   - the Permit Desk facts (Spanish with the English rule beneath);
   - the Agents desk lines;
   - the Learn scenarios;
   - the ops lines;
   - the LiDAR messages.

   Until each lands it shows English with "en inglés", never a blank.
5. A second translation and review wave, screenshots in both languages,
   then the PR and deploy.
6. Mike's phone read-through by a Spanish-speaking crew member.

## Questions for Mike (each has a default; none blocks the build)

- **Register:** "usted" (default, standard in safety training) or "tú"?
- **Who uses the owner app in Spanish?** If it is mainly the crew door, Phase B
  can come last. Default: everything is translated, Phase B last.
- **Who reads it through?** Which Spanish-speaking crew member does the phone
  read, and who signs off future Spanish briefings and quiz questions?
- **Separate decision, not bundled:** today the server takes the read-time
  minimum for a briefing from what the phone sends back. Should it re-read
  the briefing itself?
- **Out of scope, flagged:** customers who text "ALTO", "BASTA" or "BAJA" are
  not treated as STOP. That is a TCPA question for customer texting, kept
  separate from R27.
- The installed app's home-screen name stays "Arbo" (a phone freezes it at
  install).
