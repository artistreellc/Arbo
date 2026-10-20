# Bouncie truck tracking — Mike's steps (R31)

Mike, 2026-10-20: *"how do i add the bouncie api keys for live tracking"*,
then *"why dont you build and then i add later"* — and the same day, his
spec: Client ID `arbo-app`, the Redirect URI below, the tokens kept
server-side in Supabase, a token refresh and a read-only pull of vehicles
and trips, and location for him only, in working hours only (R31, amended).

It is built and switched off. Nothing reaches Bouncie, and no truck is shown,
until you do the steps below. You can stop after any step; Settings always
says where things stand.

**No secrets live in this file.** The keys go in Railway variables, named below.

## What it does, and what it never does

- Shows **you** where each truck is: one line per unit on the Fleet card
  (Queue screen), e.g. *Last seen 12 min ago · parked*. The map screen will
  read the same feed later, and a truck's trips for a day
  (`/api/fleet/trips`).
- **Owner only.** The crew door never shows it, and the crew key cannot open it.
- **Working hours only: 8am–8pm, Monday to Saturday** — the same hours as
  the office phone's location (`src/ops/locationIntel.ts`). Outside them
  Arbo reads nothing from Bouncie and holds no position (what it held is
  dropped within a minute of 8pm, whether or not anyone has the app open);
  the Fleet line says *After hours — not tracking*. A report stamped after hours is never kept or
  shown, even if it arrives the next morning.
- **Reads only.** Arbo signs in and reads your vehicles and their trips. It
  never changes anything in Bouncie: no geo-zones, no settings, no webhooks
  set up for you.
- **Positions in memory only.** Arbo keeps the latest position of each truck
  while it runs. There is no history. After a deploy the positions come back
  from Bouncie on the next read.
- **The sign-in is kept in Supabase, sealed** — once you open its own
  switch (Part 0; until then Arbo touches nothing in Supabase). One row in one table
  (`integration_credential`), encrypted with a key made from your
  `BOUNCIE_CLIENT_SECRET`, so the database alone cannot open it. It holds the
  sign-in only — no customer, job or truck position.
- The logs show counts only, never a place, a VIN, or a key.

## Part 0 — where the sign-in is kept (once, before Part 1 step 8)

Your spec says to keep the tokens in Supabase; §3 keeps every Supabase link
cut until the app is built. Those two met here, so it was **your call** — and
you made it on 2026-10-20: *"Yes, allow the sign-in row."* The sealed
sign-in row is the one exception to the cut; the business data links stay
cut. Until both steps below are done, Settings names which one is missing
and **Connect Bouncie** refuses, so no sign-in is ever lost.

- **The table.** `supabase/migrations/0021_integration_credential.sql` —
  applied live 2026-10-20 on your go, and checked: RLS on, no policies, no
  access for anon or signed-in users, 0 rows. (If it ever went missing,
  Settings would say *the sign-in table isn't in Supabase (migration 0021
  not applied)*.)
- **The switch.** `ARBO_LINK_CREDENTIALS` = `live` (lowercase, no spaces) in
  Railway → **Variables** — set at the deploy that ships this. It opens that
  one table and nothing else — not the data links, not the agent sweeps.
  Until it is set, Arbo sends **nothing** to Supabase for the sign-in, not
  even a read, and Settings says **CUT** (grey: off on purpose).

## Part 1 — sign Arbo in (about 10 minutes)

1. Go to **www.bouncie.dev** and sign in with the Bouncie account the trucks are on.
2. Add a new app. Call it **Arbo**.
3. For the **Client ID**, type `arbo-app`.
4. Add this **Redirect URI** exactly as written. Do not add a slash at the end:
   `https://arbor-server-production.up.railway.app/api/bouncie/callback`
5. Save. The portal shows a **Client Secret**. Copy it.
6. In Railway, open the Arbo service, then **Variables**. Add:
   - `BOUNCIE_CLIENT_ID` = `arbo-app`
   - `BOUNCIE_CLIENT_SECRET` = the secret from step 5
7. Deploy. Deploys are manual.

   **What you should see:** in Arbo, tap the gear for Settings, then find
   **Bouncie (truck tracking)**. It says **NOT CONNECTED** and shows a
   **Connect Bouncie** button. (Before step 7 it says **NOT SET UP**; before
   Part 0 it says **CUT** — `ARBO_LINK_CREDENTIALS` — or **NOT SET UP —
   migration 0021 not applied**.)

8. Tap **Connect Bouncie**. Bouncie's page opens. Sign in and approve Arbo.

   **What you should see:** an Arbo page that says **Bouncie is connected**.
   Tap **Back to the app**. Settings now says **CONNECTED — saved in
   Supabase, sealed**.

   - If the page says *That sign-in link is not one Arbo is waiting for*,
     more than ten minutes went by, or Arbo was redeployed in between.
     Tap **Connect Bouncie** again.
   - If it says *Bouncie refused the sign-in* (*Bouncie said no*), check that
     `BOUNCIE_CLIENT_SECRET` on Railway matches the portal's Client Secret
     exactly — no space before or after — deploy if you changed it, then tap
     Connect again. (A wrong Redirect URI shows its error on Bouncie's own
     page instead, before you ever get back to Arbo.)
   - If it says *Bouncie said yes, but Arbo couldn't save the sign-in*, the
     page names why (Supabase not reachable, or its key refused). Nothing was
     kept; fix that and tap Connect again.
   - If it says *This sign-in address has moved*, the portal still has the
     first build's address (`/bouncie/callback`). Change it to the one in
     step 4.

### About `BOUNCIE_API_KEY`

You told Claude where it came from (2026-10-20): the portal's **Users &
Devices → Authorize My Devices** — the per-user Authorization Code. Arbo
does not need it. **Connect Bouncie** gets its own fresh code each time you
approve, and a Connect in the browser makes the portal's code stop working
anyway. So Arbo only notes whether `BOUNCIE_API_KEY` is set — its value is
never read, sent or logged — and Settings says **NOT NEEDED**: *Not needed —
Connect Bouncie gets its own code. You can delete BOUNCIE_API_KEY from
Railway.* You can delete `BOUNCIE_API_KEY` from Railway whenever you like;
nothing changes when you do.

## Part 2 — live updates from the trucks (the webhook)

Do the Railway part **first**. If Bouncie starts sending before Arbo has the
key, Arbo has to refuse, and Bouncie may switch the webhook off after enough
refusals.

9. Make up a key: a long phrase only you know, letters and numbers, at least
   20 characters. Write it down for step 12.
10. In Railway → **Variables**, add `BOUNCIE_WEBHOOK_KEY` = that key.
11. Deploy.

    **What you should see:** Settings → Bouncie shows *Live updates* as
    **PENDING**, with the webhook address under it.

12. Back in the Bouncie portal, open the Arbo app and add a **webhook**:
    - **URL:** `https://arbor-server-production.up.railway.app/webhooks/bouncie`
    - **Key:** the same key from step 9, exactly
    - **Events to tick:** Trip Start, Trip Data, Trip End, Device Connect,
      Device Disconnect, MIL, Low Battery. *Trip Metrics* is optional; it adds
      the last trip's miles and minutes.
13. Save it.

    **What you should see:** after the next trip, *Live updates* says
    **WIRED** with a count. While positions are still cut (Part 3), the
    count shows under **CUT** instead, and if the Part 1 keys are missing it
    shows as **DROPPED**. Updates that arrive after hours show as
    **AFTER HOURS**. Arbo answers every update so Bouncie keeps sending, but
    it keeps nothing it shouldn't.
    If it says **WRONG KEY** — refused calls *and no updates arriving* — the
    key in Bouncie and in Railway are not the same. Fix one of them so they
    match. **REFUSED** is different: the webhook address is public, so anyone
    can knock on it, and Arbo turns them away. While Bouncie's own updates
    keep getting through, there is nothing to change.

## Part 3 — turn positions on (when you are ready)

14. In Railway → **Variables**, add `ARBO_LINK_BOUNCIE` = `live`. Lowercase,
    no spaces. Anything else leaves it off.
15. Deploy.

    **What you should see:** Settings says **OPEN — Positions on — 3 trucks,
    last report …** (or **AFTER HOURS** outside 8am–8pm, Monday to
    Saturday). On the Queue screen each Fleet unit gets one line.

For a line to land on the right unit, give the truck the **same name in
Bouncie** as the unit has in Arbo, or make sure the unit's **VIN** in Arbo
matches Bouncie's. A truck Arbo cannot match is listed under *Bouncie trucks
not matched to a unit*. Arbo never guesses between two units with the same name,
and never pairs on a name when the unit's VIN and Bouncie's VIN are different.

## What each line means

| You see | It means |
|---|---|
| Last seen 12 min ago · parked | The truck's last GPS position is 12 minutes old. The truck is not moving. |
| Driving · last report 2 min ago | A trip is under way, Bouncie is reporting, and its position is under 15 minutes old. |
| No Bouncie report since Tue 4:10 PM | Nothing for over a day, or a trip went quiet for 15 minutes. It does not say where the truck is now. |
| No Bouncie position since Tue 4:10 PM · last report 1 min ago | Bouncie is still reporting (a trip start, a battery reading), but its last GPS position is old. It does not say where the truck is now. |
| Bouncie tracker unplugged since … | The device was pulled from the truck's port. |
| Bouncie has no position for this truck yet | Bouncie knows the truck but has no GPS fix. |
| Last report was after hours — not shown | The truck's newest report was after 8pm (or on Sunday). Where it went then is not shown; it reappears once it reports in working hours. |
| No Bouncie truck matched to this unit | See the matching note above. |
| After hours — not tracking | Outside 8am–8pm, Monday to Saturday. Arbo reads and keeps nothing until 8am on the next working day. |
| Tracking not set up | Part 1, steps 6–7, are not done. |
| Tracking not connected | Part 1, step 8, is not done. |
| Tracking off — the saved Bouncie sign-in is cut on purpose | `ARBO_LINK_CREDENTIALS` is not `live` (Part 0). Grey: off by choice, not a fault. |
| Tracking stopped — Arbo can't open the saved Bouncie sign-in | Settings → Bouncie says why: the sign-in table is missing (Part 0), Supabase didn't answer, or `BOUNCIE_CLIENT_SECRET` changed (**LOCKED** — tap **Reconnect Bouncie**). |
| Tracking cut on purpose | `ARBO_LINK_BOUNCIE` is not `live`. |
| Tracking stopped — sign-in expired | Tap **Reconnect Bouncie** in Settings. |
| Tracking: couldn't read Bouncie just now | Bouncie did not answer. Arbo tries again within a minute. |
| Tracking locked — APP_ACCESS_KEY isn't set | Truck positions are owner-only, so they stay locked until `APP_ACCESS_KEY` is on Railway. |
| Bouncie lists no trucks on this account | Bouncie answered and has no vehicles on this account. |

## Trips (for the map screen)

`GET /api/fleet/trips?truck=<id>&day=YYYY-MM-DD`, owner key only. `truck` is
the id `/api/fleet/positions` gives for a truck (never the device number, so
nothing identifying lands in a request log). Arbo asks Bouncie only for that
day's working hours, keeps only trips that start and end inside them, and
reads nothing at all after hours or on a Sunday — each of those is a named
answer, never "no trips". At most one read a minute per truck and day.

## How to disconnect

- **Stop showing positions now:** in Railway, delete `ARBO_LINK_BOUNCIE` or set it
  to anything other than `live`, then deploy. Arbo reads and keeps nothing.
  Nothing is deleted, and turning it back on is the same one variable.
- **Stop the live updates:** in the Bouncie portal, switch off or delete the
  webhook.
- **Take away Arbo's access completely:** in the Bouncie portal, delete the
  Arbo app, or remove your account from its Users & Devices list. Then
  delete `BOUNCIE_CLIENT_ID`, `BOUNCIE_CLIENT_SECRET` and `BOUNCIE_WEBHOOK_KEY`
  in Railway and deploy. Settings says **NOT SET UP**. The sealed sign-in row
  stays in Supabase (`integration_credential`), but it no longer works once
  the app is gone from Bouncie, and without the client secret it cannot be
  opened.

## Good to know

- You can connect while positions are still cut. Arbo only saves the sign-in.
- **Arbo keeps the sign-in alive** (you, 2026-10-20: *"Keep the sign-in
  alive"*). Bouncie's sign-in expires if it is not used for a while — its
  docs say "after some time if not used" but not how long — and positions
  use it only in working hours, so it would sit unused every night and for
  36 hours every weekend (Saturday 8pm to Monday 8am). So once a day,
  whatever the hour — nights and Sunday too, and while positions are cut —
  Arbo renews the sign-in when its last renewal is **20 hours** old. That
  renewal swaps the refresh token for a new pair and saves it in Supabase,
  sealed; it reads **no** truck, trip or position. It never runs while
  `ARBO_LINK_CREDENTIALS` is cut or Bouncie isn't connected. If a renewal
  fails (Bouncie didn't answer), Settings says **NOT RENEWED** — *couldn't
  renew the sign-in at* the time — and offers **Reconnect Bouncie**; Arbo
  tries again within the hour (never more often). Tap Reconnect if it keeps
  failing. If Bouncie refuses it outright, Settings says **EXPIRED**.
- Bouncie gives a new refresh token every time Arbo renews the sign-in, and
  the old one stops working. Arbo saves the new one in Supabase **before**
  using it. If Supabase won't take it, Settings says **NOT SAVED**: Arbo holds
  it unused and tries again every minute, day or night; if Arbo restarts
  before it is saved, tap **Reconnect Bouncie**.
- If Bouncie refuses a renewal because another Arbo (the old one, during a
  deploy) already renewed it, Arbo takes the newer saved sign-in — at once if
  it is there, or within a minute once it is saved. It says **EXPIRED** only
  when Supabase was read and holds nothing newer; a Supabase it couldn't read
  is **UNREADABLE**, not **EXPIRED**.
- If you ever change `BOUNCIE_CLIENT_SECRET`, the saved sign-in can no longer
  be opened (it was sealed with the old one). Settings says **LOCKED**; tap
  **Reconnect Bouncie**.
- The first build kept the sign-in on Arbo's storage disk
  (`bouncie-token.json`). If one is there, Arbo moves it into Supabase once —
  saved first, then removed from the disk — and never writes the disk again.
  In practice mode (`ARBO_DATA_LINKS=sim`, which opens no database at all)
  the sign-in stays on the disk, and Settings says so.

## Waiting on Mike (defaults in place until he says otherwise)

The ruling is filed as **R31** in `docs/OWNER_RULINGS.md` ("why dont you build
and then i add later"), amended by his spec of 2026-10-20, with
`ARBO_LINK_BOUNCIE` as Mike's own switch.

1. **Hours.** *Answered by the spec:* positions and trips follow the office
   phone's hours, 8am–8pm, Monday to Saturday.
2. **Keeping the sign-in alive.** *Answered (2026-10-20: "Keep the sign-in
   alive"):* built — a daily renewal, whatever the hour, that swaps the
   refresh token and reads nothing else (*Good to know*, above).
3. **Migration 0021.** *Answered ("Yes, allow the sign-in row"):* applied
   live 2026-10-20 and checked.
4. **`BOUNCIE_API_KEY`.** *Answered:* the portal's Users & Devices →
   Authorize My Devices code. Not needed; you can delete it from Railway.
5. **Trips after 8pm.** Built: Arbo reads no trips after hours, not even the
   day's earlier ones. Say if you want to review the day's trips in the
   evening.
6. **Supabase and the cut data links.** *Answered (2026-10-20: "Yes, allow
   the sign-in row"):* the sealed sign-in row is the one exception to the
   cut. `ARBO_LINK_CREDENTIALS` = `live` is set at deploy and opens the
   sign-in table only; the business data links stay cut.
7. **What Arbo still says about after hours.** No place, no path, and not
   the minute an after-hours update came. Two things remain: a truck whose
   newest report was after hours reads *Last report was after hours — not
   shown*, and Settings' webhook check shows when Bouncie's last update of
   any kind arrived (after hours included) to tell a wrong key from a
   stranger knocking. Say if either is more than you want Arbo to show.
