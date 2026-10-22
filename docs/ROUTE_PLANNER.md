# Route planner — TomTom and Today's stops (R35)

Mike, 2026-10-20: *"and for a route planner intergrate tomtom"* / *"so its
automated and when i select a name in my schedule it asks if i want to open
google maps and its pre loaded or we just use the calender feture alreasy
esists"* — and on keys, *"why dont you build and then i add later"*.

It is built and waiting for your TomTom key. Until you add it, Arbo plans with
Google Maps traffic (if `GOOGLE_MAPS_API_KEY` is set) or ZIP estimates, and
says so on screen. **No secrets live in this file** — the key goes in Railway.

## What it does

- **Calendar tab → Today's stops**, above your Google Calendar (the calendar
  itself is unchanged). Every event on today's calendar: its booked time, the
  title, the city.
- **Automatic.** Arbo reads today's events and plans the order — no typing.
- **Tap a stop** → *"Open in Google Maps?"* with the name and address →
  **Yes** opens Google Maps with that address loaded. **No** (or X, or Back)
  closes it.
- **Route the whole day** opens the stops in the planned order. Google Maps
  on a phone takes 3 stops on the way plus the last one, so a longer day is
  split into parts and the screen says so.
- An event with **no address** is listed and says *No address on the event* —
  no Maps button. All-day events and addresses with no ZIP are listed, not
  planned. A **weekday event before 4 PM** (crew time) is listed at its own
  time and kept out of the after-4 run; a two-day job reads *Ongoing*. The
  whole-day sheet names every stop with an address that is not in the route.
- **Once your run starts** (weekdays 4 PM, Saturdays 8 AM) the plan holds — it
  won't reshuffle as you drive. Only a change to today's calendar re-plans it.
  Before that it re-plans on its own; ↻ retries anything that failed.
- The **route planner** box under the calendar (typed stops) uses the same
  engines.

## What it never does

- Never creates, changes, moves or deletes a calendar event. It only reads
  today's events, and keeps them in memory — nothing is saved.
- Never sends your TomTom key to the phone, and never writes it to a log.
- Never prices, diagnoses or promises a time. Booked times stand; the plan's
  order and times are a suggestion.

## Which engine plans it

1. **TomTom** — when `TOMTOM_API_KEY` is set.
2. **Google Maps live traffic** (R16) — when `GOOGLE_MAPS_API_KEY` is set.
3. **ZIP estimates** — always there.

The plan line always says which one did it. If TomTom is set but fails, it
says so — e.g. *TomTom couldn't plan it (TomTom HTTP 403) — planned by Google
Maps instead. Check TOMTOM_API_KEY in Railway…* One plan takes at most 25
stops; past that TomTom is not asked, and the screen says so.

## Your rules TomTom can't change (R16)

- 20 minutes at each stop.
- Weekdays start after 4 PM.
- Saturdays: Norfolk, Chesapeake and Portsmouth in the morning from 8;
  Virginia Beach after 12.
- TomTom only reorders the stops inside each run — it never moves a stop to
  another run.
- Sunday has no rule yet, so Sunday stops are listed in calendar order and not
  planned (your call — R35).

## Add your TomTom key

1. Go to **developer.tomtom.com** and sign up (or sign in).
2. In your TomTom dashboard, create an **API key** (it needs the Search and
   Routing APIs).
3. **Before the key goes in:** the privacy page (`/privacy`) needs a line for
   mapping — today's event addresses will go to TomTom. Your call (R35, open
   question 5).
4. **Railway** → the Arbo service → **Variables** → add `TOMTOM_API_KEY` with
   the key. Nothing else changes.
5. **Deploy by hand** (auto-deploy stays off), then check the deploy as usual.
6. Open **Calendar**. The plan line should read *Planned by TomTom
   (traffic-aware)*. If it says *TomTom couldn't plan it (TomTom HTTP 403)*,
   the key is wrong or not switched on for Search and Routing. *HTTP 429*
   means the key's request limit was reached.

Not checked from here: TomTom's sign-up screens and its free daily limit — the
build sandbox could not open developer.tomtom.com.

## On the map

Calendar → Today's stops → **Map** (or `/app#map-today`) shows the same stops
on a map (Maps wave A, D106; draft ruling R37).

- **Numbered in the planned order**, joined by straight dashed lines. The
  lines show the order only — *"Order only — straight lines, not roads.
  Google Maps draws the road."*
- **Exact pin** (solid, numbered) only where TomTom already placed the
  address for today's route. The map never asks TomTom anything itself, so
  it costs nothing and sends no address anywhere new.
- **ZIP-area pin** (hollow) for every other stop with a ZIP: *"ZIP area — not
  the exact spot"*. Stops in one ZIP share one pin; tap it to see each one.
  A stop before 4 PM, all day or ongoing gets a ZIP-area pin with no number.
- **Stops close together share one pin** (*"1·2"*), drawn between them, only
  when their pins would touch — zoom in and they part; tap it to see each one,
  with how it was placed.
- **Not on the map:** the line *"6 of 8 events on the map · 2 not on the
  map"* — tap it to see which, and why (no address, no ZIP, a PO box ZIP, a
  ZIP outside the four cities).
- **Tap a pin** → the same *"Open in Google Maps?"* as Calendar. **Route the
  whole day in Google Maps** sits at the bottom of the map. If Arbo couldn't
  read your calendar, that button says R35's line instead.
- **The whole map fits the screen**: all four cities when it opens, the notes
  (gaps, counts, **Key**) in a card at the top. A stop off the screen is
  counted — *"1 stop is off this view — show all"*.
- **It keeps to today:** while it's on screen it reads again every minute,
  like Calendar, and when you come back to the app — yesterday's stops never
  show as today's.
- **Can't read your calendar** → R35's line, word for word, and no pins.
  **No TomTom key** → TomTom's own line, and ZIP-area pins only.
- Your home and where the route starts and ends are not drawn.
- The street map is OpenStreetMap: your phone asks it for the squares on
  screen (it sees which area, never a name or an address). If it doesn't load,
  the map says so — and that the pins are still placed, when there are pins.

**Not working yet:** ZIP-area pins. The build couldn't read the Census ZIP
file, so until that table is filled (a build step, dated and tested), a stop
without an exact pin is listed under "not on the map" — *"ZIP areas are not
loaded on the map yet — not placed"*. With the TomTom key in, the stops
TomTom places show as exact pins.

**Before the TomTom key goes in:** a privacy-page line is drafted in R37 for
your OK — it now covers the map too.

## Waiting on Mike

Truck and chipper dimensions, Sunday, where routes start and end, optimise vs
keep the booked order, the privacy page, TomTom's newer Orbis maps, which
events count as stops (estimates vs crew jobs), and what a mid-run calendar
change should do — all listed in `docs/OWNER_RULINGS.md` **R35**.
