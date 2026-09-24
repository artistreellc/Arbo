// Texts to the Arbo number (Mike, 2026-09-24: "how do i get arbo to be able
// to see incoming texts"). Receive only: the intake stores what Twilio
// posts, answers with an EMPTY TwiML response, and never logs the number or
// the words (§4.3). An unwired source is NAMED, never zero (§1B).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { WebhookIntake } from '../src/ops/webhooks.js';
import { createArborRequestHandler } from '../src/server.js';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe('Twilio incoming texts', () => {
  it('stores a text with its photos, behind the minted key', () => {
    const intake = new WebhookIntake({ twilioSmsKey: 'tw-key', now: () => NOW });
    expect(intake.handleTwilioSms('wrong', form({ Body: 'x' })).status).toBe(401);
    expect(intake.handleTwilioSms(null, form({ Body: 'x' })).status).toBe(401);
    const out = intake.handleTwilioSms('tw-key', form({
      MessageSid: 'SM1', From: '+17575550142', Body: 'Here is the oak',
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM1/Media/ME1', MediaContentType0: 'image/jpeg',
      MediaUrl1: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM1/Media/ME2', MediaContentType1: 'image/png',
    }));
    expect(out.status).toBe(200);
    const [t] = intake.texts();
    expect(t!.from).toBe('+17575550142');
    expect(t!.body).toBe('Here is the oak');
    expect(t!.media).toHaveLength(2);
    expect(t!.media[0]!.contentType).toBe('image/jpeg');
    expect(intake.recentEvents(1)[0]!.kind).toBe('mms.received');
  });

  it('never logs the number or the words — counts and ids only (§4.3)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const intake = new WebhookIntake({ twilioSmsKey: 'tw-key', now: () => NOW });
    intake.handleTwilioSms('tw-key', form({ MessageSid: 'SM2', From: '+17575550199', Body: 'secret words' }));
    intake.handleTwilioSms('bad', form({ From: '+17575550199', Body: 'secret words' }));
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('5550199');
    expect(logged).not.toContain('secret words');
    expect(intake.recentEvents(5).map((e) => e.summary).join(' ')).not.toContain('5550199');
    spy.mockRestore();
  });

  it('drops non-https media urls and caps media at 10', () => {
    const intake = new WebhookIntake({ twilioSmsKey: 'k', now: () => NOW });
    const f: Record<string, string> = { NumMedia: '50', MediaUrl0: 'http://evil.test/x', MediaUrl1: 'javascript:alert(1)' };
    for (let i = 2; i < 50; i += 1) f[`MediaUrl${i}`] = `https://api.twilio.com/m/${i}`;
    intake.handleTwilioSms('k', form(f));
    const [t] = intake.texts();
    expect(t!.media.every((m) => m.url.startsWith('https://'))).toBe(true);
    expect(t!.media.length).toBeLessThanOrEqual(10);
  });

  it('refuses by name when not wired', () => {
    const intake = new WebhookIntake({ now: () => NOW });
    const out = intake.handleTwilioSms('anything', form({ Body: 'x' }));
    expect(out.status).toBe(503);
    expect(intake.status().sources.twilio.configured).toBe(false);
  });
});

describe('Twilio text HTTP surface', () => {
  it('unwired: the route refuses by name and /api/webhooks/texts says NOT WIRED', async () => {
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const hook = await fetch(`${base}/webhooks/twilio/sms?key=x`, { method: 'POST', body: 'Body=hi' });
    expect(hook.status).toBe(503);
    const t = (await (await fetch(`${base}/api/webhooks/texts`)).json()) as { wired: boolean; note: string };
    expect(t.wired).toBe(false);
    expect(t.note).toContain('never replies');
    srv.close();
  });

  it('an accepted text is answered with an EMPTY TwiML response — no reply is ever sent', () => {
    const src = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(src).toContain('<Response></Response>');
    const hook = readFileSync(new URL('../src/ops/webhooks.ts', import.meta.url), 'utf8');
    expect(hook).not.toMatch(/<Message>|<Sms>|messages\.create/i);
  });

  it('the Calls tab names the unwired text line (§1B)', () => {
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    expect(html).toContain('this is not zero texts');
    expect(html).toContain("api('/api/webhooks/texts')");
  });
});
