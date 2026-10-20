// The owner key for tests that call Arbo's /api over the wire.
//
// Audit M1 (2026-10-20): with no APP_ACCESS_KEY the /api door is LOCKED in
// every data mode — there is no keyless carve-out, not even for tests or the
// practice data. A test file that calls /api sets the key before src/env.ts
// reads it, at the very top of the file:
//
//   vi.hoisted(() => { process.env.APP_ACCESS_KEY = 'test-owner-key'; });
//
// and calls with ownerFetch, which puts the x-arbor-key header on every
// request — the header only; a ?key= is never accepted (audit L1). A file
// whose literal drifts from OWNER_KEY fails loudly with 401s, never quietly.
export const OWNER_KEY = 'test-owner-key';

export function ownerFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'x-arbor-key': OWNER_KEY } });
}
