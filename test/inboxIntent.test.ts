// The intent engine: fast path mapping, decide() precedence, verdict parsing.
import { describe, expect, it } from 'vitest';
import {
  CORE_INTENTS,
  CONFIDENCE_HIGH,
  CONFIDENCE_MAYBE,
  decide,
  fastPathIntent,
  parseVerdict,
} from '../src/ops/inboxIntent.js';
import { classifyLeadMail } from '../src/reception/leadMail.js';

describe('fastPathIntent', () => {
  it('maps every ON channel to a core intent', () => {
    const cases: [string, string][] = [
      ['callrail_call', 'callrail'],
      ['callrail_web_form', 'callrail'],
      ['website_form', 'website_form'],
      ['google_ads_lead_form', 'ads_lsa_lead'],
      ['lsa_call', 'ads_lsa_lead'],
      ['yelp', 'yelp_lead'],
    ];
    for (const [provider, intent] of cases) {
      const r = fastPathIntent({
        isLeadNotification: true,
        provider: provider as never,
        lead: {},
        inServiceArea: null,
      });
      expect(r, provider).toBe(intent);
    }
  });

  it('splits direct email on which R12 rule matched', () => {
    const ask = classifyLeadMail({
      from: 'Pat Jones <pat@example.com>',
      subject: 'Estimate please',
      body: 'I need an estimate for an oak in the back yard.',
    });
    expect(fastPathIntent(ask)).toBe('quote_request');
    const wo = classifyLeadMail({
      from: 'Pat Jones <pat@example.com>',
      subject: 'Re: proposal',
      body: 'Attached is the signed work order, approved.',
    });
    expect(fastPathIntent(wo)).toBe('contract_approval');
  });

  it('returns null for non-leads', () => {
    expect(
      fastPathIntent({ isLeadNotification: false, provider: null, lead: {}, inServiceArea: null }),
    ).toBeNull();
  });

  it('every fast-path target is a real core intent id', () => {
    const ids = new Set(CORE_INTENTS.map((i) => i.id));
    for (const t of ['callrail', 'website_form', 'ads_lsa_lead', 'yelp_lead', 'quote_request', 'contract_approval']) {
      expect(ids.has(t), t).toBe(true);
    }
  });
});

describe('decide', () => {
  const v = (intent: string | null, confidence: number, matters = true) => ({
    intent,
    confidence,
    matters,
    reason: 'because',
  });

  it("Mike's correction beats both voices, including 'ignored'", () => {
    const d = decide('callrail', v('quote_request', 0.99), 'website_form');
    expect(d.lane).toBe('surface');
    expect(d.intent).toBe('website_form');
    expect(decide('callrail', v('callrail', 0.99), 'ignored').lane).toBe('ignore');
  });

  it('fast path surfaces even when the model is unavailable — and says so', () => {
    const d = decide('callrail', null, null);
    expect(d.lane).toBe('surface');
    expect(d.intent).toBe('callrail');
    expect(d.modelUnavailable).toBe(true);
  });

  it('model unavailable + no fast path = ignore, named, not a verdict', () => {
    const d = decide(null, null, null);
    expect(d.lane).toBe('ignore');
    expect(d.modelUnavailable).toBe(true);
    expect(d.reason).toMatch(/model unavailable/i);
  });

  it('a confident contract_approval overrides a different fast-path read', () => {
    const d = decide('quote_request', v('contract_approval', 0.9), null);
    expect(d.intent).toBe('contract_approval');
  });

  it('any other disagreement keeps the anchored fast-path intent', () => {
    const d = decide('callrail', v('quote_request', 0.95), null);
    expect(d.intent).toBe('callrail');
  });

  it('model-only: high surfaces, middle is maybe, low ignores', () => {
    expect(decide(null, v('quote_request', CONFIDENCE_HIGH), null).lane).toBe('surface');
    const mid = decide(null, v('quote_request', CONFIDENCE_MAYBE), null);
    expect(mid.lane).toBe('maybe');
    expect(mid.intent).toBe('quote_request');
    expect(decide(null, v('quote_request', 0.2), null).lane).toBe('ignore');
  });

  it('matters-but-no-intent lands in maybe (proposal seed), never silently dropped', () => {
    const d = decide(null, v(null, 0.7, true), null);
    expect(d.lane).toBe('maybe');
    expect(d.intent).toBeUndefined();
  });

  it('reasons are redacted — a model quoting a phone number never stores one', () => {
    const d = decide(null, { intent: 'quote_request', confidence: 0.9, matters: true, reason: 'caller left 757-555-0142' }, null);
    expect(d.reason).not.toContain('757-555-0142');
    expect(d.reason).toContain('[redacted-phone]');
  });
});

describe('parseVerdict', () => {
  it('parses plain JSON and a fenced block', () => {
    const raw = '{"intent":"callrail","confidence":0.9,"matters":true,"reason":"r"}';
    expect(parseVerdict(raw).intent).toBe('callrail');
    expect(parseVerdict('```json\n' + raw + '\n```').intent).toBe('callrail');
  });

  it('clamps confidence into 0..1', () => {
    expect(parseVerdict('{"intent":null,"confidence":7,"matters":false,"reason":"r"}').confidence).toBe(1);
  });

  it('throws on malformed output instead of inventing a verdict', () => {
    expect(() => parseVerdict('sure, that looks like a lead')).toThrow();
    expect(() => parseVerdict('{"intent":"x","matters":true,"reason":"r"}')).toThrow();
  });

  it('carries proposed_label only as a string', () => {
    const p = parseVerdict(
      '{"intent":null,"confidence":0.6,"matters":true,"reason":"r","proposed_label":"permit mail"}',
    );
    expect(p.proposedLabel).toBe('permit mail');
  });
});
