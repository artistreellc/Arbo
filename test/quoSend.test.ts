// R22: the one outbound path. Pins: one recipient per POST, raw key in
// Authorization, every documented Quo refusal named, and a refusal log that
// carries the reason only — never the number, never the words (§4.3).
import { describe, it, expect, vi } from 'vitest';
import { createQuoSender, MAX_CONTENT_CHARS } from '../src/integrations/quoSend.js';

const TO = '+17575550142';
const FROM = '+17576069432';
const TEXT = 'This is Art-is-Tree. Still interested? Reply STOP to opt out.';

function fetchWith(status: number, body: unknown) {
  const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
  const f = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { f, calls };
}

describe('createQuoSender', () => {
  it('POSTs one recipient with the raw key, and reads the 202 back', async () => {
    const { f, calls } = fetchWith(202, { data: { id: 'AC1', status: 'queued', conversationId: 'CN1' } });
    const r = await createQuoSender('QUO_KEY', f).send({ from: FROM, to: TO, content: TEXT });
    expect(r).toEqual({ ok: true, id: 'AC1', status: 'queued', conversationId: 'CN1' });
    expect(calls[0]!.url).toBe('https://api.quo.com/v1/messages');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers.Authorization).toBe('QUO_KEY');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ content: TEXT, from: FROM, to: [TO] });
  });

  it('names every documented refusal', async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { code: '0206400', title: 'A2P Registration Not Approved' }, 'not_registered'],
      [403, { code: '0204403' }, 'daily_cap'],
      [429, {}, 'rate_limited'],
      [401, { code: '0200401' }, 'unauthorized'],
      [402, { code: '0201402' }, 'subscription_expired'],
      [400, { code: 'other' }, 'bad_request'],
      [500, { code: '0201500' }, 'http_500'],
    ];
    for (const [status, body, reason] of cases) {
      const r = await createQuoSender('k', fetchWith(status, body).f).send({ from: FROM, to: TO, content: TEXT });
      expect(r.ok, reason).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    }
  });

  it('refuses blank or over-long content before touching Quo, and names a dead network', async () => {
    const { f, calls } = fetchWith(202, { data: {} });
    const s = createQuoSender('k', f);
    expect(await s.send({ from: FROM, to: TO, content: '   ' })).toEqual({ ok: false, reason: 'bad_request', code: null });
    expect(await s.send({ from: FROM, to: TO, content: 'x'.repeat(MAX_CONTENT_CHARS + 1) })).toEqual({ ok: false, reason: 'bad_request', code: null });
    expect(calls).toHaveLength(0);
    const dead = createQuoSender('k', async () => { throw new Error('ECONNRESET'); });
    expect(await dead.send({ from: FROM, to: TO, content: TEXT })).toEqual({ ok: false, reason: 'network', code: null });
  });

  it('logs a refusal by reason only — no number, no words, no response body (§4.3)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await createQuoSender('k', fetchWith(400, { code: '0206400', message: `could not send to ${TO}` }).f).send({ from: FROM, to: TO, content: TEXT });
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('not_registered');
    expect(logged).not.toContain('5550142');
    expect(logged).not.toContain('Art-is-Tree');
    spy.mockRestore();
  });
});
