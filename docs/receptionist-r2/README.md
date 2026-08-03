# Arbo Receptionist — Base Layer

Config-as-code for the **live ElevenLabs ARBOR agent** plus the server skeleton the full Arbo build grows out of.

**This is an ADD-ON scaffold. It does not modify or restate the Arbo Master Build Brief — the brief wins on any conflict** (per the kickoff protocol / "brief wins" rule).

## What's here

| Path | What it is |
|---|---|
| `agent/prompt/system-prompt.md` | The live receptionist prompt — **edit here**, then push |
| `agent/first-message.txt` | The greeting |
| `agent/agent.config.json` | Annotated snapshot of the live agent (incl. known gaps) |
| `scripts/pull-agent.ts` | Live agent → repo (`npm run agent:pull`) |
| `scripts/push-prompt.ts` | Repo → live agent, dry-run by default (`npm run agent:push`, add `-- --yes` to apply) |
| `src/index.ts` | Express server: health, post-call webhook, tool endpoints |
| `src/webhooks/postCall.ts` | Transcript receiver — HMAC-verified, saves every call ("silence is never success") |
| `src/tools/index.ts` | Agent tool stubs: book-estimate, emergency-alert, photo-link — guardrails enforced in code |
| `src/elevenlabs/client.ts` | Minimal ElevenLabs API client (no SDK dependency) |

## Guardrails that live in CODE, not just the prompt

- `book-estimate` records a **request** only — it can never confirm a date/time (Golden Rule 3; Mike confirms).
- Service area (Virginia Beach, Norfolk, Chesapeake, Portsmouth) validated server-side.
- Emergencies are a separate path — a fallen tree can't be filed as a normal estimate.
- No pricing logic exists anywhere in this codebase, on purpose (Golden Rule 1).

## Run it

```bash
npm install
cp .env.example .env   # add ELEVENLABS_API_KEY
npm run typecheck
npm run dev            # server on :3000
npm run agent:pull     # refresh repo from live agent
npm run agent:push     # dry-run diff; add -- --yes to update the live agent
```

## Live agent status (after the 2026-08-03 Patch 1 dial-in — see HANDOFF.md)

Done: guardrails ON (focus + prompt-injection), 12 data-collection fields, 6 evaluation criteria, end_call tool + CALL WRAP-UP prompt block, ASR keywords, 30s dead-air hangup.

Still open:

1. **No phone number attached** — Mike chose web-test-only for now.
2. **No tools wired** — blocked on deploying this server; the endpoints in this repo are what they'll point at.
3. **No post-call webhook configured** — blocked on the same deployment; point it at `/webhooks/post-call`.
4. **Voice** — still stock George; American voice samples pending Mike's pick.

## Next layers (in brief order, pending Mike)

Wire the three tools into the ElevenLabs agent → attach a number → post-call webhook to a real deployment → Google Calendar hold + color-coding + ZIP clustering → estimate→job conversion + Drive filing.
