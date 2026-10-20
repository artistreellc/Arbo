# Bouncie truck tracking — Mike's steps (R31 draft)

Mike, 2026-10-20: *"how do i add the bouncie api keys for live tracking"*,
then *"why dont you build and then i add later"*.

It is built and switched off. Nothing reaches Bouncie, and no truck is shown,
until you do the steps below. You can stop after any step; Settings always
says where things stand.

**No secrets live in this file.** The keys go in Railway variables, named below.

## What it does, and what it never does

- Shows **you** where each truck is: one line per unit on the Fleet card
  (Queue screen), e.g. *Last seen 12 min ago · parked*. The map screen will
  read the same feed later.
- **Owner only.** The crew door never shows it, and the crew key cannot open it.
- **Reads only.** Arbo signs in and reads your vehicles. It never changes
  anything in Bouncie: no geo-zones, no settings, no webhooks set up for you.
- **Memory only.** Arbo keeps the latest position of each truck while it
  runs. There is no history and nothing goes into the database. After a
  deploy the positions come back from Bouncie on the next read.
- The logs show counts only, never a place, a VIN, or a key.

## Part 1 — sign Arbo in (about 10 minutes)

1. Go to **www.bouncie.dev** and sign in with the Bouncie account the trucks are on.
2. Add a new app. Call it **Arbo**.
3. For the **Client ID**, type `arbo`.
4. Add this **Redirect URI** exactly as written. Do not add a slash at the end:
   `https://arbor-server-production.up.railway.app/bouncie/callback`
5. Save. The portal shows a **Client Secret**. Copy it.
6. In Railway, open the Arbo service, then **Variables**. Add:
   - `BOUNCIE_CLIENT_ID` = `arbo`
   - `BOUNCIE_CLIENT_SECRET` = the secret from step 5
7. Deploy. Deploys are manual.

   **What you should see:** in Arbo, tap the gear for Settings, then find
   **Bouncie (truck tracking)**. It says **NOT CONNECTED** and shows a
   **Connect Bouncie** button. (Before step 7 it says **NOT SET UP**.)

8. Tap **Connect Bouncie**. Bouncie's page opens. Sign in and approve Arbo.

   **What you should see:** an Arbo page that says **Bouncie is connected**.
   Tap **Back to the app**. Settings now says **CONNECTED — saved on Arbo's
   storage disk**.

   - If the page says *That sign-in link is not one Arbo is waiting for*,
     more than ten minutes went by, or Arbo was redeployed in between.
     Tap **Connect Bouncie** again.
   - If it says *Bouncie refused the sign-in*, check that the Redirect URI
     in step 4 matches exactly, then tap Connect again.

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
    count shows under **CUT** instead. Arbo answers every update so Bouncie
    keeps sending, but it keeps nothing.
    If it says **WRONG KEY**, the key in Bouncie and in Railway are not the
    same. Fix one of them so they match.

## Part 3 — turn positions on (when you are ready)

14. In Railway → **Variables**, add `ARBO_LINK_BOUNCIE` = `live`. Lowercase,
    no spaces. Anything else leaves it off.
15. Deploy.

    **What you should see:** Settings says **OPEN — Positions on — 3 trucks,
    last report …**. On the Queue screen each Fleet unit gets one line.

For a line to land on the right unit, give the truck the **same name in
Bouncie** as the unit has in Arbo, or make sure the unit's **VIN** in Arbo
matches Bouncie's. A truck Arbo cannot match is listed under *Bouncie trucks
not matched to a unit*. Arbo never guesses between two units with the same name.

## What each line means

| You see | It means |
|---|---|
| Last seen 12 min ago · parked | Bouncie's latest report. The truck is not moving. |
| Driving · last report 2 min ago | A trip is under way and Bouncie is reporting. |
| No Bouncie report since Tue 4:10 PM | Nothing for over a day, or a trip went quiet for 15 minutes. It does not say where the truck is now. |
| Bouncie tracker unplugged since … | The device was pulled from the truck's port. |
| Bouncie has no position for this truck yet | Bouncie knows the truck but has no GPS fix. |
| No Bouncie truck matched to this unit | See the matching note above. |
| Tracking not set up | Part 1, steps 6–7, are not done. |
| Tracking not connected | Part 1, step 8, is not done. |
| Tracking cut on purpose | `ARBO_LINK_BOUNCIE` is not `live`. |
| Tracking stopped — sign-in expired | Tap **Reconnect Bouncie** in Settings. |
| Tracking: couldn't read Bouncie just now | Bouncie did not answer. Arbo tries again within a minute. |
| Bouncie lists no trucks on this account | Bouncie answered and has no vehicles on this account. |

## How to disconnect

- **Stop showing positions now:** in Railway, delete `ARBO_LINK_BOUNCIE` or set it
  to anything other than `live`, then deploy. Arbo reads and keeps nothing.
  Nothing is deleted, and turning it back on is the same one variable.
- **Stop the live updates:** in the Bouncie portal, switch off or delete the
  webhook.
- **Take away Arbo's access completely:** in the Bouncie portal, delete the
  Arbo app, or remove your account from its Users & Devices list. Then
  delete `BOUNCIE_CLIENT_ID`, `BOUNCIE_CLIENT_SECRET` and `BOUNCIE_WEBHOOK_KEY`
  in Railway and deploy. Settings says **NOT SET UP**. The old sign-in file
  stays on Arbo's storage disk as `bouncie-token.json`, but it no longer
  works once the app is gone from Bouncie.

## Good to know

- You can connect while positions are still cut. Arbo only saves the sign-in.
- Bouncie's sign-in expires if it is not used for a while. Arbo only uses it
  while positions are on. If you connect and then leave positions cut for a
  long time, Settings may say **EXPIRED** when you turn them on. Tap
  **Reconnect Bouncie**.
- The sign-in is saved on Arbo's storage disk, so it survives deploys. If
  Settings ever says *held in memory only*, the disk is missing, and you
  will need to connect again after the next restart.

## Waiting on Mike (flagged, not decided)

1. **The ruling.** Record "why dont you build and then i add later" as R31,
   with `ARBO_LINK_BOUNCIE` as your own switch? (Draft in `docs/OWNER_RULINGS.md`.)
2. **Hours.** Arbo only takes the office phone's location 8am–8pm, Monday
   to Saturday (`src/ops/locationIntel.ts`). Should truck positions follow
   the same hours, or show around the clock? Today they show whenever
   Bouncie reports.
3. **Keeping the sign-in alive.** Should Arbo refresh the Bouncie sign-in
   once a day even while positions are cut, so it never lapses? Today it does not.
