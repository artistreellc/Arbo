// R19: the webhook intake. Every route refuses unverified deliveries, every
// unwired source is NAMED, the form capture parses the SAME email Mike still
// receives, and Arbo's one Resend client can only ever GET — never send.
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import {
  WebhookIntake,
  verifySvixSignature,
  verifyElevenLabsSignature,
  parseFormText,
  createResendEmailFetcher,
} from '../src/ops/webhooks.js';
import { createArborRequestHandler } from '../src/server.js';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const SECRET_RAW = Buffer.from('test-secret-key-32-bytes-long!!!').toString('base64');
const SVIX_SECRET = `whsec_${SECRET_RAW}`;

function svixHeaders(body: string, atMs = NOW, id = 'msg_1') {
  const timestamp = String(Math.floor(atMs / 1000));
  const sig = createHmac('sha256', Buffer.from(SECRET_RAW, 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return { id, timestamp, signature: `v1,${sig}` };
}

const FORM_TEXT = [
  'New website inquiry — Art-is-Tree LLC',
  '',
  'Name: Dana Site-Test',
  'Phone: 757-555-0142',
  'Email: dana@example.com',
  'Property Address: 4500 Medford Ct',
  'Service Needed: large oak removal',
  'Timeline: This month',
  '',
  'Message:',
  'The big oak in the back is leaning after the storm.',
].join('\n');

describe('signature verification', () => {
  it('accepts a valid svix signature and rejects tampering, staleness, and absence', () => {
    const body = '{"type":"email.sent"}';
    const h = svixHeaders(body);
    expect(verifySvixSignature(SVIX_SECRET, h, body, NOW).ok).toBe(true);
    expect(verifySvixSignature(SVIX_SECRET, h, body + ' ', NOW).ok).toBe(false);
    expect(verifySvixSignature(SVIX_SECRET, { ...h, signature: 'v1,AAAA' }, body, NOW).ok).toBe(false);
    expect(verifySvixSignature(SVIX_SECRET, h, body, NOW + 6 * 60 * 1000).reason).toBe('stale_timestamp');
    expect(verifySvixSignature(SVIX_SECRET, {}, body, NOW).reason).toBe('missing_headers');
  });

  it('accepts a valid ElevenLabs t=,v0= signature and rejects the rest', () => {
    const body = '{"type":"post_call_transcription"}';
    const t = String(Math.floor(NOW / 1000));
    const v0 = createHmac('sha256', 'el-secret').update(`${t}.${body}`).digest('hex');
    expect(verifyElevenLabsSignature('el-secret', `t=${t},v0=${v0}`, body, NOW).ok).toBe(true);
    expect(verifyElevenLabsSignature('el-secret', `t=${t},v0=${v0}`, body + 'x', NOW).ok).toBe(false);
    expect(verifyElevenLabsSignature('el-secret', undefined, body, NOW).reason).toBe('missing_header');
    expect(verifyElevenLabsSignature('el-secret', `t=${t},v0=${v0}`, body, NOW + 31 * 60 * 1000).reason).toBe('stale_timestamp');
  });
});

describe('form text parsing', () => {
  it('pulls every field out of the exact text api/contact.js builds', () => {
    const p = parseFormText(FORM_TEXT);
    expect(p).toEqual({
      name: 'Dana Site-Test',
      phone: '757-555-0142',
      email: 'dana@example.com',
      address: '4500 Medford Ct',
      service: 'large oak removal',
      timeline: 'This month',
      message: 'The big oak in the back is leaning after the storm.',
    });
  });
});

describe('WebhookIntake', () => {
  const sentEvent = (emailId: string) => JSON.stringify({
    type: 'email.sent',
    data: { email_id: emailId, subject: 'New estimate request from Dana Site-Test — large oak removal' },
  });

  it('captures a website form once (sent + delivered dedupe) with the fetched body', async () => {
    const intake = new WebhookIntake({
      resendSecret: SVIX_SECRET,
      fetchEmail: async () => ({ text: FORM_TEXT }),
      now: () => NOW,
    });
    const body = sentEvent('em_1');
    expect((await intake.handleResend(svixHeaders(body), body)).status).toBe(200);
    const delivered = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1', subject: 'New estimate request from Dana Site-Test — large oak removal' } });
    await intake.handleResend(svixHeaders(delivered, NOW, 'msg_2'), delivered);
    const forms = intake.websiteForms();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.bodyState).toBe('parsed');
    expect(forms[0]!.phone).toBe('757-555-0142');
    expect(intake.status().sources.resend.received).toBe(2);
  });

  it('a failed body fetch keeps the submission and NAMES the gap (§1B)', async () => {
    const intake = new WebhookIntake({
      resendSecret: SVIX_SECRET,
      fetchEmail: async () => { throw new Error('resend 500'); },
      now: () => NOW,
    });
    const body = sentEvent('em_2');
    await intake.handleResend(svixHeaders(body), body);
    const [form] = intake.websiteForms();
    expect(form!.bodyState).toBe('subject_only');
    expect(form!.name).toBe('Dana Site-Test');
    expect(form!.service).toBe('large oak removal');
  });

  it('non-form email events are logged, never captured as forms', async () => {
    const intake = new WebhookIntake({ resendSecret: SVIX_SECRET, now: () => NOW });
    const body = JSON.stringify({ type: 'email.sent', data: { email_id: 'em_3', subject: 'Receipt for your subscription' } });
    await intake.handleResend(svixHeaders(body), body);
    expect(intake.websiteForms()).toHaveLength(0);
    expect(intake.recentEvents(5)[0]!.kind).toBe('email.sent');
  });

  it('refuses by name when a source is not wired, and rejects bad signatures', async () => {
    const intake = new WebhookIntake({ now: () => NOW });
    const out = await intake.handleResend({}, '{}');
    expect(out.status).toBe(503);
    expect((out.body as { error: string }).error).toBe('webhook_not_wired');
    const wired = new WebhookIntake({ resendSecret: SVIX_SECRET, now: () => NOW });
    const bad = await wired.handleResend({ id: 'x', timestamp: String(NOW / 1000), signature: 'v1,nope' }, '{}');
    expect(bad.status).toBe(401);
    expect(wired.status().sources.resend.rejected).toBe(1);
  });

  it('stores an ElevenLabs post-call transcript with the collected fields', () => {
    const intake = new WebhookIntake({ elevenSecret: 'el-secret', now: () => NOW });
    const body = JSON.stringify({
      type: 'post_call_transcription',
      data: {
        conversation_id: 'conv_42',
        status: 'done',
        transcript: [{ role: 'agent' }, { role: 'user' }, { role: 'agent' }],
        analysis: {
          transcript_summary: 'Caller asked about oak removal.',
          data_collection_results: { caller_name: { value: 'Dana' }, is_emergency: { value: false }, empty: { value: null } },
        },
      },
    });
    const t = String(Math.floor(NOW / 1000));
    const v0 = createHmac('sha256', 'el-secret').update(`${t}.${body}`).digest('hex');
    expect(intake.handleElevenLabs(`t=${t},v0=${v0}`, body).status).toBe(200);
    const [tr] = intake.callTranscripts();
    expect(tr!.conversationId).toBe('conv_42');
    expect(tr!.turns).toBe(3);
    expect(tr!.collected).toEqual({ caller_name: 'Dana', is_emergency: false });
  });

  it('gates Railway events on the minted key', () => {
    const intake = new WebhookIntake({ railwayKey: 'rw-key', now: () => NOW });
    expect(intake.handleRailway('wrong', '{}').status).toBe(401);
    expect(intake.handleRailway('rw-key', JSON.stringify({ type: 'DEPLOY', status: 'SUCCESS', deployment: { id: 'd1' } })).status).toBe(200);
    expect(intake.recentEvents(5)[0]!.kind).toBe('DEPLOY:SUCCESS');
    expect(intake.recentEvents(5)[0]!.summary).toBe('deployment d1');
    // The current payload shape nests the id under resource.
    intake.handleRailway('rw-key', JSON.stringify({ type: 'Deployment.deployed', resource: { deployment: { id: 'd2' } } }));
    expect(intake.recentEvents(5)[0]!.kind).toBe('Deployment.deployed');
    expect(intake.recentEvents(5)[0]!.summary).toBe('deployment d2');
  });
});

describe('Arbo never sends email — pinned at the source', () => {
  it('the webhooks module has no send path: one GET, no POST, no send method', () => {
    const src = readFileSync(new URL('../src/ops/webhooks.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(src).toContain('THERE IS NO SEND PATH');
  });

  it('the fetcher GETs one email and returns null on a non-OK answer', async () => {
    const calls: Array<{ url: string; init?: { headers?: Record<string, string> } }> = [];
    const fetcher = createResendEmailFetcher('re_key', async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ subject: 's', text: 't' }) };
    });
    expect(await fetcher('em_9')).toEqual({ subject: 's', text: 't' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails/em_9');
    expect(calls[0]!.init?.headers?.Authorization).toBe('Bearer re_key');
    const failing = createResendEmailFetcher('re_key', async () => ({ ok: false, json: async () => ({}) }));
    expect(await failing('em_9')).toBeNull();
  });
});

describe('app surfaces (source pins — §1B named states, links-cut placement)', () => {
  const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');

  it('the website-forms panel renders ABOVE the brief fetch and names the unwired state', () => {
    const panel = html.indexOf('websiteFormsPanel().then');
    const brief = html.indexOf("api('/api/brief?from=");
    expect(panel).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(brief);
    expect(html).toContain('this is not zero forms');
    expect(html).toContain('Website forms — direct wire');
  });

  it('settings shows the links (read-only) and webhook wires with honest states', () => {
    expect(html).toContain('Data links');
    expect(html).toContain('closed door, not empty data');
    expect(html).toContain('this is not zero events');
    // No button opens a link from the app — the variable is set on Railway
    // after verification, and the copy says so.
    expect(html).toContain('never from a button in the app');
  });

  it('the calls tab names the transcript wire when it is down', () => {
    expect(html).toContain('this is not zero calls');
  });
});

describe('webhook + links HTTP surface (unwired defaults — honest states)', () => {
  let server: Server | null = null;
  it('unsigned deliveries bounce, status names every unwired source, /api/links names every cut link', async () => {
    server = createServer(createArborRequestHandler());
    await new Promise<void>((r) => server!.listen(0, r));
    const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    const hook = await fetch(`${base}/webhooks/resend`, { method: 'POST', body: '{}' });
    expect(hook.status).toBe(503); // no secret configured = not wired, by name
    expect(((await hook.json()) as { error: string }).error).toBe('webhook_not_wired');
    const status = (await (await fetch(`${base}/api/webhooks`)).json()) as {
      sources: { resend: { configured: boolean }; elevenlabs: { configured: boolean }; railway: { configured: boolean } }; note: string;
    };
    expect(status.sources.resend.configured).toBe(false);
    expect(status.sources.elevenlabs.configured).toBe(false);
    expect(status.sources.railway.configured).toBe(false);
    expect(status.note).toContain('NOT WIRED');
    const links = (await (await fetch(`${base}/api/links`)).json()) as {
      master: string; links: Array<{ link: string; state: string; envVar: string }>;
    };
    expect(links.master).toBe('cut');
    expect(links.links).toHaveLength(13);
    expect(links.links.every((l) => l.state === 'cut')).toBe(true);
    expect(links.links.find((l) => l.link === 'leads')!.envVar).toBe('ARBO_LINK_LEADS');
    const forms = (await (await fetch(`${base}/api/webhooks/forms`)).json()) as { wired: boolean; note: string };
    expect(forms.wired).toBe(false);
    expect(forms.note).toContain('untouched');
    server.close();
  });
});
