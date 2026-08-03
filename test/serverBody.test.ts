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
