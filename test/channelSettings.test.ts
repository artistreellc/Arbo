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
import { channelIsOff, SEASONAL_CHANNELS_OFF } from '../src/reception/leadMail.js';
import { getTodayWorkZip, setTodayWorkZip, setLocationEnabled, getLiveWorkZip } from '../src/reception/routingHint.js';

// Mike's channel switches (cycle 34). The switch state is module-global and
// shared with every other suite in this process, so each test restores what
// it flips — a leaked OFF would fail unrelated classifier tests.

let server: Server | null = null;
async function listen(): Promise<string> {
  server = createServer(createArborRequestHandler());
  await new Promise<void>((r) => server!.listen(0, r));
  const addr = server!.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}
const initial = [...SEASONAL_CHANNELS_OFF];
afterAll(() => {
  server?.close();
  SEASONAL_CHANNELS_OFF.length = 0;
  SEASONAL_CHANNELS_OFF.push(...(initial as typeof SEASONAL_CHANNELS_OFF));
});

describe('lead channel settings API', () => {
  it('GET lists every channel with its live state and the reset-on-deploy honesty note', async () => {
    const base = await listen();
    const res = await fetch(`${base}/api/settings/channels`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { channels: Array<{ id: string; label: string; on: boolean }>; note: string };
    expect(body.channels.length).toBe(8);
    expect(body.note).toContain('reset');
    const ha = body.channels.find((c) => c.id === 'home_advisor')!;
    expect(ha.on).toBe(false); // seasonal default, unchanged by this feature
    expect(body.channels.find((c) => c.id === 'callrail_call')!.on).toBe(true);
  });

  it('POST flips a channel and the classifier obeys immediately', async () => {
    const base = server ? `http://127.0.0.1:${(server.address() as { port: number }).port}` : await listen();
    const off = await fetch(`${base}/api/settings/channels`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'yelp', on: false }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ id: 'yelp', on: false });
    expect(channelIsOff('yelp')).toBe(true);
    const on = await fetch(`${base}/api/settings/channels`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'yelp', on: true }),
    });
    expect(await on.json()).toEqual({ id: 'yelp', on: true });
    expect(channelIsOff('yelp')).toBe(false);
  });

  it('rejects an unknown channel and a missing toggle — 400, nothing changed', async () => {
    const base = server ? `http://127.0.0.1:${(server.address() as { port: number }).port}` : await listen();
    const bad = await fetch(`${base}/api/settings/channels`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'carrier_pigeon', on: false }),
    });
    expect(bad.status).toBe(400);
    const noToggle = await fetch(`${base}/api/settings/channels`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'yelp' }),
    });
    expect(noToggle.status).toBe(400);
    expect(channelIsOff('yelp')).toBe(false);
  });
});

describe('today work ZIP settings API (R15)', () => {
  it('GET starts null with the honesty note; POST sets, clears, and validates', async () => {
    const base = server ? `http://127.0.0.1:${(server.address() as { port: number }).port}` : await listen();
    const g0 = await (await fetch(`${base}/api/settings/route`)).json() as { workZip: string | null; note: string };
    expect(g0.workZip).toBeNull();
    expect(g0.note).toContain('resets on redeploy');

    const setRes = await fetch(`${base}/api/settings/route`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workZip: '23452' }),
    });
    expect(await setRes.json()).toEqual({ workZip: '23452' });
    expect(getTodayWorkZip()).toBe('23452');

    const bad = await fetch(`${base}/api/settings/route`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workZip: 'abc' }),
    });
    expect(bad.status).toBe(400);
    expect(getTodayWorkZip()).toBe('23452'); // nothing changed on a bad input

    const clear = await fetch(`${base}/api/settings/route`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workZip: null }),
    });
    expect(await clear.json()).toEqual({ workZip: null });
    setTodayWorkZip(null);
  });
});

describe('live location intake + toggle (R15/R16)', () => {
  it('toggle OFF refuses pings with a NAMED reason and clears state; ON accepts in-window', async () => {
    const base = server ? `http://127.0.0.1:${(server.address() as { port: number }).port}` : await listen();
    await fetch(`${base}/api/settings/location`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }),
    });
    const refused = await fetch(`${base}/api/location/zip`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zip: '23452' }),
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'location_off' });
    expect(getLiveWorkZip(Date.now())).toBeNull();

    await fetch(`${base}/api/settings/location`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }),
    });
    const g = await (await fetch(`${base}/api/settings/route`)).json() as { location: { enabled: boolean } };
    expect(g.location.enabled).toBe(true);
    // In-window acceptance is covered by the pure-store tests; the endpoint
    // itself is clock-dependent here, so only the named refusals are pinned.
    const bad = await fetch(`${base}/api/location/zip`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zip: 'nope' }),
    });
    expect([400, 403]).toContain(bad.status); // bad zip in-window, or after_hours when CI runs at night — both refuse
    setLocationEnabled(true);
  });
});
