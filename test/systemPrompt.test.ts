/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
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
