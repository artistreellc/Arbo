/*
  SLOW::ARBO — see src/legal/propertyAccess.ts for the full marker.
*/
import { describe, it, expect } from 'vitest';

import {
  composeAccessLetter,
  buildAccessLetter,
  letterHash,
  deliveryOptions,
  recordAcceptance,
  consentLogLine,
  consentStanding,
  NO_CONSENT_ON_FILE,
  type AccessLetterInput,
} from '../src/legal/propertyAccess.js';
import { loadGuardrails } from '../src/config/loadConfig.js';

const g = loadGuardrails();

const base: AccessLetterInput = {
  jobAddress: '412 Baywood Dr, Virginia Beach',
  neighborAddress: '414 Baywood Dr, Virginia Beach',
  reason: 'The limb we are taking down overhangs your side of the fence, and the drop zone reaches your lawn.',
  requestedWindow: 'the week of the 12th',
  contactPhone: '757-555-0113',
};

describe('the pre-written access letter', () => {
  it('names both properties and why access is needed', () => {
    const letter = composeAccessLetter(base);
    expect(letter).toContain('412 Baywood Dr');
    expect(letter).toContain('414 Baywood Dr');
    expect(letter).toContain('overhangs your side of the fence');
  });

  it('says the neighbour is not on the hook for the work or the money', () => {
    expect(composeAccessLetter(base)).toMatch(/does not make you responsible/i);
  });

  it('tells them they can withdraw, and how', () => {
    const letter = composeAccessLetter(base);
    expect(letter).toMatch(/withdraw this permission at any time/i);
    expect(letter).toContain('757-555-0113');
  });

  it('never promises a date — only the window it was given, and confirmation first', () => {
    expect(composeAccessLetter(base)).toMatch(/confirm with you before anyone steps/i);
    const noWindow = composeAccessLetter({ ...base, requestedWindow: null });
    // §1B again: no window is stated as no window, not silently dropped so
    // the letter reads as though timing were settled.
    expect(noWindow).toMatch(/do not have the timing fixed yet/i);
  });

  it('handles an unknown neighbour address without leaving a blank', () => {
    const letter = composeAccessLetter({ ...base, neighborAddress: null });
    expect(letter).toMatch(/permission to enter your property/i);
    expect(letter).not.toMatch(/enter \./);
  });

  it('the base template carries no price, no diagnosis, no credential claim', () => {
    const built = buildAccessLetter(base, g);
    expect(built.ok).toBe(true);
  });
});

describe('the letter is guarded because a crew member types into it', () => {
  it('refuses a reason with a figure in it', () => {
    const r = buildAccessLetter({ ...base, reason: 'We are taking the oak down for $1,800 and need the driveway.' }, g);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.violations.some((v) => v.rule === 'no-price')).toBe(true);
    expect(r.message).toMatch(/take the figure out/i);
  });

  it('refuses a reason that diagnoses the tree', () => {
    const r = buildAccessLetter({ ...base, reason: 'That tree is dead and it has to come down over your side.' }, g);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.violations.some((v) => v.rule === 'no-diagnosis')).toBe(true);
  });

  it('refuses a giveaway written into the letter', () => {
    const r = buildAccessLetter({ ...base, reason: "We'll clear your side up for free while we're in there." }, g);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.violations.some((v) => v.rule === 'no-financial-authority')).toBe(true);
  });

  it('the KNOWN FALSE POSITIVE is real, fails closed, and is explained in words a crew can act on', () => {
    // Flagged for Mike, not fixed from here: judgment.ts reads "cut … off" as
    // an offer of a discount, and it is also how a tree crew talks. Pinning
    // it as a test so it is a documented behaviour, not a surprise in a front
    // yard — and so the day Mike rules on the pattern, this test is the thing
    // that has to change.
    const r = buildAccessLetter({ ...base, reason: 'We need to cut the limb off over your fence.' }, g);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.violations.some((v) => v.rule === 'no-financial-authority')).toBe(true);
    expect(r.message).toMatch(/describe the ACCESS rather than the cut/);
    // And the reword the message tells them to use actually works.
    const reworded = buildAccessLetter({ ...base, reason: 'The limb overhangs your side and the drop zone is your lawn.' }, g);
    expect(reworded.ok).toBe(true);
  });

  it('a refusal never hands back a phone-call pivot line as the letter', () => {
    // guardReply is used as a DETECTOR here. If someone rewires it as a
    // rewriter, a legal document quietly becomes "let's keep it to your trees".
    const r = buildAccessLetter({ ...base, reason: 'Take $200 off and we can use your driveway.' }, g);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r).not.toHaveProperty('letter');
  });
});

describe('Arbo does not send this letter', () => {
  it('offers the crew phone and an approval page, and no email send', () => {
    const d = deliveryOptions();
    expect(d.crewDevice).toBe(true);
    expect(d.approvalPage).toBe(true);
    expect(d.emailSend).toBe(false);
    expect(d.emailNote).toMatch(/does not send email/i);
  });
});

describe('acceptance records WHAT was accepted', () => {
  const hash = letterHash(composeAccessLetter(base));

  it('stores the hash of the exact letter on the screen', () => {
    const r = recordAcceptance({
      jobId: 'job-1', neighborEmail: ' Neighbour@Example.COM ', letterHash: hash,
      channel: 'approval_page', crewMemberId: null, now: '2026-08-03T14:00:00Z',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.consent.letterHash).toBe(hash);
    expect(r.consent.neighborEmail).toBe('neighbour@example.com');
  });

  it('a changed letter produces a different hash — the record cannot be back-dated onto new words', () => {
    const other = letterHash(composeAccessLetter({ ...base, reason: 'Different reason entirely.' }));
    expect(other).not.toBe(hash);
  });

  it('refuses an acceptance that cannot say which letter was shown', () => {
    const r = recordAcceptance({
      jobId: 'job-1', neighborEmail: 'a@b.co', letterHash: '', channel: 'approval_page',
      crewMemberId: null, now: '2026-08-03T14:00:00Z',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.problem).toMatch(/was not identified/i);
  });

  it('refuses a crew-phone acceptance with no witness', () => {
    const r = recordAcceptance({
      jobId: 'job-1', neighborEmail: 'a@b.co', letterHash: hash, channel: 'crew_device',
      crewMemberId: null, now: '2026-08-03T14:00:00Z',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.problem).toMatch(/which crew member/i);
  });

  it('refuses an email that is obviously wrong', () => {
    for (const bad of ['', 'not-an-email', 'a@b', 'a b@c.co']) {
      const r = recordAcceptance({
        jobId: 'job-1', neighborEmail: bad, letterHash: hash, channel: 'approval_page',
        crewMemberId: null, now: '2026-08-03T14:00:00Z',
      });
      expect(r.ok, `should have refused ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('keeps the neighbour out of the logs (§4.3)', () => {
    const r = recordAcceptance({
      jobId: 'job-1', neighborEmail: 'neighbour@example.com', letterHash: hash,
      channel: 'crew_device', crewMemberId: 'crew-7', now: '2026-08-03T14:00:00Z',
    });
    if (!r.ok) throw new Error('unreachable');
    const line = consentLogLine(r.consent);
    expect(line).not.toContain('neighbour@example.com');
    expect(line).not.toContain('@');
    expect(line).toContain('job=job-1');
  });
});

describe('what the crew sees before stepping over the line', () => {
  const consent = {
    jobId: 'job-1', neighborEmail: 'n@example.com', letterHash: letterHash(composeAccessLetter(base)),
    channel: 'crew_device' as const, crewMemberId: 'crew-7', acceptedAt: '2026-08-03T14:00:00Z',
  };

  it('no record is "nobody asked", explicitly not "they said no"', () => {
    const s = consentStanding(null);
    expect(s.granted).toBe(false);
    expect(s.line).toBe(NO_CONSENT_ON_FILE);
    expect(s.line).toMatch(/not a no/i);
  });

  it('a live consent reads as granted and says which route it came in on', () => {
    const s = consentStanding(consent);
    expect(s.granted).toBe(true);
    expect(s.line).toMatch(/on a crew phone/i);
  });

  it('a withdrawn consent is a hard no, louder than never asking', () => {
    const s = consentStanding({ ...consent, withdrawnAt: '2026-08-04T09:00:00Z' });
    expect(s.granted).toBe(false);
    expect(s.line).toMatch(/WITHDRAWN/);
    expect(s.line).toMatch(/do not enter/i);
    // The two negative states must not read the same — one means ask, the
    // other means stop.
    expect(s.line).not.toBe(NO_CONSENT_ON_FILE);
  });
});
