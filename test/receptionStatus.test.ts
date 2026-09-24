/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createArborRequestHandler } from '../src/server.js';

// The cockpit's reception instrument. Two laws meet here: §9 (the phone line
// as a one-glance instrument) and §4.3 (counts and ids only — the payload's
// key set IS the privacy guarantee, so it is pinned exactly).

let server: Server | null = null;
async function listen(): Promise<string> {
  server = createServer(createArborRequestHandler());
  await new Promise<void>((r) => server!.listen(0, r));
  const addr = server!.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}
afterAll(() => { server?.close(); });

describe('GET /api/reception/status', () => {
  it('serves exactly the promised keys — no slot for caller content', async () => {
    const base = await listen();
    const res = await fetch(`${base}/api/reception/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'activeSessions', 'bootedAt', 'callsSinceBoot', 'configured', 'emergencyCallsSinceBoot',
      'guardBlockedTurnsSinceBoot', 'lastTurnAt', 'linkCut', 'llmKeyPresent', 'turnsSinceBoot', 'unauthorizedSinceBoot',
    ]);
    // Booleans are stated, never inferred from absence; a fresh boot has no
    // turns and says so with null, not a fake timestamp.
    expect(typeof body.configured).toBe('boolean');
    expect(typeof body.llmKeyPresent).toBe('boolean');
    // R21: the cut is a stated boolean too — a switch, never caller content.
    expect(typeof body.linkCut).toBe('boolean');
    expect(body.turnsSinceBoot).toBe(0);
    expect(body.lastTurnAt).toBeNull();
  });
});
