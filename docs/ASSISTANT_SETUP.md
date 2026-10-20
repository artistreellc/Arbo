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
| **Gmail** | Reading, searching, saving a new draft | Sending, replying, forwarding | Changing an existing draft (yours included), deleting, trash, spam, labels |
| **Calendar** | Reading | Booking a new time — each one (your answer: "Each booking waits for my OK") | Editing, moving or deleting an event; answering invites |
| **Drive** | Reading, searching | Creating, renaming or moving, copying a file | Sharing, trashing, viewing permissions |
| **Quo** | Reading texts, calls, transcripts, missed calls, contacts, tasks | Every text, every contact change, note and task | Bulk and group texts, Sona conversations, inbox settings, texting registration |
| **Square** | (nothing) | **Every** Square call, even reads (see note 7) | (nothing) |
| **Web** | Searching and reading pages on the listed sites (step 3) | (nothing) | Every other site |

These rules are in the **tool settings**, not only in the prompt. A tool that is
off is not available to the agent at all, so no email or web page can talk it
into using one. If Gmail, Calendar, Drive or Quo adds a new tool later, it starts
off. Web search and web page reads carry the same site list as the environment
in their own settings, so they stay on those sites either way.

## Before you start: read the prompt

Open `agents/arbo/agent.yaml` and read the `system:` section. It is your
original prompt in your own words, with your standing rules added: no prices, no
diagnosis, the three permit labels, the R14 business facts, TCPA, the emergency
lines, Spanish crew memos, and "everything waits for Mike". Four lines of your
paste are out on purpose: the voice line (note 2), telling customers the $500
minimum, your home street (note 13) and the 2pm routing (the open question at
the end). If anything reads wrong, tell Claude before you go on.

## Step 1: Update your Arbo agent in the Claude Console

1. Open the Claude Console, go to **Agents**, choose **Arbo**, and click **Edit**.
2. Switch to the **Raw** view, select everything, and paste in the whole of
   `agents/arbo/agent.yaml`.
3. Save.

Update the agent you already have. Don't create a new one, so its id stays the
same. Each save makes a new version, and sessions started after the save use it.
If the Console rejects a line, send Claude the exact error. The `user_location`
lines under `web_search` (Virginia Beach, Eastern time) are the only optional
part, and you can delete them if they cause trouble. If it rejects one of the
`allowed_domains` sites (the error names it), send Claude the error: that site
comes out of both lists, the tools' and the environment's, together.

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

The same sites (without the `*.` lines) are in `agents/arbo/agent.yaml` as the
web tools' `allowed_domains`, and a test keeps the two lists the same. To add a
site, ask Claude: it goes in both places at once.

**Why "Limited" matters.** The agent's sandbox, its web searches and its page
reads can reach only these sites and your five accounts. Every email, text,
calendar booking and Drive write waits for your Allow, and its card shows you
where it goes. A calendar guest would get an invitation email from Google, so a
guest is named first and loudly on the card. Arbo also reads this environment
back before it starts anything: if it is not Limited (or Arbo cannot read it),
the app says so by name and nothing starts. Don't switch this to "Unrestricted".

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
| `ARBO_AGENT_CREW_NUMBERS` | Optional. Your crew phones, separated by commas (any format, e.g. `757-555-0101, 757-555-0102`). A text to one of these is not held by the 8am–9pm quiet hours (note 5). Leave it blank and every early or late text waits until 8am — the 6:30 crew texts included. |
| `ARBO_AGENT` | **Leave it unset for now.** |

Railway stages variable changes, and they take effect on the next deploy.
Deploys stay manual, the way they are now.

## Step 5: Read the prompt, then turn it on

Set `ARBO_AGENT=live` and deploy. It must be exactly `live`. Anything else
leaves the assistant off: blank, `on`, `true`, `LIVE`, or `live` with a space
after it. This is the same rule as the data-link switch.

## How it runs

Arbo's server starts every session. There are exactly four kinds, and the
agent's prompt names the same four — nothing else starts it:

1. **Quo:** Each Quo text, missed call and finished call starts its own session.
   One session per text or call; an incoming call only (your own calls back start
   nothing). The agent can read that customer's history, handles that one item,
   asks you for anything that sends or writes, and finishes with a short update.
2. **Gmail:** every 30 minutes from 7am to 9pm Eastern, a Gmail sweep asks the
   agent to work the emails that arrived in the last window, website form emails
   included, each as its own item. Quo texts and calls are not part of the sweep.
3. **Crew summaries:** at 6:30am Eastern, each crew's route for the day, drafted
   as texts that wait for your OK.
4. **The daily office check** (your answer, 2026-10-20: *"One daily office
   check"*): at 7am Eastern, Monday to Saturday — never Sunday — weather for
   today's and tomorrow's jobs, invoices unpaid past their terms, equipment due
   for service, and anything waiting on you. It reports in the app: Today shows
   where it stands (running, done, or that it could not run) and, once it is
   done, its report in its own words; the report is in Activity too. Anything it wants to send still waits for your OK. It has no
   switch of its own: it runs whenever `ARBO_AGENT` is `live`. If Arbo was off or
   down between 7 and 10am, Today says the check did not run that day.

## What you'll see in the Arbo app

- **Assistant status:**
  - **Off.**
  - **Not set up.** It names the missing Railway variables.
  - **Ready.**
  - **Error.** It says why: Anthropic refused, the environment is not Limited
    (or could not be read), or Arbo lost touch with a session and is still
    trying.

  You also see how many jobs are open, when it last did something, and where
  today's office check stands.
- **Approvals.** You get one card per waiting action. Each card has a one-line
  summary, for example *Email SIM-Brooks: Your proposal for 14 Simulation Row*,
  and the details you need to decide:
  - **Email:** To, Subject, Body
  - **Square:** Amount, Customer
  - **Text:** Message, Number
  - **Drive:** File, Folder
  - **Calendar:** Title, Start, End, Where — and any guest, first and loudly

  **Allow** runs it. **Deny** stops it. Add a note when you deny, and the agent
  gets your note and fixes the draft.
- **Activity.** Newest first: a job started, a tool was used, a job is waiting
  on you, your decision, the agent's update, a job finished, an error. The
  agent's updates reach you here — the office check's report too. It does not
  text or email you. Emergencies start with **URGENT: EMERGENCY**, and people
  who want you personally start with **URGENT: CALLBACK**.

## Turning it off

- **Off switch:** set `ARBO_AGENT` to anything except `live` (or delete it) and
  deploy. Arbo stops starting jobs, the office check included. Anything waiting
  on your approval just waits, because nothing sends without your Allow. While
  it's off, the app doesn't show approvals.
- **Cut one account:** in the Console vault, remove that account's credential.
  You would reconnect it to turn it back on.
- **Don't archive** the agent, the environment or the vault in the Console.
  Archiving is permanent and cannot be undone.

## Things to know

1. **It cannot answer live phone calls.** A hosted agent has no phone line, so
   Sona (Quo) still answers. This agent works afterward from what Sona and
   Quo recorded, and follows up.
2. **This agent has no voice.** Your paste said you could talk to it hands-free
   while driving. A hosted agent can't hear or speak, so that line is out. The
   Talk button at the top of every Arbo screen (R30, read-only) is the hands-free
   path: it reads you what needs you and answers your questions out loud. Talk
   does not read these approvals out yet; that would be one more Talk tool, on
   your word.
3. **The model is Claude Opus 5.5 at medium effort.** Your paste said "low",
   which is a speed setting that suits live calls. This agent now writes
   emails, handles money and books times, so it takes a little more care on
   each step. It's a bit slower and costs a bit more per job. Effort is a
   one-line change.
4. **Every calendar booking waits for your Allow** (your answer, 2026-10-20:
   *"Each booking waits for my OK"*). Google emails an invitation to any guest
   added to an event, so a card names any guest first, loudly; the agent's rule
   is no guests. It can't edit, move or delete anything. An estimate is booked
   as a hold titled "Arbo HOLD (unconfirmed, Mike confirms Friday): …" whose
   description starts "UNCONFIRMED - Mike confirms the time." (R18, R14).
5. **Quiet hours: Arbo refuses your Allow on a customer text before 8am or after
   9pm Eastern.** The card stays and nothing is sent; allow it after 8, or deny
   it. Two kinds are not held: a reply, within the hour, to the customer whose
   own text or call started that job, and a text to a number in
   `ARBO_AGENT_CREW_NUMBERS` (step 4). A reply to someone who texted hours
   earlier waits until 8, like any other text.
   A text the agent starts — an offer, a review request, an invoice reminder —
   names Art-is-Tree and ends with "Reply STOP to opt out." That is a prompt
   rule; the card shows you the words before it goes.
6. **You see the real email.** The agent puts the whole email in the send
   itself. A send by draft id never reaches you: Gmail would send the saved
   draft as it is and ignore the words on the card, so Arbo refuses it at once,
   tells the agent why, and names it in Activity. The agent can save a new draft
   but cannot change an existing one, yours included.
7. **Square:** every call waits for you, even reads, because Square's tool
   list hasn't been seen yet. After the first session, the Console shows
   Square's tools on the agent. Send Claude that list, and the read-only ones
   (looking up invoices and payments) can be set to run on their own, one line
   each. Until then, the 7am office check asks you to allow each Square lookup
   before it can list unpaid invoices. A Square call with no amount in it (a lookup, sending an invoice) says
   "no amount in this request" with a warning. Every Square Allow takes two
   taps, the second a moment after the first, so a bump never charges.
8. **Customer details never go into a web search.** Names, numbers, emails and
   addresses stay in your accounts and the Arbo app. A permit question about a
   specific property comes back PERMIT: REVIEW NEEDED for you or the Permit Desk.
9. **Drive's tools can't edit inside an existing file.** They can create, copy,
   rename or move files. So the running logs (complaints, equipment service)
   get one new dated file per entry.
10. **Not running: seasonal and storm outreach, staffing flags and supplier price
    comparisons.** Nothing starts these and the app has no box to ask for one, so
    the agent is told not to start them on its own. No storm offer from Arbo does
    not mean nobody needs one. Keep doing these yourself until you say how you
    want them run.
11. **If Arbo loses touch with a job** (an outage at Anthropic or Railway), it
    keeps trying every minute and the status says so; the job is never dropped,
    and anything it asks for shows up once Arbo reconnects. A job that hits its
    budget is paused, not finished: raise the budget in the Console and it picks
    up where it stopped, still watched.
12. **Defaults Claude chose where you didn't say.** Each is a one-line change:
    - Every text waits for your OK, crew texts included.
    - Every Drive write waits for your OK.
    - It never deletes or shares a file.
    - The office check runs at 7am Eastern, Monday to Saturday.
13. **Your home street is out of the prompt.** The agent doesn't know it, so
    it can't send it to anyone.
14. **About the tool names.** They come from Claude's own Gmail, Calendar,
    Drive and Quo connectors, which are the same services. If your Console
    shows a tool under a different name, it is off, which is the safe
    direction. Tell Claude and it gets added.

## Open question for you

**The 2pm estimate routing is not in.** Your paste said: route estimates from
wherever the crew is at 2pm, back toward home. That was not adopted. Estimates
follow your R14 rules:

- Virginia Beach after 12.
- Norfolk, Chesapeake and Portsmouth in the morning.
- The exact time only on Friday afternoon, once the route is planned.

Do you want the 2pm routing added on top? If so, how should it fit with the
Friday confirmation?
