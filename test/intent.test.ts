import { describe, it, expect } from 'vitest';
import { detectIntent } from '../src/reception/intent.js';
import { loadGuardrails } from '../src/config/loadConfig.js';

const g = loadGuardrails();
const intentOf = (t: string) => detectIntent(t, g).intent;

describe('caller-intent classification (§3.7–3.9, §3.26)', () => {
  it('flags an injury as a high-priority incident', () => {
    const r = detectIntent('your crew left and now someone got hurt in my yard', g);
    expect(r.intent).toBe('incident');
    expect(r.incidentType).toBe('injury');
    expect(r.highPriority).toBe(true);
  });

  it('flags crew property damage as an incident', () => {
    const r = detectIntent('your guys ran over my sprinkler heads and broke my fence', g);
    expect(r.intent).toBe('incident');
    expect(r.incidentType).toBe('damage');
  });

  it('flags a genuinely angry caller as an incident', () => {
    expect(detectIntent('this is unacceptable, I am furious with how this went', g).incidentType).toBe('angry');
  });

  it('recognizes a caller who wants a human/Mike', () => {
    expect(intentOf("I don't want to talk to a robot, is Mike there?")).toBe('wants_human');
    expect(intentOf('can I talk to a person please')).toBe('wants_human');
  });

  it('screens an obvious solicitation as spam', () => {
    expect(intentOf('Hi, I can get you on the first page of Google with our SEO services')).toBe('spam');
    expect(intentOf('this is a courtesy call about your extended warranty')).toBe('spam');
  });

  it('NEVER treats a real customer as spam, even with a marketing-ish word', () => {
    // Mentions "marketing" but is clearly a tree job → must NOT be spam (§3.26 bias).
    expect(intentOf('I saw your marketing and I need an estimate to remove two trees in my yard')).toBe('normal');
    expect(intentOf('a tree fell and I need help')).not.toBe('spam');
  });

  it('still catches a tree emergency through the same classifier', () => {
    expect(intentOf('a tree just fell on my house')).toBe('emergency');
  });

  it('treats an ordinary inquiry as a normal lead', () => {
    expect(intentOf('I would like a quote to trim my oak tree')).toBe('normal');
  });
});
