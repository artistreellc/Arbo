import { describe, it, expect } from 'vitest';
import { buildReceptionistSystemPrompt } from '../src/reception/systemPrompt.js';
import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';

const prompt = buildReceptionistSystemPrompt(loadGuardrails(), loadLegal());

describe('receptionist system prompt (built from config, §3)', () => {
  it('opens with the legal disclosure line (§4.2)', () => {
    const legal = loadLegal();
    expect(prompt).toContain(legal.callRecordingAndAiDisclosure.disclosureLine);
  });

  it('names all four served cities', () => {
    for (const c of ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth']) {
      expect(prompt).toContain(c);
    }
  });

  it('never mentions Suffolk, and never presents TCIA as a held credential', () => {
    // Suffolk must not appear at all (§2). TCIA may appear only as an
    // instruction NOT to claim it — never as a positive credential claim.
    expect(prompt).not.toMatch(/\bSuffolk\b/i);
    expect(prompt).not.toMatch(/\bTCIA (member|certified|accredited|approved)\b/i);
    expect(prompt).toMatch(/never claim[^.]*TCIA/i); // the guardrail instruction is present
  });

  it('carries the no-price and emergency instructions', () => {
    expect(prompt.toLowerCase()).toContain('free estimate');
    expect(prompt.toLowerCase()).toContain('emergency');
    expect(prompt.toLowerCase()).toContain('power line');
  });

  it('opens name-first: the name ask comes BEFORE the disclosure (§3.10)', () => {
    const g = loadGuardrails();
    const legal = loadLegal();
    const nameIdx = prompt.indexOf(g.callOpen.nameAskLine);
    const discIdx = prompt.indexOf(legal.callRecordingAndAiDisclosure.disclosureLine);
    expect(nameIdx).toBeGreaterThan(-1);
    expect(discIdx).toBeGreaterThan(-1);
    expect(nameIdx).toBeLessThan(discIdx); // name before disclosure
    expect(prompt).toContain('who do I have the pleasure');
  });

  it('has a missed-call text-back configured (§3.21)', () => {
    const g = loadGuardrails();
    expect(g.afterHoursAndOverflow.missedCallTextBack.toLowerCase()).toContain('art-is-tree');
    expect(g.afterHoursAndOverflow.missedCallTextBack.length).toBeGreaterThan(20);
  });
});
