import { describe, it, expect } from 'vitest';
import { capture, nextQuestion, isComplete, powerLineRedFlag, toQualificationJson, type QualState } from '../src/reception/qualification.js';

describe('lead qualification (§3.3)', () => {
  it('asks for the next missing required field in order', () => {
    let s: QualState = {};
    expect(nextQuestion(s)).toMatch(/name/i);
    s = capture(s, 'name', 'Jane Homeowner');
    expect(nextQuestion(s)).toMatch(/address/i);
  });

  it('resolves the served city from the address', () => {
    const s = capture({}, 'address', '742 Evergreen Terrace, Virginia Beach, VA 23451');
    expect(s.city).toBe('Virginia Beach');
  });

  it('is complete only when all required fields are captured', () => {
    let s: QualState = {};
    for (const [k, v] of [
      ['name', 'Jane'],
      ['address', '10 Birch Ln, Norfolk, VA 23505'],
      ['phone', '757-555-0100'],
      ['jobType', 'removal'],
      ['treeInfo', 'large oak'],
      ['proximityStructure', 'about 15 feet from the house'],
      ['proximityPowerLines', 'right next to the power line'],
    ] as const) {
      expect(isComplete(s)).toBe(false);
      s = capture(s, k, v);
    }
    expect(isComplete(s)).toBe(true);
  });

  it('flags the power-line red flag', () => {
    const near = capture({}, 'proximityPowerLines', 'it is right under the power line');
    expect(powerLineRedFlag(near)).toBe(true);
    const far = capture({}, 'proximityPowerLines', 'no power lines anywhere near it');
    expect(powerLineRedFlag(far)).toBe(false);
  });

  it('builds a clean qualification payload', () => {
    let s: QualState = {};
    s = capture(s, 'treeInfo', 'tall pine');
    s = capture(s, 'jobType', 'removal');
    s = capture(s, 'proximityPowerLines', 'close to the lines');
    s = capture(s, 'hadWorkBefore', 'yes we have');
    const json = toQualificationJson(s);
    expect(json.treeInfo).toBe('tall pine');
    expect(json.powerLineRedFlag).toBe(true);
    expect(json.hadWorkBefore).toBe(true);
  });
});
