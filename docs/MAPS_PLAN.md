# Arbo maps: build plan

**Status (2026-10-21):** M0 and M1 built (D106, branch `maps-a`, commits 6938c2c and 6f4a5ce; draft ruling R37), then reviewed and fixed on the same branch (D106's review round: 45a3fa4, adead5d, df4f3b2) — not deployed (Railway unreachable from the build). The ZIP table ships empty (the Census host was refused from the build machine), so ZIP-area pins wait on it; layer 33's limits are not read yet (M2 waits on them). M2, M3 and M4 are not built. Where the review moved the plan, the lines below say so ("review, D106").

**Status when drafted:** plan only, not built yet. Drafted read-only on 2026-10-21 against main e4a6415, then revised once against a 25-point critique. All 25 points were taken. At e4a6415:
- Direction B was complete.
- R35 TomTom was built, with Today's stops above the Calendar frame.
- R31 Bouncie was dormant, with the owner-only MAP HOOK.
- R32 read-only data, R33 Google and Quo read-only, R34 Quo photos and audit wave 1 were in.

**Mike, 2026-10-20:** *"the map, the crew section, everythimg else really needs to start tightening up and updating i need thos app to lauch very soon"*. His answers:
- **Map:** all four (today's stops plus route; leads and jobs; crew and trucks; permit areas).
- **Launch:** "I use it daily first".
- **Date:** this month (October 2026).

Earlier: *"for a route planner intergrate tomtom"* (R35, built). On Bouncie: *"why dont you build and then i add later"* (R31, built dormant).

**Binding:**
- CLAUDE.md
- `docs/OWNER_RULINGS.md`: R2, R15, R16, R24, R29, R31, R32, R33, R35
- `docs/DIRECTION_B.md` and `docs/DIRECTION_B_PLAN.md`
- DECISIONS D101–D105
- `docs/ROUTE_PLANNER.md`, `docs/BOUNCIE.md`, `docs/OPS_CONVENTIONS.md`, `docs/GO_LIVE.md`

Where a ruling and this plan disagree, the ruling wins. `docs/ARBO_SPEC.md:186` lists the "owner live map" as **Coming**. This plan builds it, except for crew location (Q8).

## What gets built

One **Map** screen in the owner app, with four layers Mike switches on and off:
- **Today:** today's calendar stops, numbered in R35's planned order.
- **Permit areas:** Virginia DEQ's statewide Resource Protection Area (RPA) layer.
- **Leads & jobs:** open leads, grouped by ZIP area. For jobs, the layer points to Today (Q14).
- **Trucks:** from Bouncie, once Mike connects it. Crew are named as having no location source.

The street map comes from OpenStreetMap (OSM). Leaflet draws it. Leaflet is kept in the repo and Arbo serves it. Driving stays in Google Maps, through R35's "Open in Google Maps?" sheet.

Rules for every layer:
- A layer that can't draw says why, in words, on the map.
- Nothing is written anywhere, and there is no new POST.
- **No address goes anywhere new.** TomTom is asked nothing that the R35 planner doesn't already ask.
- The crew door never gets a map.

## What Mike sees on day one

As production stands, three go-live items are still open: the Google read-only reconnect is unchecked (`GO_LIVE.md:70`), the TomTom key is unconfirmed, and the Bouncie keys are missing (`GO_LIVE.md:73`). So on day one:
- **Today:** R35's "Couldn't read your calendar — … (Settings → Reconnect Google)" line, and no pins. After the reconnect, the stops show as ZIP-area pins. They become exact pins only after the privacy line (Q12) and the TomTom key are both in.
- **Permit areas:** real DEQ shading. This is the only layer with live data on day one.
- **Leads & jobs:** the Leads tab's own `notFed` line, then "N older leads hidden — Show older". Jobs point to Today.
- **Trucks:** Bouncie's `keys_missing` line. Crew: "no crew location".

## Facts checked in the code that shape this plan

1. **No map exists.** There is no map library, no tiles and no basemap. The only coordinate the phone ever gets is truck lat/lon from dormant Bouncie (`TruckView`, `bouncie.ts:468-492`).
2. **The shell's laws** (`test/appUi.test.ts`):
   - no `<script src=`, no stylesheet or font `<link>`, no `@import` (:59-63);
   - only three outside hosts: `calendar.google.com`, `maps.google.com` and `www.google.com` (:65-74);
   - no "Suffolk" and no "TCIA" (:82-85);
   - nothing matching `/permit[^<]{0,20}clear/i` (:87-91);
   - no `innerHTML` (:94-95).

   Leaflet's own source uses `innerHTML` and names `leafletjs.com`, so it can never be inlined in `index.html`.
3. **There is a pattern for vendored code.** `loadTalkWidgetJs` (`src/server/appPage.ts`) serves a pinned npm bundle from `node_modules` on Arbo's own route ("no third-party CDN in the serving path"). The sprite is inlined at serve time through a marker (`<!--ARBO:SPRITE-->`).
4. **There is one Google Maps URL builder**, `mapsDirUrl` (`index.html:3853`), pinned by `test/directionB_navigate.test.ts:81-87`. Every "navigate" goes through `openMapsStop` / `openMapsDay` and the `maps` sheet (`SHEETS`, `index.html:8504`).
5. **Back and history.**
   - `navBack` calls `history.back()` whenever `history.state.d > 0` (`index.html:8543-8553`).
   - A hash change inside an iframe adds a step to the same joint history. Back would then undo the frame's step instead of leaving the screen.
   - A deep link lands with `d: 0` and goes back to `NAV_PARENT` (`startView`, :8530-8535).
   - `DOCK_OF` (:8152) decides which dock tab lights.
6. **The shell's ↻ redraws only the `TIMED` screens and the listed More desks** (`index.html:8607-8622`).
7. **The key can be held in memory only.** When storage is blocked, the shell keeps `KEY` for the visit only (`index.html:1018`, `6402`). `KEY` is a top-level `let`, so it is not a `window` property.
8. **The `/api` door takes the `x-arbor-key` header only.** `?key=` is refused (`accessDoor.ts:286-305`), so an `<img>` can't carry the key. The crew key opens `/api/crew/*` only.
9. **The service worker** (`src/app/sw.js`):
   - never caches `/api/` (:28-30, pinned by `r25Routes.test.ts:124-135`);
   - skips every cross-origin request (:36);
   - installs with `c.addAll(PRECACHE)` (:17), which fails completely if any one file fails;
   - is shared by `/app` and `/crew`.
10. **Leaflet would have to be a runtime dependency.** `devDependencies` (`package.json:28`) may be pruned on Railway.
11. **TomTom** (`src/integrations/tomtom.ts`):
    - The geocoder returns `{lat, lon}`, or null outside Virginia. It places any Virginia address, not only the four cities (:158-160).
    - Answers are kept in memory for the ET day, at most 200. A failure is never remembered (:253-254).
    - The planner geocodes **only routable stops**, those with `why === null` (`todayStops.ts:295`, `routePlanner.ts:418-422`). It sends `addressOf(s)`, which is the event's location (:217-219).
    - The key rides in the request URL, so it never leaves the server (R35 #6).
    - Routes are `routeRepresentation: 'summaryOnly'`, so there is **no road shape to draw**.
    - Whether `TOMTOM_API_KEY` is on Railway is **not confirmed**. GO_LIVE has no TomTom line, and the Railway MCP was not signed in.
12. **Today's stops.**
    - `strip()` (`todayStops.ts:376-379`) keeps each stop's ZIP on the server. `TodayStop` has no coordinates.
    - On Sunday, `plan.engine` is `null` and `plan.order` holds calendar order. The line is `SUNDAY_LINE` (:91, :292).
    - The engine can be `tomtom`, `google`, `zip` or `null` (:123).
13. **Leads.**
    - `/api/leads` returns only `status in (new, qualified, emergency)` (`repositories.ts:554`). It is capped by `limit`: 25 by default (`server.ts:1197`), 50 from the Leads tab (`index.html:3442`).
    - Each lead's name, ZIP and city come from the contact and property embeds (`repositories.ts:552`).
    - Arbo receives no new leads (R4). The tab says so in `notFed` (`index.html:3631`): "Arbo doesn't receive new leads yet — Sona's are in Quo, and website and ad leads are in Gmail. This is not an empty inbox."
    - One rule, 14 days, sets each lead's `older` flag (`OLDER_LEAD_DAYS`, `leadAge.ts:12`).
    - Every SIM lead has `zip: null` (`simSource.ts:142`).
14. **Jobs.**
    - `/api/brief` needs `from` and `to` (`server.ts:1193`). It returns Arbo's estimates and jobs together (`repositories.ts:577-590`). In read-only mode, the cut job query takes the estimates down with it.
    - Mike's jobs live on Google Calendar (R2).
    - The `job` table holds 11 held rows until the R29 delete (`GO_LIVE.md`), then 0.
15. **Production is read-only** (D97).
    - `jobs`, `permits`, `photos` and `calls` stay cut (`READ_ONLY_KEPT_CUT`, `src/db/links.ts`).
    - At the 2026-09-24 check (`DATA_LINKS.md`, not re-checked live): `lead` had 37 clean rows; contacts and properties were FLAGGED. 11 of the 14 FLAGGED properties belong to the held job rows (`DATA_LINKS.md:93-94`). `equipment_unit` had 0 rows.
    - Nothing fills `property.geo_lat/geo_lng`.
16. **Permit screening is count-only.**
    - It uses `returnCountOnly` (`arcgis.ts:72`). The geocoded point (`liveGisProvider.ts:86`) is used for those counts and is not kept.
    - Its geocoder is Google when a Maps key is set, otherwise Census (`liveGisProvider.ts:131-132`). So Census already receives permit-screen addresses.
    - The 300 m probe exists because a street point can sit 150–300 m from a rear-lot buffer (`liveGisProvider.ts:97-100`, D37).
    - DEQ layer 33 is `live` for all four cities (`layers.ts:111-118`, URL `…/EDMA/MapServer/33`). The city layers are only `candidate`, and Portsmouth has none.
    - D37's known-RPA case is a customer's property and is withheld from the repo (`layers.ts:105-109`).
    - The build sandbox can't reach `*.virginia.gov` (D37). Railway can.
17. **Trucks** (`/api/fleet/positions` and `/api/fleet/trips`, `server.ts:1540-1570`, "MAP HOOK"):
    - Owner key only. A 401 when there is no `APP_ACCESS_KEY`. Working hours only (`withinWorkingHours()`, 8am–8pm Mon–Sat). Every state has a message (`POSITIONS_SAYS`, `TRIPS_SAYS`).
    - The `unreadable` state still returns the trucks it held (`bouncie.ts:1512`).
    - Motions are `driving`, `parked`, `seen`, `stale`, `unplugged`, `no_fix` and `after_hours` (:1438-1443).
    - `unitsError` names a Fleet-list failure (:1527).
    - The trips route also answers 400 `bad_day`, `bad_truck` or `bad_window`, and 404 `unknown_truck`, each with `error` and `message`. Truck ids change on every restart (:1545-1576).
    - BOUNCIE.md says positions are dropped within a minute of 8 pm.
    - `policyEngine` walls `tracking` off every crew surface.
18. **No crew location source exists.** Mike's position is a ZIP held in memory (`routingHint.ts:104-132`). `location_ping` has 0 rows, and read-only mode refuses writes.
19. **ZIP → city exists** (`serviceCityForZip`, `src/lib/address.ts:173`). It accepts ranges (:162-171), and those ranges include PO-box, unique and unassigned ZIPs. **There is no ZIP centroid table.**
20. **The server doesn't compress responses** (`server.ts` has no gzip), so the sizes below are what the phone downloads.

## Files this plan edits

These are `SLOW::ARBO` files. Read every line of one before editing it.

| File | Change |
|---|---|
| `src/server.ts` | `/map` routes and CSP; `/api/map/today` |
| `src/app/index.html` | Map view, `openMap`, message listener, ↻ hand-off, key getter |
| `src/server/appPage.ts` | `loadMapHtml`, `loadLeafletFile` |
| `src/ops/todayStops.ts` | one method that returns the rows before `strip()` |
| `src/integrations/tomtom.ts` | a read-only `peek(query)` |
| `src/ops/routePlanner.ts` | `export` on `addressOf`, nothing else |
| `src/permitting/gis/layers.ts` | export the DEQ MapServer base; record layer 33's scale and image limits |
| `src/app/sw.js` | `/map` network-first, the two Leaflet files cache-first; `PRECACHE` and `neverCache` unchanged (named in M0; added to this table when M0 was built, D106) |
| `package.json`, `package-lock.json` | `leaflet` 1.9.4 in `dependencies`, exact; the lockfile written by npm (added with M0, D106) |

Not edited:
- `api.ts`, `locationIntel.ts`, `simSource.ts`, `address.ts` and `bouncie.ts`.
- `GeoPoint` (`geocode.ts:52-55`) and `locationIntel.ts:56-70` use `lng`. The map never reads them.

New files: `src/app/map.html`, `src/ops/mapToday.ts`, `src/lib/zipCentroids.ts`, and the tests below.

## M0: the one shared map

### Library: Leaflet 1.9.4, kept in the repo and served by Arbo, on its own page inside the shell

**Why Leaflet:**
- BSD-2-Clause licence, no key, no build step. About 145 KB of JS and 14 KB of CSS (confirm at install).
- Pinch and pan work on an iPhone.
- It has the four things the map needs: a tile layer, an image overlay (for DEQ), markers and polylines.

**How it is served:**
- It goes in `dependencies` (not `devDependencies`), pinned **exactly**: `"leaflet": "1.9.4"`.
- Two exact routes, `/map/leaflet.js` and `/map/leaflet.css`, serve it from `node_modules/leaflet/dist/`, the same way the ElevenLabs widget is served.
- Markers are `L.circleMarker`, or `L.marker` with an `L.divIcon` only. The map never uses Leaflet's default icon or `L.control.layers`. Their images (`marker-icon.png`, `marker-shadow.png`, `layers.png`) would 404 under `/map/`.

**Where it runs:** a new page, `src/app/map.html`, at `/map`. The shell shows it in a new `map` view as a **same-origin iframe**, created the first time Map opens. This is the calendar's own pattern (R2).
- The shell's laws stay as they are: no new host, no `<script src=`, no `innerHTML`.
- The library downloads only when Map opens.
- The dock, ‹ Back and the sheets keep working.
- Taps that open Google Maps still go through the shell's one builder.

**Rejected:**
- **Inlining into `index.html`:** breaks three pins and adds 160 KB to every launch.
- **A separate full page:** loses the dock and Back, and needs a second Maps URL builder.
- **Hand-drawn SVG:** no streets, and about 400 lines of pan and zoom code to maintain.
- **A Google Maps embed:** can't draw Arbo's layers, and needs a key.

### Tiles: OpenStreetMap, straight from the phone, no key (recommended)

- **Source:** `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, credited "© OpenStreetMap contributors".
- **Why:** it works today, with no key and nothing to proxy. One owner's phone is light use.
- **OSM's tile policy is followed in full:**
  - the attribution is visible;
  - there is no bulk or offline prefetch (the service worker skips cross-origin requests);
  - the browser's Referer header stays on (no `no-referrer` on `/map`).
- **What OSM learns** (Q1): which map squares are viewed, down to zoom 18 around a pin, plus the phone's IP and Arbo's address. That reveals which streets were looked at, and when. The map opens on the four-city view and never zooms to pins by itself.
- **Not checked from here:**
  - the current wording of OSM's tile policy (read it before M0 merges);
  - whether the sandbox can reach the tile host.

**TomTom tiles through a server proxy: not built.**
- The key is unconfirmed, so production could end up with no street map at all.
- The key would also have to be switched on for Map Display.
- The key sits in TomTom's tile URL, so every tile would have to pass through Arbo, as with Quo photos. That means a proxy, a tile cache and a second meter on the key.
- It stays the fallback if OSM ever refuses Arbo (Q2).

### Every outside host the phone or server touches

| Host | Asked by | When | What it learns | New? |
|---|---|---|---|---|
| `arbor-server-production.up.railway.app` | phone | always | everything, behind the owner key | no |
| `tile.openstreetmap.org` | phone | each map view | the squares viewed (streets looked at and when), the phone's IP, Arbo's address as Referer | **new** |
| `www.openstreetmap.org` | phone, in a new tab | only if the attribution link is tapped | nothing else | new (a link) |
| `gisdata.deq.virginia.gov` | phone | when Permit areas is on and zoomed in past DEQ's limit | the box viewed and the image size; never an address | **new for the phone** (the server already asks it) |
| `www.google.com` (Maps) | phone | only on "Yes — open Google Maps" | that address, as today | no (R35) |
| `api.tomtom.com` | server | only what the R35 planner already asks | as today (R35 #5) | no; the map adds no lookups |
| `www.googleapis.com` (Calendar) | server | today's events | as today | no (R33) |
| `api.bouncie.dev`, `auth.bouncie.com` | server | trucks, in working hours, once connected | as today | no (R31) |
| `geocoding.geo.census.gov` | server | **not used by the map** (Q4) | — | — |

### One data shape

- **Every point the map reads is `{ lat, lon }`.** Bouncie and TomTom already use `lon`. The map never reads `GeoPoint` or `locationIntel`, which use `lng`.
- **Points are rounded to 5 decimals** and carry a `placedBy`:
  - `tomtom`: an exact pin;
  - `zip`: a hollow, grouped pin, "ZIP area — not the exact spot";
  - `practice`: a fake pin, shown under the practice banner.
- **Map answers are `cache-control: no-store`.** They never go in a log (§4.3), `localStorage` or `sessionStorage`.
- **ZIP centroids:** a new `src/lib/zipCentroids.ts`.
  - It holds only ZIPs that `serviceCityForZip` accepts **and** that appear as a ZCTA (Census ZIP area) in the Census 2020 ZCTA Gazetteer (public domain). The file carries the source URL and the date it was checked.
  - An accepted ZIP with no ZCTA is not given a made-up point. It is listed "ZIP has no map area (PO box or business ZIP) — not on the map". Check at least these against the file: 23450, 23466, 23467, 23471, 23479, 23501, 23506, 23541, 23551, 23326–23328 and 23705.
  - At serve time, an `<!--ARBO:ZIPS-->` marker inlines the table into `map.html`, the same way the sprite is inlined. The DEQ MapServer base and layer 33's limits from `layers.ts` are inlined the same way, so each has one source.

### M0 package (S/M): ships in the same PR as M1, so Mike never sees an empty map

**`package.json` and the lockfile:** `leaflet` 1.9.4 in `dependencies`, exact. Its BSD notice stays in the served file.

**`src/server/appPage.ts`:**
- `loadMapHtml()` inlines the sprite, the ZIP table and the DEQ values.
- `loadLeafletFile(name)` serves exactly `leaflet.js` and `leaflet.css`.

**`src/server.ts`:**
- `GET /map`: `no-store`, carries no data, open like `/app`.
- `GET /map/leaflet.js` and `/map/leaflet.css`: `public, max-age=86400`.
- Anything else under `/map/` is a 404.
- `/map` carries a CSP, so the browser enforces the host list too:

  ```
  default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://gisdata.deq.virginia.gov; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'
  ```

**`src/app/map.html`** (under 30 KB including the ZIP table — review, D106: 40 KB as source after the review's fixes; the inlined sprite, about 12 KB, is unused by the page):
- **View and zoom:**
  - It opens on the four-city view, at zoom 10–18. (Review, D106: zoom 10 cut Virginia Beach off a phone; the floor is now whatever fits the four cities into the map's clear part on that phone, 8 at the least, never above 10.)
  - Panning is limited to the four cities plus every placed pin, padded, so no placed pin is ever out of reach.
- **Chips:** Today · Permit areas · Leads & jobs · Trucks, each 44 px.
  - The choice is remembered on this phone in `arboMapLayers`, inside try/catch.
  - The default is Today.
  - A layer Mike turned off shows only as an unlit chip.
- **Status list** under the chips (R29 #1's feeds card) — review, D106: in a notes card over the top of the map, so the whole map, its attribution and its zoom buttons are on the first screen and the page never scrolls:
  - one line for each layer that is **cut or couldn't be read**, never for one Mike switched off;
  - each line has its own ↻, which re-reads that layer;
  - a legend follows.
- **The key:**
  - It comes from the shell through a same-origin getter, `parent.arboMapKey()`, and is sent as `x-arbor-key`. That works even when the shell holds the key for the visit only.
  - The frame never reads `arborKey` itself.
  - Opened outside the shell, the page says "Open Map from Arbo."
- **Night mode** follows `arboTheme` (in try/catch), and a CSS filter dims the tiles.
- **Text:**
  - `textContent` only.
  - Leaflet's string APIs (`bindPopup`, `bindTooltip`, `divIcon({html})`) get DOM nodes, never strings.
  - The attribution is a constant, with Leaflet's prefix turned off. Its link carries `target="_blank" rel="noopener"`. OSM refuses to be framed, so a plain link would leave Map dead until reload.
  - Every sentence lives in one `MAP_SAYS` table, ready for Spanish later (R27).
- **Messages:**
  - The frame accepts only messages where `e.origin === location.origin` and `e.source === parent`.
  - Types in: `layer` (one of the four names) and `refresh` (review, D106: and `tick`, the shell's minute).
  - On load it posts `ready`.
- **Timing:**
  - Only Trucks has a minute tick. It pauses when the page is hidden or its view isn't active (`frameElement.closest('.view.active')`). (Review, D106: Today also re-reads on the shell's minute — the same minute Calendar's Today's stops reads, sharing one server build — sent as a `tick` message; a map left open overnight showed yesterday as today.)
  - Today, Leads and Permit areas re-read on open, on ↻ and when the view comes back.
- **What it keeps:** only the fields it draws. A lead is reduced to id, name, ZIP, city, age, `older`, emergency and status as soon as it arrives. Phone numbers and details are dropped and never shown.

**`src/app/index.html`** (grows by under 4 KB — review, D106: 4.5 KB after the review's fixes):
- **New view:**
  - `<div id="view-map" class="view">`;
  - `VIEW_TITLES.map = 'Map'`, `NAV_DRAW.map = renderMap`.
- **The iframe:**
  - `renderMap()` creates `<iframe id="map-frame" title="Map" src="/map">` once. A tick never reloads it, the same as `#gcal-frame` (:4064).
- **Choosing a layer:**
  - `openMap(layer)` **posts** `{type:'layer'}` to the frame. If the frame isn't ready yet, the layer is held until the frame posts `ready`.
  - It never sets the frame's hash, which would add a step that Back undoes.
- **Where Map belongs:** `MAP_HOME = { today: 'cal', permits: 'estimate', leads: 'leads', trucks: 'fleet' }`. `openMap` sets `NAV_PARENT.map` and `DOCK_OF.map` from it (Trucks lights `more`). Map from Leads keeps Leads lit, and Back from `#map-leads` returns to Leads.
- **Deep links:** `VIEW_ALIAS` gains `map-today`, `map-permits`, `map-leads` and `map-trucks` → `map`. A `MAP_LAYER_OF` table is read by one line in `startView`, and P19's pins are kept.
- **The key:** `window.arboMapKey = () => KEY`.
- **↻:** when Map is the active view, the shell's ↻ posts `{type:'refresh'}` to the frame.
- **Messages from the frame:** a `message` listener acts only when `e.origin === location.origin` and `e.source === $('map-frame').contentWindow`. It accepts three types:
  - `stop` (strings capped at 300) → `openMapsStop`;
  - `day` → reads `/api/route/today`, then `openMapsDay`;
  - `lead` (an id only) → `openPanel('leads', …)`.

  Anything else is ignored.
- **Swipe-back:** a 16 px strip over the frame's left edge, so the iOS swipe-back (:8581) still starts in the shell.

**`src/app/sw.js`:**
- `PRECACHE` is **unchanged**. `addAll` fails completely if one file fails, and `/crew` phones share the worker.
- `/map` is network-first and cached when used. The Leaflet files are cache-first and cached on first use.
- `neverCache` is unchanged.

**Gaps named in M0 (§1B):**
- **Tiles fail** (three or more errors and none loaded): "Street map didn't load (OpenStreetMap) — pins are still placed; this is not an empty map. ↻"
- **Offline:** "No signal — the street map needs one."
- **No key in the shell:** "Open Arbo and enter the key first." A refused key is named too, never drawn as an empty map.

**Tests first:**
- `test/mapPage.test.ts` scans the **served** `loadMapHtml()` output, so the inlined hosts are included:
  - its hosts are only tile.openstreetmap.org, www.openstreetmap.org and gisdata.deq.virginia.gov;
  - no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`;
  - `bindPopup(`, `bindTooltip(` and `html:` are never given a string or a `+`;
  - every `L.marker(` has an `icon:`, and there is no `L.control.layers`;
  - the attribution link has `target="_blank"` and `rel="noopener"`;
  - no `key=`, no "Suffolk", no "TCIA", nothing matching `/permit[^<]{0,20}clear/i`, and no `MAP_SAYS` string matching `/\bclear(ed)?\b/i` (so `clearLayers` and `clearTimeout` stay legal);
  - `x-arbor-key` is sent, the key comes only from `parent.arboMapKey`, and every storage access is inside try/catch.
- `test/mapRoutes.test.ts` (on the `r25Routes` harness):
  - `/map` answers 200 with that exact CSP;
  - both Leaflet files answer 200;
  - `/map/x` and `/map/leaflet.js.map` answer 404;
  - `/map/../package.json` sent **raw** through `http.request` answers 404 (`fetch` would normalise the path first);
  - the service worker's `PRECACHE` list is unchanged and still never caches `/api/`;
  - `leaflet` is in `dependencies`, at exactly 1.9.4.
- `test/mapShell.test.ts`:
  - `appUi.test.ts` passes unchanged, and so does `directionB_navigate`'s one-builder pin;
  - `VIEW_TITLES` has its `map` entry, and `MAP_HOME` sets `NAV_PARENT`/`DOCK_OF` per layer;
  - `startView('#map-trucks')` lands on Map with Trucks on, and Back goes to Fleet;
  - after `openMap('trucks')` from Calendar, one Back returns to Calendar;
  - only `renderMap` creates the iframe, and only once;
  - ↻ on Map posts `refresh`;
  - the listener, lifted with `pageFn`, opens nothing when sent forged messages: wrong origin, wrong source, an unknown type, an oversized address.
- P1's link table gains `#map` and the four aliases.

## The four maps, in ship order

| Map | Production today (`readonly`) | Practice (`sim`) |
|---|---|---|
| M1 Today + route | Calendar events (R33). Exact pins only for addresses the planner already placed with TomTom. Grouped ZIP-area pins otherwise. Numbered by R35's plan, joined by straight lines | SIM stops at their ZIP centroid, under the practice banner. TomTom is never asked |
| M2 Permit areas | DEQ RPA shading (public, live). City layers, floodplain, Norfolk CRO and reservoir areas named as not drawn | The same public layer |
| M3 Leads & jobs | The `notFed` line, open leads by ZIP area, older ones hidden and counted. Jobs point to Today | SIM leads have no ZIP, and the layer says so. Markers are shown on stubbed answers |
| M4 Crew & trucks | "Bouncie is not set up on the server…" (`keys_missing`) until Mike's steps. Crew: named, no source | The server's own state line; there are no sim truck positions |

### M1 Today's stops + route (M; with M0; first PR)

**What it shows:** today's calendar events that have an address, read the same way Calendar's Today's stops reads them.
- **Exact pins** only where TomTom's day memory already holds the address, because the R35 planner placed it. The map **never asks TomTom itself**. Stops the planner skips (before 4 PM, all-day, ongoing) and every stop without the key get ZIP-area pins (Q3).
- **ZIP-area pins are grouped.** One hollow marker per ZIP area lists its stops in time order, so stops never sit hidden under each other.
- **Numbers:** only when `plan.engine !== null`, following `plan.order`. Pins are joined by straight dashed lines. The legend says: "Order only — straight lines, not roads. Google Maps draws the road."
- **Taps:** a stop opens the shell's "Open in Google Maps?" sheet. "Route the whole day" opens `openMapsDay`.
- **Start and end** are not drawn. The legend names them in words (Q5).
- **Outside the four cities:** an exact pin there is still drawn and the map can still pan to it. Its card says "placed outside the four cities".

**Server:** `GET /api/map/today`, in a new `src/ops/mapToday.ts`.
- **Access:** owner key only; the crew key is refused. With no `APP_ACCESS_KEY` it answers 401 `no_app_key`. Answers are `no-store`.
- **Rows:** one new method beside `todayStops.read()` returns the rows before `strip()`, plus the plan. It shares the same plan memory and in-flight read. Calendar's `/api/route/today` answer stays byte-identical, so R35's "the phone gets what it shows" still holds there.
- **`tomtom.ts` gains `peek(query)`.** It reads the day's memory and never fetches. `routePlanner.ts` exports `addressOf`, so the peek key is the planner's own key.
- **Shape:** `{ state, line, practice, day, dayKind, planLine, engine, tomtomLine, stops: [{ id, n, time, title, city, address, lat, lon, placedBy, why }], notOnMap: [{ id, title, why }], counts }`.

**Gaps named (§1B), in R35's own words where they exist:**
- **Calendar not read:** R35's line, word for word. It points at the Reconnect step, e.g. *"Couldn't read your calendar — Google sign-in needs reconnecting (Settings → Reconnect Google). This is not an empty day."* No pins are drawn.
- **Empty day:** "Nothing on your Google Calendar today." appears only after a good read.
- **Not on the map,** each with its reason:
  - R35's own `why` for no address and no ZIP (e.g. "No ZIP in the address — not in the plan");
  - "ZIP has no map area (PO box or business ZIP)";
  - "ZIP outside the four cities", used only for a ZIP-area pin, never for a stop TomTom placed.
- **TomTom not set or failing:** the plan's own `tomtom.line` (e.g. `TOMTOM_NOT_SET_LINE`), with ZIP-area pins. The key and TomTom URLs never appear.
- **On the map but not in the route** (before 4 PM, ongoing, all day): a ZIP-area pin with no number, with R35's `why` on its card.
- **Sunday:** `SUNDAY_LINE`, word for word, and no numbers.
- **Always shown:** the counts line, e.g. "6 of 8 events on the map · 2 not on the map". A tap lists the missing ones.
- **Practice banner:** "PRACTICE DATA — pins sit in their ZIP area; these are not real places."

**Entry:**
- On Calendar, in the Today's stops header: a **Map** button beside "Route the whole day in Google Maps" (`renderTodayStops`). The calendar frame below is untouched (R2).
- Deep link: `/app#map-today`.

**Tests first:**
- `test/mapToday.test.ts`:
  - every R35 calendar state gives its line and zero pins;
  - the empty-day line appears only after a good read;
  - after a plan, `peek` returns the planner's point and the stop is exact;
  - a stop the planner skips gets a ZIP-area pin, and the fetch spy sees **no** TomTom call from the map;
  - without the key: ZIP-area pins and `TOMTOM_NOT_SET_LINE`;
  - on a 403: the fixed code, with no key or URL in the body or the console;
  - Sunday: `SUNDAY_LINE` and no numbers. `engine: null` means no numbers;
  - two stops in one ZIP give one grouped marker listing both, in order;
  - a TomTom pin outside the four cities is drawn and its reason is never "ZIP outside the four cities";
  - an accepted ZIP with no ZCTA is listed with its reason;
  - in practice, the fetch spy shows no TomTom or Census call;
  - points have 5 decimals, and answers are `no-store`;
  - the crew key and a missing `APP_ACCESS_KEY` are both refused;
  - `/api/route/today` is unchanged.
- Frame helpers, lifted from `map.html`:
  - numbers follow `order`;
  - a pin with `n:null` has no number;
  - lines join numbered pins only;
  - the counts line and the practice banner render;
  - no empty-day line unless `state` is `ok`;
  - the pan limit includes every placed pin.
- `zipCentroids`:
  - every point sits inside the four-city box;
  - every accepted ZIP is either in the table or on the no-area list;
  - the source and date are present.

**Browser:**
- **Sim:**
  - pins are numbered;
  - a tap opens the sheet;
  - Yes is a `www.google.com/maps` link;
  - No, X, Back and the edge swipe all close it.
- **Cut, and read-only with no DB:** the named calendar line.
- **No TomTom key:** grouped hollow pins.
- **After deploy:** Mike's real day, on his iPhone.

### M2 Permit areas (S; second PR)

**Before building:** read layer 33's `minScale`/`maxScale` (`…/MapServer/33?f=json`) and the service's `maxImageWidth`/`maxImageHeight` (`…/MapServer?f=json`). Do it from Railway or a phone, because the sandbox can't reach DEQ (D37). Record the values and the date in `layers.ts` beside `DEQ_CBPA`. M2 does not merge until this is done.

**What it shows:** DEQ's public RPA layer, as translucent shading.
- The phone asks DEQ's MapServer `export` for the box in view. Parameters: `layers=show:33`, `format=png32`, `transparent=true`, `bboxSR=4326`, `imageSR=3857`, `f=image`.
- It also sends **`size` equal to the map's container in pixels times the device pixel ratio**, each side capped at the service maximum. The box and the image then have the same shape, and the shading lands on the right streets.
- It asks only at zoom levels inside layer 33's scale range (from `minScale`), and asks again after each move.
- A new box replaces the old image, so old shading never sits over a new place.

**Legend, exact words:** "Shaded: Resource Protection Area — Virginia DEQ statewide layer 33 (checked 2026-08-01). Not shaded does not mean no permit — VERIFY W/ CITY. Arbo's permit screen checks 300 m around an address, because an address point can sit 150–300 m from a rear-lot buffer. For one address's permit word, use Estimate → prep."
- The permit words (PERMIT LIKELY / REVIEW NEEDED / NO OVERLAY–VERIFY) belong to one address's screen, never to an area.
- The word "clear" never appears.

**Gaps named (§1B):**
- **Outside the layer's scale:** "Zoom in to see RPA areas — DEQ doesn't draw them at this zoom; not drawn is not 'no RPA'."
- **Image failed:** "Couldn't load the DEQ RPA layer just now — this is not 'no RPA here'. ↻"
- **Always listed:** "Not on this map: the Virginia Beach, Norfolk and Chesapeake city RPA layers (found, not verified); Portsmouth (no city layer found); floodplain, Norfolk CRO and reservoir areas (no layer). Missing shading is never a 'no'."
- **Permit records:** "Permit records are cut on purpose (R32) — none are drawn."

**Entry:**
- In Estimate, on the Permit rules header and on the prep's permit result: **RPA areas on the map**. It opens the four-city view (Q11).
- Deep link: `/app#map-permits`.

**Tests first:**
- The export base comes from `layers.ts` (`DEQ_CBPA.url` minus `/33`). The test fails if the two drift apart.
- Only `show:33` is requested, and no candidate-layer URL appears in the served page.
- `size` matches the container times the DPR, capped at the recorded maximum, and the box's shape equals the image's shape.
- The zoom limit comes from the recorded `minScale`.
- An image error shows its line and removes the old overlay.
- The legend has `VERIFY W/ CITY` and no `/\bclear(ed)?\b/i`.
- The request carries only the box and the size: no ZIP, no pin, no address.

**Browser:**
- **In the sandbox:** the export is routed to a fixture PNG, because the sandbox can't reach DEQ (D37). It is blocked once to shoot the named gap.
- **On the phone after deploy:** shading at a public waterfront that is not a customer's property, chosen on the day and lined up against the street map.

### M3 Leads & jobs (S/M; third PR)

**What it shows:** open leads from `/api/leads?limit=50`, the same read the Leads tab makes, grouped **by ZIP area, not by address**.
- **Production first line:** outside practice mode, the layer opens with `notFed`, word for word, so a quiet map is never read as an empty inbox. Where other leads live comes only from `notFed`'s own wording.
- **Older leads:** the server's `older` flag decides (`leadAge.ts`, 14 days). An older lead is never counted as new. "N older leads hidden — Show older" is shown **before** any count or empty line (Q6).
- **Counts:** labelled "open leads" (new, qualified, emergency). When the answer is exactly 50 long, the line says "newest 50 open leads".
- **Markers:** one round marker per ZIP area, e.g. "23508 · Norfolk · 3 open leads, 1 new". Emergency leads are marked the way Leads marks them.
- **Taps:** a tap lists names and ages (`textContent`). Tapping a name opens that lead in Leads. Phone numbers and details are never shown.
- **No new transfers:** no lead address goes anywhere new, and no geocoder is asked.
- **Where the ZIP comes from:** each lead's ZIP and city come from its property record, embedded in the same answer the Leads tab already shows. The property rows are FLAGGED in `DATA_LINKS.md`, and Mike is told (Q15).

**Jobs:** Mike's jobs live on Google Calendar (R2). Today's are on the Today layer.
- The layer says: "Jobs are on your Google Calendar — today's are on the Today layer. Other days aren't on the map yet."
- The map does not read `/api/brief`.
- Arbo's own job and estimate tables are not drawn. In production both are cut (R32): the job table holds the 11 held rows until the R29 delete, and the estimates fall with the cut job query. Named: "Arbo's job and estimate records are cut on purpose (R32) — none drawn; this is not 'no jobs'."
- What "jobs" should mean on the map is Q14.

**Gaps named (§1B):**
- **Leads unread, cut or not set up:** the Leads tab's own feed word. No markers, and never a 0.
- **Not on the map:**
  - "3 leads with no ZIP — not on the map";
  - "2 leads outside the four cities — not on the map";
  - "1 lead's ZIP has no map area".
- **Empty:** an empty line appears only after a good read, and only after the `notFed` and older lines.

**Practice:** every SIM lead has `zip: null`, so the layer truthfully lists them as "no ZIP". `simSource.ts` is not changed, because other screens rely on its shape. Markers are tested and shot on stubbed `/api/leads` answers.

**Entry:**
- In the Leads header (`#leads-head`): a **Map** chip beside the segments.
- Deep link: `/app#map-leads`, which returns to Leads on Back.

**Tests first:**
- ZIP grouping and counts are right, and the "open leads" label is shown.
- An answer of exactly 50 says "newest 50".
- Outside practice, `notFed` is shown word for word, and the older line comes before any empty line.
- `older` leads are not counted as new, are hidden and are counted.
- Leads with no ZIP, outside the four cities, or in a ZIP with no map area are named.
- A failed read never draws a marker.
- The jobs line and the cut line show.
- The fetch spy sees only `/api/leads?limit=50`.
- Leads held in memory carry no phone or details field.
- The `lead` message carries an id only.

**Browser:**
- **Stubbed leads:** markers and lists.
- **Sim:** the no-ZIP line.
- **Read-only with no DB:** the named lines.
- **Widths:** list cards don't overflow at 320 or 390 px.

### M4 Crew & trucks (S/M; fourth PR; dots wait on Mike's Bouncie steps)

**Trucks** come from the MAP HOOK, `GET /api/fleet/positions`, read every minute while the layer is on and visible.
- **Today:** it answers `keys_missing` (`GO_LIVE.md:73`). The layer shows the server's `message` word for word ("Bouncie is not set up on the server — … This is not "no trucks".") and draws nothing.
- **Once connected,** each truck shows its name or the last 4 of its VIN, and "seen N min ago". By motion:
  - `driving`: a solid dot at `positionAt` (never the time of the last report), with its heading;
  - `parked` and `seen`: a solid dot, no heading;
  - `stale`: grey, "last fix 3 h ago — may have moved";
  - `unplugged`: grey, "Bouncie unplugged — last known spot";
  - `no_fix` and `after_hours`: listed, not drawn.
- **`unreadable`:** the server still sends the trucks it held. They are drawn grey as last-known spots, under the server's message ("Bouncie didn't answer just now").
- **Not matched to a Fleet unit** (`equipment_unit` has 0 rows): labelled so. When `unitsError` is set, the layer says "Couldn't read the Fleet list (cut on purpose / couldn't be read) — trucks show by VIN".
- **Dots are dropped:**
  - when a refresh fails or the phone is offline;
  - when the frame comes back from hidden or paused (cleared until a fresh answer arrives);
  - outside 8am–8pm Mon–Sat by the ET clock, even before the server's next answer.
- **Trips:** a truck's card offers **Today's trips**. It draws `/api/fleet/trips?truck=&day=<ET today>`, with at most 2,000 points per path.
  - Every state other than ok uses `TRIPS_SAYS` word for word.
  - A 400 (`bad_day`, `bad_truck`, `bad_window`) shows the server's `message`.
  - A 404 `unknown_truck` (truck ids change on every restart) re-reads positions once and says "The truck list changed — pick the truck again."
- **Already enforced by the server:** owner-only, and 8am–8pm Mon–Sat.
- **On the page:** no position is held once an answer is replaced, and none is stored.

**Crew:** no crew location source exists.
- The layer says: "Crew aren't on the map — Arbo has no crew location. Trucks show where crews drive."
- **Crew-phone location is not built unless Mike signs a ruling first** (Q8; default: not built).
- The crew door gets no map, no `/map` link and no truck read.

**Entry:**
- On Office → Fleet, in the screen's header: **Trucks on the map**.
- Deep link: `/app#map-trucks`, which returns to Fleet on Back.

**Tests first:**
- Each `PositionsState` shows its message word for word. Only `ok` and `unreadable` draw, and `unreadable` draws grey.
- Each motion has its style, and `no_fix` and `after_hours` trucks are not drawn.
- The `unitsError` line shows for `link_cut` and for `unreadable`.
- Dots are dropped after a failed refresh, after a return from hidden, and at 8:00 pm ET.
- Every `TripsState` is named. 400s show `message`, and a 404 re-reads positions once.
- No coordinates in storage or logs.
- The crew key is refused on `/api/map/today`, `/api/fleet/positions` and `/api/fleet/trips`.
- `crew.html` has no `/map` and no `/api/fleet/`.
- `policyEngine`'s wall on `tracking` is unchanged, and there is no crew chip.

**Browser:**
- **Read-only:** the `keys_missing` line.
- **Stubbed positions:** each motion, `unreadable`, after hours, and dots dropping.
- **After Mike connects Bouncie:** real trucks on his phone, in working hours.

## Rules for every package

- **Cycle (CLAUDE.md):** tests first → `npm run check` → adversarial review of the diff → 390×844 screenshots → commit → push → deploy by full SHA. Then check `git_ref`, `db READ-ONLY` and `snapshotId: null`.
- **No new POST.** P1's POST snapshot stays as it is.
- **SLOW files:** read every line of each listed file before editing it. Touch nothing outside the "Files this plan edits" table without adding it there first.
- **Browser harness:** Direction B's (390×844, isMobile, hasTouch, dpr 3, `arborKey` set by `addInitScript`), plus one run with storage blocked.
  - Run in sim, cut, and read-only with no DB, each in light and dark.
  - Route tiles to a fixture PNG, and block them once.
  - Check:
    - `scrollWidth ≤ 390` on the shell and inside the frame;
    - the map is at least 560 px tall (review, D106: all of it on the first screen, the frame above the dock);
    - one Back leaves Map after a layer change;
    - ↻ reaches the frame.
  - After a deploy, relaunch the installed app twice.
- **Docs:**
  - a DECISIONS row per package (D106 onward), with the defaults chosen;
  - a **DRAFT R37** from Mike's words, for him to confirm (as R35 was);
  - an "On the map" section in `ROUTE_PLANNER.md`, and a map note in `BOUNCIE.md`;
  - three GO_LIVE lines, in this order: "map tiles show on the phone", "privacy line OK'd", then "`TOMTOM_API_KEY` on Railway (after the privacy line)";
  - after M4, `ARBO_SPEC.md:186` changes to "owner live map — built (today's stops, permit areas, leads); trucks wait on Mike's Bouncie steps; crew location not built (Q8)".

## Questions for Mike (each has the default the build uses)

1. **Street map from OpenStreetMap?** Your phone asks OSM for map squares. OSM sees which squares you look at, down to street level, plus the phone's IP and Arbo's address. That tells it which streets you looked at, and when, but no name or address. DEQ sees the box you view the same way when Permit areas is on. The map opens on the four-city view and never zooms to a pin by itself.
   - *Default:* yes.
2. **TomTom map tiles instead,** through Arbo's server, once the key is in?
   - *Default:* no. Kept as the fallback if OSM refuses.
3. **Exact pins for stops the route planner skips** (before 4 PM, all-day, ongoing)? Today TomTom gets only the addresses the planner routes. This would send it these other addresses too.
   - *Default:* no. Those get ZIP-area pins. Held until Q12's privacy line is OK'd.
4. **Without TomTom, look up calendar addresses with the free US Census service?** Census already gets addresses from the permit screen. This would send it a new kind of data: your calendar's addresses.
   - *Default:* no. ZIP-area pins instead.
5. **Your home and the route's start and end on the map?**
   - *Default:* not drawn; named in words.
6. **Older leads (14+ days) on the map?**
   - *Default:* hidden and counted, with a Show older button.
7. Two separate decisions:
   - **7a. Exact lead pins** instead of ZIP areas? That needs a new address lookup.
     - *Default:* no. ZIP areas only.
   - **7b. Leads from Gmail and Sona calls on the map?** That means reading Gmail and Quo and placing customers' addresses, which touches R4, §3 and R24.
     - *Default:* not built. Needs your ruling first.
8. **Crew phones: should they report where they are, so crews show on the map?**
   - *Default:* **no — not built.**
   - If yes, you sign a ruling first. It must name:
     - whose phones;
     - working hours only;
     - how each crew member agrees, and how they can see it is on;
     - who sees it (you only);
     - how long it is kept;
     - that R32's no-writes rule is lifted for it.
9. **A Map tile on Today, or a sixth dock tab?**
   - *Default:* neither. Map is one tap from Calendar, Leads and Estimate, and two from Office → Fleet.
10. **Route lines that follow the roads?** TomTom would have to return the road, which changes R35's TomTom request.
    - *Default:* straight lines, showing order only.
11. **Centre the permit map on the address being prepped?** The permit screen would have to keep that point.
    - *Default:* no. It opens on the four-city view.
12. **The privacy page.**
    - *Default:* Claude drafts one line covering the map's hosts (Q1) and TomTom (R35 #5).
    - It goes on `/privacy` only after you OK the wording, and before the TomTom key goes in.
    - The map ships without waiting. It sends no name, address or ZIP anywhere; OSM and DEQ see only which squares are viewed (Q1).
13. **Trips after 8 pm** stay an open R31 item.
    - *Built:* no.
14. **What should "jobs" on the map be?** Calendar jobs on coming days (a wider calendar read, ZIP-area pins), or Arbo's own job table once it holds real jobs?
    - *Default:* neither yet. Today's calendar jobs show on the Today layer.
15. **Lead ZIPs come from the lead's property record.** Those rows are FLAGGED in the data check, and 11 of the 14 FLAGGED properties belong to the held job rows. The Leads tab already shows them. Is it OK to place leads by them?
    - *Default:* yes, labelled "ZIP from the lead's record".

## Risks

- **The iframe:**
  - an iOS swipe that starts on the map pans it (the 16 px strip fixes that);
  - `100dvh` sizing in iOS standalone mode;
  - history: a layer change never touches the frame's URL (postMessage only), and the Back test pins it.
- **OSM may throttle or refuse.** That is named on screen, and Q2 is the fallback. Read OSM's policy before M0 merges.
- **The DEQ export can't be tested from the sandbox** (D37). Its scale and image limits are read on Railway or the phone before M2. Shading is proven on the phone after deploy, and until then its error line is what shows.
- **TomTom:** the map only peeks at the planner's day memory, so it adds no lookups, no cost and no new address transfer. A failing TomTom is retried only by the planner, as today.
- **Coordinates on the phone:** `no-store`, never stored, never logged. The Calendar answer stays free of coordinates. The frame keeps only the lead fields it draws.
- **Leaflet uses `innerHTML` inside its own code.** Arbo's code hands it elements only, and the `mapPage.test.ts` scan enforces that.
- **Test churn:**
  - `appUi` passes unchanged, by design.
  - `directionB_navigate`, P1's link table, `todayStopsUi`, `r25Routes` and the TomTom client tests gain entries.
  - The `sw.js` `PRECACHE` pin is new.
  - Every pin keeps its meaning.
- **Cut is the normal state in production.** Every package is judged in cut and in read-only with no DB, not only in sim. On day one only the DEQ layer shows live data, and Mike is told so up front.

## Critique points not taken

None. All 25 were checked against the code at e4a6415 and taken. For point 5, the plan uses stubbed answers instead of adding sim ZIPs to `simSource.ts`. For point 21, jobs point to Today and the meaning is put to Mike as Q14.
