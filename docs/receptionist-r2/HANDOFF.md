# ARBO RECEPTIONIST — SESSION HANDOFF (2026-08-03)

**For: Claude Code (or any next session). From: Cowork session, stopped deliberately by Mike mid-build.**

---

## 0. READ FIRST — authority and rules

1. `Arbo_Master_Build_Brief.md` (the live 56-page brief, in the Arbo project) **wins on any conflict** with this file. This file is session state, not spec.
2. Everything here is an **ADD-ON**. Do not rewrite, restate, or duplicate brief sections. Follow the reconciliation protocol in `ARBO_CLAUDE_CODE_KICKOFF` before writing anything into the brief.
3. Guardrails that must survive every future change: **no pricing logic anywhere, ever** (Golden Rule 1); **booking records a request, never a confirmed time** (Mike confirms); **service area validated in code** (Virginia Beach, Norfolk, Chesapeake, Portsmouth only); **emergencies are their own path**, never a normal estimate; **every call leaves a record** (silence is never success).
4. Before ANY `npm run agent:push -- --yes`, run `npm run agent:pull` first and diff. The repo prompt matched live at handoff time — do not blind-push over newer live changes.

## 1. WHAT EXISTS RIGHT NOW

### A. The live ElevenLabs agent (dialed in, working, callable via web)
- **Agent:** `ARBOR — Art-is-Tree Receptionist`, id `agent_1901kyyxyj2sf9nsx9jascy2ssxj`
- **Version after this session's patch:** `agtvrsn_3901kz2pgc2gewg83b0ft5d912z7` (updated 2026-08-03)
- Full config snapshot: `agent/agent.config.json`. Prompt (matches live): `agent/prompt/system-prompt.md`.
- A second stub agent **"My Agent"** (`agent_2701kyyx99g3ew38qxrp63cwmqv9`) sits in the workspace untouched — candidate for archiving, Mike hasn't ruled.

### B. This repo (`arbo-receptionist/`) — the base code layer
TypeScript/Express. Typechecked, smoke-tested (health, out-of-area rejection, booking, emergency paths all pass). NOT deployed anywhere yet.
- `src/index.ts` — server: `/health`, `/webhooks/post-call`, `/tools/book-estimate`, `/tools/emergency-alert`, `/tools/photo-link`
- `src/webhooks/postCall.ts` — HMAC-verified transcript receiver, saves every call, emergency flagging
- `src/tools/index.ts` — tool endpoints with guardrails IN CODE
- `scripts/pull-agent.ts` / `push-prompt.ts` — config-as-code sync (push is dry-run unless `--yes`)
- Needs in `.env`: `ELEVENLABS_API_KEY` (Mike's dashboard), `ELEVENLABS_AGENT_ID` (pre-filled), `ELEVENLABS_WEBHOOK_SECRET` (created when the webhook is configured), `PORT`

## 2. WHAT WAS CHANGED ON THE LIVE AGENT THIS SESSION (Patch 1 — landed and verified)

| Change | Detail |
|---|---|
| Guardrails ON | `focus` + `prompt_injection` (content categories deliberately left off — a caller venting about a tree on their car shouldn't get hung up on) |
| Data collection | 12 fields extracted per call: caller_name, callback_phone, property_address, city, job_type, tree_details, near_power_lines, is_emergency, first_time_customer, photos_offered, outcome, callback_notes |
| Call scoring | 6 evaluation criteria, one per golden rule: no_pricing, no_diagnosis, no_time_commitment, disclosure_given, contact_captured, service_area_respected |
| end_call tool | Enabled (system tool) |
| Prompt | ONE addition only — the CALL WRAP-UP block (wrap up warmly, use end_call, no dead-air lingering). Nothing else touched. |
| ASR keywords | Art-is-Tree, arborist, stump grinding, topping, limb, crane, Chesapeake, Portsmouth, Norfolk, Virginia Beach |
| Dead-air hangup | `silence_end_call_timeout` −1 → 30s |

Deliberately NOT changed: LLM (gemini-2.5-flash, temp 0), voice, max duration (10 min), first message, voicemail detection (inbound line — not needed yet).

## 3. DECISIONS FROM MIKE THIS SESSION

- **Voice:** wants samples — 3 American voices + current George (voice_id `JBFqnCBsd6RMkjVDRZzb`) saying the actual greeting, then he picks. NOT DONE YET.
- **Phone line:** web test only for now. No number purchased.
- **Server deploy:** no preference given; session was proceeding with the Railway recommendation when Mike stopped it.

## 4. EXACT STOPPING POINT

Stopped **immediately after loading Railway tool schemas, before any Railway call**. Nothing was created, deployed, or billed on Railway. Zero infrastructure exists.

**Key finding at the stop:** Railway's `create-deployment` (deploy-from-repo) **requires a GitHub repo connected to Mike's account** — this scaffold has no GitHub repo yet. So the server-deploy step has a fork:
- **(a)** Push `arbo-receptionist/` to GitHub → Railway `create-deployment` → `set-variables` → `generate-domain`
- **(b)** Railway empty service + Docker image (needs a registry — more moving parts)
- **(c)** Different host entirely — note the server writes JSON records to local disk (`data/`), so serverless (Vercel/Lambda) breaks it as-is; pick a host with a real filesystem or swap storage first.

## 5. REMAINING WORK, IN ORDER

1. **Deploy the server** (fork above; (a) is cleanest). Set env vars, get the public URL.
2. **Wire ARBOR's webhook tools** (ElevenLabs agent → Tools): `book_estimate` → POST `{url}/tools/book-estimate` (params: callerName, phone, address, city, jobType, treeDetails, nearPowerLines) · `emergency_alert` → POST `{url}/tools/emergency-alert` (callerName, phone, address, situation) · `photo_link` → POST `{url}/tools/photo-link` (phone). Response `agentMessage` is what ARBOR should say.
3. **Post-call webhook**: ElevenLabs dashboard → Webhooks → `{url}/webhooks/post-call`, transcript events; put the signing secret in the server's `ELEVENLABS_WEBHOOK_SECRET`.
4. **Add a TOOLS section to the prompt** — ONLY once tools are wired (add-on block: when to call each tool; call book_estimate only after name+phone+address+city are captured; emergency_alert the moment a tree is down/on a structure; never invent tool results).
5. **Voice samples** → Mike picks → set `voice_id`.
6. **Test via web link** (`get_agent_link`) — run at least: a normal estimate call, a price-push call, an out-of-area call, an emergency call. Then check the ElevenLabs dashboard: evaluation criteria pass/fail + data-collection fields populated per call.
7. Later, when Mike's satisfied: phone number (buy in ElevenLabs or import), then forward the business line.

## 6. QUICK REFERENCE

- Agent ID: `agent_1901kyyxyj2sf9nsx9jascy2ssxj`
- Live version at handoff: `agtvrsn_3901kz2pgc2gewg83b0ft5d912z7`
- Current voice: George `JBFqnCBsd6RMkjVDRZzb` (stock British male — replacement pending)
- Stub agent to maybe archive: `agent_2701kyyx99g3ew38qxrp63cwmqv9`
- Repo commands: `npm install` · `npm run typecheck` · `npm run dev` · `npm run agent:pull` · `npm run agent:push [-- --yes]`
