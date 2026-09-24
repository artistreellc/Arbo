// Mike, 2026-09-24: "the best of arbo but still functions as my phone".
// His business cell stays his phone; his iPhone relays incoming texts
// (Shortcuts automation) and answered-call transcripts (Share sheet) to
// Arbo. Both relays sit behind the app key, carry no PII into logs, and the
// app states what iOS cannot relay (photos) instead of implying none.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { WebhookIntake } from '../src/ops/webhooks.js';
import { createArborRequestHandler } from '../src/server.js';

const NOW = Date.parse('2026-09-24T12:00:00Z');

describe('business-cell relays', () => {
  it('a relayed text lands on the business line, words only', () => {
    const intake = new WebhookIntake({ now: () => NOW });
    expect(intake.relayText({ from: '+17575550142', text: '  Can you look at my oak?  ' }).ok).toBe(true);
    const [t] = intake.texts();
    expect(t!.line).toBe('business');
    expect(t!.body).toBe('Can you look at my oak?');
    expect(t!.media).toEqual([]);
  });

  it('refuses an empty relay instead of storing a blank text', () => {
    const intake = new WebhookIntake({ now: () => NOW });
    expect(intake.relayText({ from: '+1757', text: '   ' })).toEqual({ ok: false, error: 'text_required' });
    expect(intake.relayCallNote({})).toEqual({ ok: false, error: 'text_required' });
    expect(intake.texts()).toHaveLength(0);
  });

  it('keeps call notes, newest first', () => {
    const intake = new WebhookIntake({ now: () => NOW });
    intake.relayCallNote({ with: 'SIM-Dana', text: 'first call' });
    intake.relayCallNote({ text: 'second call' });
    const notes = intake.notes();
    expect(notes[0]!.text).toBe('second call');
    expect(notes[0]!.withWhom).toBeNull();
    expect(notes[1]!.withWhom).toBe('SIM-Dana');
  });

  it('logs counts only — never the sender or the words (§4.3)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const intake = new WebhookIntake({ now: () => NOW });
    intake.relayText({ from: '+17575550177', text: 'private words' });
    intake.relayCallNote({ with: 'SIM-Pat', text: 'private call' });
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('5550177');
    expect(logged).not.toContain('private');
    expect(logged).not.toContain('SIM-Pat');
    spy.mockRestore();
  });

  it('the relay routes answer over HTTP, and the app names what iOS cannot relay', async () => {
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const post = (p: string, b: unknown) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await post('/api/relay/text', { from: '+17575550100', text: 'hi' })).status).toBe(200);
    expect((await post('/api/relay/text', {})).status).toBe(400);
    expect((await post('/api/relay/call-notes', { text: 'notes' })).status).toBe(200);
    const texts = (await (await fetch(`${base}/api/webhooks/texts`)).json()) as { texts: Array<{ line: string }> };
    expect(texts.texts.some((t) => t.line === 'business')).toBe(true);
    srv.close();
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    expect(html).toContain('Photos stay on your phone');
    expect(html).toContain('nothing relayed from your iPhone since deploy');
    expect(html).toContain('Notes from calls you answered');
  });
});
