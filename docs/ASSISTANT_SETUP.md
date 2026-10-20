# Arbo's assistant: setup (R28)

This sets up the "Arbo" business assistant you pasted on 2026-10-20 (a Claude
Managed Agent). It is wired to your Gmail, Google Calendar, Quo, Google Drive and
Square. Your answers that day are ruling R28: *"Make it safe, then set it up."*
You approve the final config before it runs. Nothing turns on until you set
`ARBO_AGENT=live` yourself (step 5).

- **The config to paste:** `agents/arbo/agent.yaml`
- **Your original, kept for the record:** `agents/arbo/original-from-mike.yaml` (do not paste this one)
- **The test that keeps it safe:** `test/assistantConfig.test.ts`

> **Do this first.** Your current Arbo agent has every Gmail, Calendar, Drive and
> Quo tool on "auto". That means it could send email, text customers and delete
> things with nobody checking. Until step 1 replaces it, don't start any sessions
> with it.

## What it does on its own, and what waits for you

| | Runs on its own | Waits for your **Allow** in the Arbo app | Off |
|---|---|---|---|
| **Gmail** | Reading, searching, saving drafts | Sending, replying, forwarding | Deleting, trash, spam, labels |
| **Calendar** | Reading, booking a new time | (nothing) | Editing, moving or deleting an event; answering invites |
| **Drive** | Reading, searching | Creating, renaming or moving, copying a file | Sharing, trashing, viewing permissions |
| **Quo** | Reading texts, calls, transcripts, missed calls, contacts, tasks | Every text, every contact change, note and task | Bulk and group texts, Sona conversations, inbox settings, texting registration |
| **Square** | (nothing) | **Every** Square call, even reads (see note 6) | (nothing) |
| **Web** | Searching and reading pages on the allowed sites (step 3) | (nothing) | Every other site |

These rules are in the **tool settings**, not only in the prompt. A tool that is
off is not available to the agent at all, so no email or web page can talk it
into using one. If Gmail, Calendar, Drive or Quo adds a new tool later, it starts
off.

## Before you start: read the prompt

Open `agents/arbo/agent.yaml` and read the `system:` section. It is your
original prompt in your own words, with your standing rules added: no prices, no
diagnosis, the three permit labels, the R14 business facts, TCPA, the emergency
lines, Spanish crew memos, and "everything waits for Mike". If anything reads
wrong, tell Claude before you go on.

## Step 1: Update your Arbo agent in the Claude Console

1. Open the Claude Console, go to **Agents**, choose **Arbo**, and click **Edit**.
2. Switch to the **Raw** view, select everything, and paste in the whole of
   `agents/arbo/agent.yaml`.
3. Save.

Update the agent you already have. Don't create a new one, so its id stays the
same. Each save makes a new version, and sessions started after the save use it.
If the Console rejects a line, send Claude the exact error. The `user_location`
lines under `web_search` (Virginia Beach, Eastern time) are the only optional
part, and you can delete them if they cause trouble.

## Step 2: Connect the five accounts (a vault)

In the Console, create a **vault** named something like "Arbo: Art-is-Tree
accounts". Add one credential for each account and sign in with the business
account for each. The server address must match exactly, because that is how a
login is matched to its tools:

| Account | Server address |
|---|---|
| Gmail | `https://gmailmcp.googleapis.com/mcp/v1` |
| Google Calendar | `https://calendarmcp.googleapis.com/mcp/v1` |
| Google Drive | `https://drivemcp.googleapis.com/mcp/v1` |
| Quo | `https://mcp.quo.com/mcp` |
| Square | `https://mcp.squareup.com/mcp` |

Logins are only checked when a session runs. A bad one shows up as an error in
the app's Activity list, and the agent carries on without that account. Create
the agent, the vault and the environment in **the same Console workspace** as
the API key Arbo uses.

## Step 3: Create the environment (where the agent works)

In the Console, go to **Environments**, choose **New**, and set:

- **Type:** cloud
- **Networking:** Limited
- **Allow MCP servers:** on (this lets it reach your five accounts)
- **Allow package managers:** off
- **Allowed hosts:** the list below

```json
{
  "type": "cloud",
  "networking": {
    "type": "limited",
    "allow_mcp_servers": true,
    "allow_package_managers": false,
    "allowed_hosts": [
      "weather.gov", "*.weather.gov",
      "virginia.gov", "*.virginia.gov",
      "vbgov.com", "*.vbgov.com",
      "norfolk.gov", "*.norfolk.gov",
      "cityofchesapeake.net", "*.cityofchesapeake.net",
      "portsmouthva.gov", "*.portsmouthva.gov",
      "va811.com", "*.va811.com",
      "dominionenergy.com", "*.dominionenergy.com",
      "osha.gov", "*.osha.gov",
      "isa-arbor.com", "*.isa-arbor.com",
      "tcia.org", "*.tcia.org",
      "baileysonline.com", "*.baileysonline.com",
      "treestuff.com", "*.treestuff.com",
      "sherrilltree.com", "*.sherrilltree.com",
      "forestry-suppliers.com", "*.forestry-suppliers.com",
      "northerntool.com", "*.northerntool.com",
      "tractorsupply.com", "*.tractorsupply.com",
      "homedepot.com", "*.homedepot.com",
      "lowes.com", "*.lowes.com",
      "indeed.com", "*.indeed.com",
      "ziprecruiter.com", "*.ziprecruiter.com"
    ]
  }
}
```

The list covers what you asked it to research:

- weather
- Virginia agencies and code (DEQ for CBPA, VDACS, DPOR)
- the four cities
- VA811 and Dominion
- OSHA, plus ISA and TCIA for the pruning and safety standards they publish (research only; it never claims either)
- tree-gear and hardware suppliers
- two job boards

To add a site, add both `example.com` and `*.example.com`. Remove any you don't
want.

**Why "Limited" matters.** The agent can reach only these sites and your five
accounts. Suppose a hostile email tried to get it to send customer details
somewhere. There would be nowhere to send them. Web search results are limited
to these sites too. Don't switch this to "Unrestricted".

Copy three ids as you go: the **agent id** (`agent_…`), the **environment id**
(`env_…`) and the **vault id** (`vlt_…`).

## Step 4: Put the ids into Railway

On the Arbo service in Railway, set these variables:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Already there for Arbo's section agents. Check that it is set and that it belongs to the same workspace. |
| `ARBO_AGENT_ID` | the agent id (`agent_…`) |
| `ARBO_AGENT_ENVIRONMENT_ID` | the environment id (`env_…`) |
| `ARBO_AGENT_VAULT_ID` | the vault id (`vlt_…`) |
| `ARBO_AGENT_SESSION_BUDGET_USD` | Optional. The most one job may cost, at list prices. The default is **3** ($3). A job that hits it pauses and keeps its work. |
| `ARBO_AGENT` | **Leave it unset for now.** |

Railway stages variable changes, and they take effect on the next deploy.
Deploys stay manual, the way they are now.

## Step 5: Read the prompt, then turn it on

Set `ARBO_AGENT=live` and deploy. It must be exactly `live`. Anything else
leaves the assistant off: blank, `on`, `true`, `LIVE`, or `live` with a space
after it. This is the same rule as the data-link switch.

## How it runs

When a text, email, call transcript or missed call reaches Arbo, Arbo's server
starts a session with your agent and hands it **that one item**. The agent can
read that customer's history. It handles the one item, asks you for anything
that sends or writes, and finishes with a short update for you. It does not
roam the inbox looking for other work.

## What you'll see in the Arbo app

- **Assistant status:**
  - **Off.**
  - **Not set up.** It names the missing Railway variables.
  - **Ready.**
  - **Error.** It says why.

  You also see how many jobs are open and when it last did something.
- **Approvals.** You get one card per waiting action. Each card has a one-line
  summary, for example *Email SIM-Brooks: Your proposal for 14 Simulation Row*,
  and the details you need to decide:
  - **Email:** To, Subject, Body
  - **Square:** Amount, Customer
  - **Text:** Message, Number
  - **Drive:** File, Folder

  **Allow** runs it. **Deny** stops it. Add a note when you deny, and the agent
  gets your note and fixes the draft.
- **Activity.** Newest first: a job started, a tool was used, a job is waiting
  on you, your decision, the agent's update, a job finished, an error. The
  agent's updates reach you here. It does not text or email you. Emergencies
  start with **URGENT: EMERGENCY**, and people who want you personally start
  with **URGENT: CALLBACK**.

## Turning it off

- **Off switch:** set `ARBO_AGENT` to anything except `live` (or delete it) and
  deploy. Arbo stops starting jobs. Anything waiting on your approval just
  waits, because nothing sends without your Allow. While it's off, the app
  doesn't show approvals.
- **Cut one account:** in the Console vault, remove that account's credential.
  You would reconnect it to turn it back on.
- **Don't archive** the agent, the environment or the vault in the Console.
  Archiving is permanent and cannot be undone.

## Things to know

1. **It cannot answer live phone calls.** A hosted agent has no phone line, so
   Sona (Quo) still answers. This agent works afterward from what Sona and
   Quo recorded, and follows up.
2. **The model is Claude Opus 5.5 at medium effort.** Your paste said "low",
   which is a speed setting that suits live calls. This agent now writes
   emails, handles money and books times, so it takes a little more care on
   each step. It's a bit slower and costs a bit more per job. Effort is a
   one-line change.
3. **Calendar bookings run without asking.** You approved booking. The agent
   can't edit, move or delete anything. One gap remains:
   - Google emails an invitation to any guest added to an event.
   - The tool settings can't look inside a booking to stop a guest being added.
   - So "never add guests" is a prompt rule only.

   To make it airtight, change `create_event` to `always_ask` (one line).
   Every booking would then wait for your Allow too.
4. **Allow on a customer text sends it right then.** Check the clock before
   you tap: no customer texts before 8am or after 9pm Eastern.
5. **You see the real email.** The agent is told to put the whole email in the
   send itself. If an approval ever shows only a draft id and not the words,
   deny it.
6. **Square:** every call waits for you, even reads, because Square's tool
   list hasn't been seen yet. After the first session, the Console shows
   Square's tools on the agent. Send Claude that list, and the read-only ones
   (looking up invoices and payments) can be set to run on their own, one line
   each.
7. **Customer details never go into a web search.** Names, numbers, emails and
   addresses stay in your accounts and the Arbo app. A permit question about a
   specific property comes back PERMIT: REVIEW NEEDED for you or the Permit Desk.
8. **Drive's tools can't edit inside an existing file.** They can create, copy,
   rename or move files. So the running logs (complaints, equipment service)
   get one new dated file per entry.
9. **Defaults Claude chose where you didn't say.** Each is a one-line change:
   - Every text waits for your OK, crew texts included.
   - Every Drive write waits for your OK.
   - It never deletes or shares a file.
10. **About the tool names.** They come from Claude's own Gmail, Calendar,
    Drive and Quo connectors, which are the same services. If your Console
    shows a tool under a different name, it is off, which is the safe
    direction. Tell Claude and it gets added.
11. **Your home street is out of the prompt.** The agent doesn't know it, so
    it can't send it to anyone.

## Open question for you

**The 2pm estimate routing is not in.** Your paste said: route estimates from
wherever the crew is at 2pm, back toward home. That was not adopted. Estimates
follow your R14 rules:

- Virginia Beach after 12.
- Norfolk, Chesapeake and Portsmouth in the morning.
- The exact time only on Friday afternoon, once the route is planned.

Do you want the 2pm routing added on top? If so, how should it fit with the
Friday confirmation?
