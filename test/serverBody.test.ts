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

// A caller error is not a server error. This came out of a live function check:
// a malformed POST body fell through to the catch-all and came back as 500
// `server_error`, which says "Arbo broke" when the truth is "that was not
// JSON" — and a 500 on a POST teaches a client to retry forever.

let server: Server | null = null;
async function listen(): Promise<string> {
  server = createServer(createArborRequestHandler());
  await new Promise<void>((r) => server!.listen(0, r));
  const addr = server!.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}
afterAll(() => { server?.close(); });

describe('request body handling', () => {
  it('names a malformed body as the caller\'s problem, not a server failure', async () => {
    const base = await listen();
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_json' });
  });

  it('treats an empty body as an empty object — handlers own their own validation', async () => {
    const base = server ? `http://127.0.0.1:${(server.address() as { port: number }).port}` : await listen();
    const res = await fetch(`${base}/api/roster`, { method: 'POST' });
    // With no DB configured this is the honest 503, NOT a parse crash.
    expect(res.status).toBe(503);
  });

  it('an unknown route is a 404, never a 500', async () => {
    const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
  });
});
