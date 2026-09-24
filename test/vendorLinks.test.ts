/*
  SLOW::ARBO — tests a link switch. The note at the top of
  test/dataLinks.test.ts applies here in full.
*/
// R21 (Mike, 2026-09-24): "make sure you disconnect the twilio and eleven
// labs links while we develop off sona". Fail-closed like every other link:
// cut unless the variable is exactly 'live', and every door the link opens
// refuses BY NAME while it is cut — nothing deleted, one variable to undo.
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { vendorLinked, cutVendorLinks, vendorEnvVar } from '../src/integrations/vendorLinks.js';
import { createArborRequestHandler } from '../src/server.js';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

async function serve() {
  const srv = createServer(createArborRequestHandler());
  await new Promise<void>((r) => srv.listen(0, r));
  return { srv, base: `http://127.0.0.1:${(srv.address() as { port: number }).port}` };
}

describe('vendor link switches', () => {
  it('are CUT by default and for anything but the exact string "live"', () => {
    delete process.env.ARBO_LINK_ELEVENLABS;
    delete process.env.ARBO_LINK_TWILIO;
    expect(cutVendorLinks()).toEqual(['elevenlabs', 'twilio']);
    for (const v of ['', 'on', 'true', 'LIVE', ' live']) {
      process.env.ARBO_LINK_ELEVENLABS = v;
      expect(vendorLinked('elevenlabs'), JSON.stringify(v)).toBe(false);
    }
    process.env.ARBO_LINK_ELEVENLABS = 'live';
    expect(vendorLinked('elevenlabs')).toBe(true);
    expect(vendorEnvVar('twilio')).toBe('ARBO_LINK_TWILIO');
  });

  it('while cut, every ElevenLabs and Twilio door refuses by name', async () => {
    delete process.env.ARBO_LINK_ELEVENLABS;
    delete process.env.ARBO_LINK_TWILIO;
    const { srv, base } = await serve();
    const cut = async (method: string, path: string, link: string) => {
      const res = await fetch(`${base}${path}`, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
      expect(res.status, path).toBe(503);
      const body = (await res.json()) as { error: string; link: string; message: string };
      expect(body.error, path).toBe('link_cut');
      expect(body.link, path).toBe(link);
      expect(body.message, path).toContain('Nothing was deleted');
    };
    await cut('POST', '/voice/llm/chat/completions', 'elevenlabs');
    await cut('POST', '/voice/llm/v1/chat/completions', 'elevenlabs');
    await cut('POST', '/webhooks/elevenlabs', 'elevenlabs');
    await cut('GET', '/talk/widget.js', 'elevenlabs');
    await cut('GET', '/api/brief/audio', 'elevenlabs');
    await cut('POST', '/webhooks/twilio/sms?key=x', 'twilio');
    const talk = await fetch(`${base}/talk`);
    expect(talk.status).toBe(503);
    expect(await talk.text()).toContain('Talk to Arbo is off');
    const rec = (await (await fetch(`${base}/api/reception/status`)).json()) as { linkCut: boolean };
    expect(rec.linkCut).toBe(true);
    const wh = (await (await fetch(`${base}/api/webhooks`)).json()) as { cut: string[] };
    expect(wh.cut).toEqual(['elevenlabs', 'twilio']);
    srv.close();
  });

  it('reconnecting is one variable — the doors open again (still behind their own secrets)', async () => {
    process.env.ARBO_LINK_ELEVENLABS = 'live';
    process.env.ARBO_LINK_TWILIO = 'live';
    const { srv, base } = await serve();
    expect((await fetch(`${base}/talk`)).status).toBe(200);
    const bridge = await fetch(`${base}/voice/llm/chat/completions`, { method: 'POST', body: '{}' });
    expect(((await bridge.json()) as { error?: string }).error).not.toBe('link_cut');
    const sms = await fetch(`${base}/webhooks/twilio/sms?key=x`, { method: 'POST', body: 'Body=hi' });
    expect(((await sms.json()) as { error?: string }).error).toBe('webhook_not_wired');
    srv.close();
  });

  it('Sona (Quo) is NOT behind these switches', async () => {
    delete process.env.ARBO_LINK_ELEVENLABS;
    const { srv, base } = await serve();
    const quo = await fetch(`${base}/webhooks/quo`, { method: 'POST', body: '{}' });
    expect(((await quo.json()) as { error?: string }).error).toBe('quo_not_wired');
    srv.close();
  });

  it('the app names the cut and hides Talk to Arbo instead of alarming', () => {
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    expect(html).toContain('if (s.linkCut)');
    expect(html).toContain("document.getElementById('talk-btn')");
    expect(html).toContain('disconnected while Sona handles calls');
  });
});
