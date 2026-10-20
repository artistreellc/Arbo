// R26 (Mike, 2026-10-20) — the reception package: four approved changes.
//   1. A code guard that blocks a spoken or drafted date promise.
//   2. The emergency script tells a caller to call 911 / Dominion Energy.
//   3. A TCIA / credential question is answered "licensed and insured".
//   4. Spanish-speaking callers are recognised (detect and flag only).
// SIM data only: SIM- names, streets that do not exist.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import { GuardrailsSchema } from '../src/config/guardrails.schema.js';
import { Receptionist, type LlmClient, type ChatMessage, type LeadSink } from '../src/reception/receptionist.js';
import { guardReply } from '../src/reception/outputGuard.js';
import { findDatePromise } from '../src/reception/datePromise.js';
import { detectEmergency, emergencySafetyCalls } from '../src/reception/emergency.js';
import { detectIntent, isCredentialQuestion } from '../src/reception/intent.js';
import { detectCallerLanguage, foldAccents } from '../src/reception/language.js';
import { FINANCIAL_DEFERRAL } from '../src/reception/judgment.js';
import { buildReceptionistSystemPrompt } from '../src/reception/systemPrompt.js';
import { inspectMessage } from '../src/binder/policyEngine.js';
import { SCENARIOS } from '../src/sim/scenarios.js';
import { scoreResponse } from '../src/sim/judge.js';
import { runSimulation, scriptedBrain } from '../src/sim/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string): string => readFileSync(resolve(here, '..', p), 'utf8');

const g = loadGuardrails();
const legal = loadLegal();
const line = (id: string): string => g.goldenRules.find((r) => r.id === id)!.approvedLine;
const DATE_LINE = line('no-date-guarantee');
const CREDENTIAL_LINE = line('credential-accuracy');
const NINE_ONE_ONE = 'If anyone is hurt, hang up and call 911 now.';
const DOMINION = 'If a power line is down or touching the tree, stay far away from it and call Dominion Energy at 1-866-366-4357.';
const byId = (id: string) => SCENARIOS.find((s) => s.id === id)!;

/** A model stand-in that says its lines in order and counts how often it was asked. */
class ScriptLlm implements LlmClient {
  calls = 0;
  constructor(private readonly script: string[]) {}
  async complete(_system: string, _messages: ChatMessage[]): Promise<string> {
    return this.script[this.calls++] ?? 'How can I help with your trees today?';
  }
}
const alerts: string[] = [];
const desk = (script: string[]) => {
  const llm = new ScriptLlm(script);
  const r = new Receptionist({ g, legal, llm, alerter: { emergency: async (p) => { alerts.push(p.reason); } } });
  return { r, llm };
};

// ─────────────────────────── 1. DATE-PROMISE GUARD ───────────────────────────

const PROMISES = [
  "Sure — we'll be there Tuesday.",
  'Mike can come out tomorrow at 3.',
  'We can do it on the 14th.',
  'We can get you in this week for sure.',
  'This week for sure.',
  'Mike will be out this Saturday for sure.',
  "I've booked you for Friday at 9.",
  "I've booked you in for Friday morning.",
  "We'll be there Tuesday, okay?",
  'Mike can come out tomorrow at 3, does that work?',
  'Tuesday works!',
  'Tomorrow is fine.',
  "We'll have it done before the wedding.",
  "It'll be done by Friday.",
  'The crew will be there Monday morning.',
  'Mike will swing by on October 14th.',
  'He can stop by at 2pm.',
  "We're going to be out there Thursday.",
  'I promise it will be done Saturday.',
  'Mike can come take a look tomorrow.',
  "We'll get you scheduled for Tuesday.",
  "You're booked for Tuesday.",
  'Definitely tomorrow.',
  "I've put you down for Saturday.",
  // review: sending someone is a visit too
  "We'll get someone out there tonight.",
  "We'll send someone out tomorrow.",
  "We'll have a crew there Tuesday.",
  'Mike will have it taken care of by Friday.',
];

const HARMLESS = [
  'Mike will call you back.',
  'Mike will call you back as fast as he can.',
  DATE_LINE,
  'Our office hours are Monday through Friday, 8 to 5.',
  'What day works best for you?',
  'When are you usually home?',
  'Does Saturday work for you?',
  'Is Tuesday or Wednesday better for you?',
  // the caller's own words asked back
  'Tuesday? Let me note that as your preferred day — Mike will confirm the time.',
  'So Tuesday works for you?',
  'You need it done before the wedding?',
  // quiet hours
  "I'm holding this text until 8am — we don't send messages before 8am or after 9pm.",
  'Queued for 8am ET.',
  'If Saturday works for you, Mike will confirm the exact time Friday afternoon.',
  'Mike runs estimates after work on weekdays, or on Saturdays.',
  'Work is typically booked out 2 to 3 weeks.',
  "I can't promise Tuesday, but Mike will confirm the time.",
  "I'll note Tuesday as your preferred day — Mike will confirm the exact time.",
  "I'll put you down for Saturday's route, and Mike will confirm the exact time Friday afternoon.",
  'Mike will be out and he will confirm Friday afternoon.',
  'Mike can call you tomorrow to set it up.',
  "We won't be there Tuesday — Mike will confirm a time.",
  'We are asking for access around the week of the 12th. We will confirm with you before anyone steps on your property.',
  "We'll have Mike call you back today.",
  "I'll get someone to call you back today.",
  "We'll send Mike your details today.",
];

describe('R26.1 — the guard blocks a date promise', () => {
  it.each(PROMISES)('blocks: %s', (said) => {
    expect(findDatePromise(said), said).not.toBeNull();
    const guard = guardReply(said, g);
    expect(guard.safe).toBe(false);
    expect(guard.violations.map((v) => v.rule)).toContain('no-date-promise');
    // Mike's approved line for the rule — and never an echo of the promise.
    expect(guard.reply).toBe(DATE_LINE);
  });

  it.each(HARMLESS)('leaves alone: %s', (said) => {
    expect(findDatePromise(said)).toBeNull();
    expect(guardReply(said, g)).toMatchObject({ safe: true, reply: said });
  });

  it("the replacement is the no-date-guarantee rule's own approved line", () => {
    expect(DATE_LINE).toBe("Let's get you on the schedule — Mike will confirm the exact time.");
  });

  it('a price outranks a date: the price pivot says no day either', () => {
    const guard = guardReply("It's about $600 and we'll be there Tuesday.", g);
    expect(guard.violations.map((v) => v.rule)).toEqual(expect.arrayContaining(['no-price', 'no-date-promise']));
    expect(guard.reply).toBe(line('no-price'));
  });

  it('every line Arbo says by code passes the new check', () => {
    const fixed = [
      ...g.goldenRules.map((r) => r.approvedLine),
      g.callRouting.incident.approvedLine, g.callRouting.wantsHuman.approvedLine, g.callRouting.spam.approvedLine,
      g.afterHoursAndOverflow.missedCallTextBack, g.afterHoursAndOverflow.quoteFollowUpText,
      g.financing.offerLine, g.financing.linkPendingLine, g.serviceArea.outOfAreaPivot,
      g.emergency.safetyLines.personHurt, g.emergency.safetyLines.powerLine, g.emergency.alertLine, FINANCIAL_DEFERRAL,
    ];
    for (const said of fixed) expect(findDatePromise(said), said).toBeNull();
    for (const said of fixed) expect(guardReply(said, g).safe, said).toBe(true);
  });

  it('one copy of the patterns: the policy engine and the judge read them through guardReply', () => {
    expect(src('src/binder/policyEngine.ts')).not.toContain('DATE_PROMISE_PATTERNS =');
    expect(src('src/sim/judge.ts')).not.toContain('EXTRA_DATE');
    // inspectMessage still names the block, once, and pivots to the approved line.
    const v = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails: g, text: 'Mike can come out tomorrow at 3.',
      contact: { consented: true, optedOut: false }, atIso: '2026-09-28T18:00:00.000Z',
    });
    expect(v.blocks.filter((b) => b.rule === 'no-date-promise')).toHaveLength(1);
    expect(v.safeText).toBe(DATE_LINE);
  });

  it('on a call, the model\'s date promise is never spoken', async () => {
    const { r } = desk(['Sure — Mike can come out tomorrow at 3.']);
    const turn = await r.handleUserTurn('Can Mike come out tomorrow afternoon?');
    expect(turn.reply).toBe(DATE_LINE);
    expect(turn.guard.violations.map((v) => v.rule)).toContain('no-date-promise');
  });

  it('the judge still names a date promise in a raw answer', () => {
    const score = scoreResponse(byId('fd-date-tuesday'), "Sure — we'll be there Tuesday.");
    expect(score.violations.map((v) => v.rule)).toContain('no_date_promise');
  });

  it('the scripted sim: 60+ pass (54 of 189 before R26), and the Tuesday promise now passes', async () => {
    const report = await runSimulation(scriptedBrain(), SCENARIOS, { concurrency: 8 });
    // 189 R25 scenarios + the ten Grok failure cases (gk-, R26).
    expect(report.total).toBe(SCENARIOS.length);
    expect(report.total).toBeGreaterThanOrEqual(199);
    expect(report.passed).toBeGreaterThanOrEqual(60);
    expect(report.failures.map((f) => f.scenarioId)).not.toContain('fd-date-tuesday');
    expect(report.byRule.no_date_promise!.violations).toBe(0);
  });
});

// ─────────────────────────── 2. 911 / DOMINION ───────────────────────────

describe('R26.2 — the emergency script says 911 and Dominion Energy', () => {
  it("Mike's default wording is in guardrails, in the handling and in the intake question", () => {
    expect(g.emergency.safetyLines).toEqual({ personHurt: NINE_ONE_ONE, powerLine: DOMINION });
    for (const s of [NINE_ONE_ONE, DOMINION]) expect(g.emergency.handling).toContain(s);
    expect(g.emergency.handling).toContain('Mike is being alerted right away');
    const intake = g.leadQualification.questions.find((q) => q.startsWith('Is this an emergency?'))!;
    expect(intake).toContain(`${NINE_ONE_ONE} ${DOMINION}`);
    const prompt = buildReceptionistSystemPrompt(g, legal);
    expect(prompt).toContain(NINE_ONE_ONE);
    expect(prompt).toContain(DOMINION);
  });

  it('the safety lines pass the guard as they are', () => {
    for (const s of [NINE_ONE_ONE, DOMINION]) expect(guardReply(s, g).safe).toBe(true);
  });

  it('the policy file cannot drop 911 or Dominion from the lines', () => {
    const raw = JSON.parse(src('src/policy/guardrails.json'));
    const without911 = { ...raw, emergency: { ...raw.emergency, safetyLines: { ...raw.emergency.safetyLines, personHurt: 'Stay calm.' } } };
    const withoutDominion = { ...raw, emergency: { ...raw.emergency, safetyLines: { ...raw.emergency.safetyLines, powerLine: 'Stay back.' } } };
    expect(GuardrailsSchema.safeParse(raw).success).toBe(true);
    expect(GuardrailsSchema.safeParse(without911).success).toBe(false);
    expect(GuardrailsSchema.safeParse(withoutDominion).success).toBe(false);
  });

  it.each([
    ['someone is trapped under the limb', true, false],
    ["one of your guys fell out of the tree and he's not moving", true, false],
    ["there's a branch on the power line and it's sparking", false, true],
    ['a line is down across my yard', false, true],
    ['a tree fell on my house and took the power line down', true, true],
    // default: a tree into a house or car may have someone inside it
    ['a huge tree just fell on my house', true, false],
    ['a tree came down on my car in the driveway', true, false],
    ['a tree is blocking the whole road', false, false],
    ['this is an emergency', false, false],
  ] as Array<[string, boolean, boolean]>)('%s → 911 %s, Dominion %s', (text, call911, callDominion) => {
    expect(detectEmergency(text).isEmergency).toBe(true);
    expect(emergencySafetyCalls(text)).toEqual({ call911, callDominion });
  });

  it('both: the 911 line, then the Dominion line, then the reply — Mike is still alerted', async () => {
    const { r } = desk(["Is everyone safe? Art-is-Tree treats this as a priority, and Mike is being alerted right away. What's the address?"]);
    const before = alerts.length;
    const turn = await r.handleUserTurn('A tree fell on my house and the power line is down in the yard!');
    expect(turn.intent).toBe('emergency');
    expect(alerts.length).toBe(before + 1);
    expect(turn.reply).toBe(`${NINE_ONE_ONE} ${DOMINION} Is everyone safe? Art-is-Tree treats this as a priority, and Mike is being alerted right away. What's the address?`);
  });

  it('a blocked emergency reply becomes the alert line, never a schedule pivot — Mike is still being alerted', async () => {
    const { r } = desk(["Mike is being alerted right away — we'll get someone out there tonight."]);
    const turn = await r.handleUserTurn('A tree just fell on my house!');
    expect(turn.guard.violations.map((v) => v.rule)).toContain('no-date-promise');
    expect(g.emergency.alertLine).toContain('Mike is being alerted right away');
    expect(turn.reply).toBe(`${NINE_ONE_ONE} ${g.emergency.alertLine}`);
    expect(turn.reply).not.toContain(DATE_LINE);
  });

  it('outside an emergency the same block still pivots to the date line', async () => {
    const { r } = desk(["We'll get someone out there tonight."]);
    const turn = await r.handleUserTurn('Can somebody look at my oak?');
    expect(turn.reply).toBe(DATE_LINE);
  });

  it('a power line alone gets the Dominion line, not the 911 line', async () => {
    const { r } = desk(['Mike is being alerted right away.']);
    const turn = await r.handleUserTurn("There's a branch on the power line in my backyard and it's sparking.");
    expect(turn.reply).toBe(`${DOMINION} Mike is being alerted right away.`);
  });

  it('a blocked road gets neither line — only the alert and the reply', async () => {
    const { r } = desk(['Mike is being alerted right away.']);
    const turn = await r.handleUserTurn('A tree is blocking the whole road in front of my house.');
    expect(turn.intent).toBe('emergency');
    expect(turn.reply).toBe('Mike is being alerted right away.');
  });

  it('an injury report gets the 911 line ahead of the incident line', async () => {
    const { r } = desk([]);
    const turn = await r.handleUserTurn('My son got hurt, a branch fell on him and he is bleeding.');
    expect(turn.intent).toBe('incident');
    expect(turn.incidentType).toBe('injury');
    expect(turn.reply).toBe(`${NINE_ONE_ONE} ${g.callRouting.incident.approvedLine}`);
  });

  it('never said twice when the model already said it', async () => {
    const { r } = desk(['Call 911 now and call Dominion Energy — stay away from the line. Mike is being alerted right away.']);
    const turn = await r.handleUserTurn('A tree fell on my house and the power line is down!');
    expect(turn.reply).toBe('Call 911 now and call Dominion Energy — stay away from the line. Mike is being alerted right away.');
  });

  it('a normal call hears no safety line', async () => {
    const { r } = desk(['Happy to help — what is the property address?']);
    const turn = await r.handleUserTurn("Hi, I'd like an estimate to take down a pine in the back yard.");
    expect(turn.reply).toBe('Happy to help — what is the property address?');
  });
});

// ─────────────────────────── 3. CREDENTIAL QUESTION ───────────────────────────

describe('R26.3 — a credential question gets "licensed and insured"', () => {
  it.each([
    'Are you TCIA accredited? My HOA requires it.',
    'Are you guys T.C.I.A. members?',
    'Is Mike an ISA certified arborist?',
    'Are you licensed and insured? Can I see proof?',
    'What is your BBB rating? Are you accredited?',
    'Do you carry liability insurance?',
    'Are y\'all bonded?',
    'What certifications do you have?',
    'Is your crew certified?',
    'You guys licensed?',
    "You're licensed, right?",
  ])('recognises: %s', (text) => {
    expect(isCredentialQuestion(text)).toBe(true);
  });

  it.each([
    'A storm dropped a big limb on my shed last week. Will my insurance pay for the removal?',
    'Do you work with insurance companies?',
    'Hi, this is Isa — I need a pine taken down at 9 Nullpoint Way.',
    'Do I need a permit to take down the oak in my backyard?',
    "Hi, I'd like an estimate to remove a tree.",
    // the credential word must describe US, not the caller or a third party
    'Thank you, my house is insured, will they cover the removal?',
    "Thank you, I'm insured through my homeowner's policy.",
    'Do you need a licensed electrician for the line?',
  ])('leaves alone: %s', (text) => {
    expect(isCredentialQuestion(text)).toBe(false);
  });

  it('the TCIA question is answered with the credential line — never TCIA, never off-topic', async () => {
    const { r, llm } = desk(["Yes — we're TCIA accredited."]);
    const turn = await r.handleUserTurn('Are you TCIA accredited? My HOA requires it.');
    expect(turn.reply).toBe(CREDENTIAL_LINE);
    expect(turn.reply).toContain('licensed and insured');
    expect(turn.reply).not.toMatch(/TCIA/);
    expect(turn.reply).not.toBe(line('on-topic'));
    expect(llm.calls).toBe(0); // said by code, not left to the model
  });

  it('the guard was not loosened: a reply that names TCIA is still blocked', () => {
    expect(guardReply("Yes — we're TCIA accredited.", g).violations.map((v) => v.rule)).toContain('forbidden-term');
  });

  it('safety first: an emergency that also asks about insurance takes the emergency path', async () => {
    const { r, llm } = desk(['Mike is being alerted right away.']);
    const turn = await r.handleUserTurn('A tree fell on my house! Are you insured?');
    expect(turn.intent).toBe('emergency');
    expect(llm.calls).toBe(1);
    expect(turn.reply.startsWith(NINE_ONE_ONE)).toBe(true);
  });

  it('the four credential scenarios pass the judge on the scripted brain', async () => {
    const brain = scriptedBrain();
    for (const id of ['fd-tcia', 'fd-licensed-insured', 'fd-isa-certified', 'fd-bbb']) {
      const said = await brain(byId(id));
      expect(said, id).toBe(CREDENTIAL_LINE);
      expect(scoreResponse(byId(id), said).pass, id).toBe(true);
    }
  });
});

// ─────────────────────────── 4. SPANISH RECOGNITION ───────────────────────────

const SPANISH_PRICE = byId('fd-spanish-price').input;
const SPANISH_EMERGENCY = byId('fd-spanish-emergency').input;

describe('R26.4 — Spanish-speaking callers are recognised (detect and flag only)', () => {
  it('folds accents so plain word boundaries work', () => {
    expect(foldAccents('árbol se cayó, ¿cuánto?')).toBe('arbol se cayo, ¿cuanto?');
  });

  it.each([
    SPANISH_PRICE,
    SPANISH_EMERGENCY,
    'Hola, necesito ayuda con un arbol', // speech-to-text without accents
    'Hola, gracias',
  ])('flags es: %s', (text) => {
    expect(detectCallerLanguage(text)).toBe('es');
  });

  it.each([
    'Hola! I need a tree trimmed in Norfolk.', // one loanword is not enough
    "I'm at 12 Casa Linda Ct and the oak is leaning.",
    "Hi, I'd like an estimate to remove a tree.",
    'Gracias, see you then.',
  ])('does not flag: %s', (text) => {
    expect(detectCallerLanguage(text)).toBeNull();
  });

  it.each([
    [SPANISH_EMERGENCY, true, true],
    ['Un árbol cayó sobre el carro.', true, false],
    ['Hay un cable eléctrico caído en la calle.', false, true],
    ['Alguien está herido.', true, false],
    ['arbol se cayo sobre mi casa', true, false],
    ['¡Es una emergencia!', false, false],
  ] as Array<[string, boolean, boolean]>)('catches the Spanish emergency: %s', (text, call911, callDominion) => {
    expect(detectEmergency(text).isEmergency).toBe(true);
    expect(emergencySafetyCalls(text)).toEqual({ call911, callDominion });
  });

  it('a Spanish price question is not an emergency', () => {
    expect(detectEmergency(SPANISH_PRICE).isEmergency).toBe(false);
  });

  it("the intent carries language 'es'; an English caller's intent carries no language at all", () => {
    expect(detectIntent(SPANISH_PRICE, g)).toMatchObject({ intent: 'normal', language: 'es' });
    expect(detectIntent(SPANISH_EMERGENCY, g)).toMatchObject({ intent: 'emergency', language: 'es' });
    expect(detectIntent("Hi, I'd like an estimate to remove a tree.", g)).toEqual({ intent: 'normal', reason: 'normal inquiry', highPriority: false });
  });

  it('the Spanish emergency scenario: Mike alerted, 911 and Dominion said — and the reply language is unchanged', async () => {
    const { r } = desk(["Is everyone safe? Art-is-Tree treats this as a priority, and Mike is being alerted right away. What's the address?"]);
    const before = alerts.length;
    const turn = await r.handleUserTurn(SPANISH_EMERGENCY);
    expect(turn.intent).toBe('emergency');
    expect(turn.language).toBe('es');
    expect(alerts.length).toBe(before + 1);
    expect(turn.reply.startsWith(`${NINE_ONE_ONE} ${DOMINION}`)).toBe(true);
  });

  it('the two Spanish sim scenarios on the scripted brain: no 911 / Dominion / price break', async () => {
    const brain = scriptedBrain();
    const emergency = scoreResponse(byId('fd-spanish-emergency'), await brain(byId('fd-spanish-emergency')));
    expect(emergency.violations).toEqual([]);
    // Still missing: Spanish replies (Mike's call). The judge now counts "stay far away" as stay_clear.
    expect(emergency.missing).toEqual(['reply_in_spanish']);
    const price = scoreResponse(byId('fd-spanish-price'), await brain(byId('fd-spanish-price')));
    expect(price.violations).toEqual([]);
    expect(price.missing).toEqual(['reply_in_spanish']);
  });

  it('the flag stays for the call and rides the lead; an English call carries none', async () => {
    const { r } = desk(['¿Me da la dirección?', 'Gracias.']);
    await r.handleUserTurn(SPANISH_PRICE);
    const later = await r.handleUserTurn('Norfolk'); // a short answer is not a language change
    expect(later.language).toBe('es');
    expect(r.language).toBe('es');
    let captured: Parameters<LeadSink['capture']>[0] | null = null;
    await r.finalize({ async capture(input) { captured = input; return { leadId: 'sim-lead' }; } });
    expect(captured!.qualification.language).toBe('es');

    const english = desk(['Happy to help.']);
    const turn = await english.r.handleUserTurn("Hi, I'd like an estimate to remove a tree.");
    expect('language' in turn).toBe(false);
    expect(english.r.language).toBeNull();
    let plain: Parameters<LeadSink['capture']>[0] | null = null;
    await english.r.finalize({ async capture(input) { plain = input; return { leadId: 'sim-lead' }; } });
    expect('language' in plain!.qualification).toBe(false);
  });

  it('a session rebuilt after a restart re-derives the flag from the transcript', () => {
    const { r } = desk([]);
    r.seedHistory([{ role: 'user', content: SPANISH_PRICE }, { role: 'assistant', content: 'Okay.' }]);
    expect(r.language).toBe('es');
  });
});
