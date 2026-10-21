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
import { Receptionist, END_CALL_MARKER as RECEPTION_END_CALL, type LlmClient, type ChatMessage, type LeadSink } from '../src/reception/receptionist.js';
import { createElevenLabsBridge, END_CALL_MARKER, type CallHold } from '../src/voice/elevenlabsBridge.js';
import { CallRecordStore } from '../src/reception/callMemory.js';
import { guardReply } from '../src/reception/outputGuard.js';
import { findDatePromise } from '../src/reception/datePromise.js';
import { detectEmergency, emergencySafetyCalls, injuryDenied } from '../src/reception/emergency.js';
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
  // Review round 2 (2026-10-20): plain promises the first list missed.
  'See you Tuesday!',
  'Mike will see you tomorrow at 3.',
  'We can do Tuesday at 2.',
  "Let's do Tuesday at 3.",
  'Tuesday at 2 works.',
  "I'll put you down for Tuesday.",
  "I'll book you for Tuesday.",
  'I have you down for Tuesday.',
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
  // review: a typographic apostrophe (’) is the same contraction
  'We’ll be there Tuesday.',
  'I’ve booked you for Friday.',
  'You’re booked for Tuesday.',
  'Mike’ll be out tomorrow.',
  // review: a yes to the day, then the next question in the same sentence
  "Tuesday works — what's the property address?",
  'Tuesday is fine, can I get your address?',
  'Tomorrow at 3, no problem — can I get your name?',
  'Definitely tomorrow, can I get your name?',
  'Tuesday works, okay?',
  // review: "coming" said as the future, and a clock time without "at"
  "Mike's coming out Tuesday.",
  "We're coming Tuesday.",
  'The crew is coming Monday.',
  "We'll be there by 3pm.",
  'Mike will be out around 9am.',
  "We'll be out by noon.",
  // review: the old text check blocked "midday"; folding it in must not lose it
  'We will be there at midday.',
  "We'll be out by midday.",
  // review: the deferral fixes stay narrow — these still block
  'Saturday, no problem.',
  'Tomorrow, guaranteed.',
  'I promise Tuesday.',
  'If you want, we can be there Saturday.',
  "We'll be there Saturday if that works.",
  "Mike will call you, and we'll be out tomorrow for sure.",
];

const HARMLESS = [
  'See you then!',
  "If we can do Tuesday, Mike will let you know.",
  "I'll put you on Saturday's route — Mike confirms the exact time Friday afternoon.",
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
  // review: "can’t" with a typographic apostrophe is still a negation
  'I can’t promise Tuesday, but Mike will confirm.',
  // review: a question still shields its own clause
  "If Tuesday works, what's your address?",
  'Which day works, Tuesday or Wednesday?',
  'Does Tuesday work, or is Wednesday better?',
  // review: coming BACK to the caller is a callback, not a visit
  "Mike's coming back to you on that tomorrow.",
  // review: "that's coming" is the storm, not us
  "With the storm that's coming tomorrow, please stay clear of the tree.",
  // review: deferring the day to Mike is what the rule asks for
  'Mike will let you know if he can come out Saturday.',
  "I'll ask Mike if he can come out Saturday.",
  'Mike will confirm whether we can be there tomorrow.',
  "Mike will let you know if he's coming out Saturday.",
  // review: declining to promise
  "I don't want to promise Tuesday.",
  "I'm not able to promise Tuesday.",
  // review: a callback, however sure, is not a visit
  'Mike will call you back today for sure.',
  "He'll get back to you tomorrow for sure.",
  "I'll get your details to Mike today, no problem.",
  // review: "a Saturday" is any Saturday — Mike's estimates fact, not a day
  "Mike can come by after work or on a Saturday — he'll confirm the time.",
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

  it('a text that promises "midday" is still blocked, as the old text check did', () => {
    for (const text of ['We will be there at midday.', "We'll be out by midday."]) {
      const v = inspectMessage({
        audience: 'customer', channel: 'sms', guardrails: g, text,
        contact: { consented: true, optedOut: false }, atIso: '2026-09-28T18:00:00.000Z',
      });
      expect(v.blocks.map((b) => b.rule), text).toContain('no-date-promise');
      expect(v.safeText, text).toBe(DATE_LINE);
    }
  });

  it('on a call, the model\'s date promise is never spoken', async () => {
    const { r } = desk(['Sure — Mike can come out tomorrow at 3.']);
    const turn = await r.handleUserTurn('Can Mike come out tomorrow afternoon?');
    expect(turn.reply).toBe(DATE_LINE);
    expect(turn.guard.violations.map((v) => v.rule)).toContain('no-date-promise');
  });

  it('a blocked goodbye keeps the hang-up: the safe line is said, then the call ends', async () => {
    expect(RECEPTION_END_CALL).toBe(END_CALL_MARKER); // one marker, re-exported by the bridge
    const { r } = desk([`Sounds like Thursday works for you — I'll pass that along to Mike and he'll confirm. Thanks, have a good one! ${END_CALL_MARKER}`]);
    const turn = await r.handleUserTurn('Thursday works for me. Thanks, bye!');
    expect(turn.guard.violations.map((v) => v.rule)).toContain('no-date-promise');
    expect(turn.reply).toBe(`${DATE_LINE} ${END_CALL_MARKER}`);
  });

  it('a blocked emergency goodbye keeps the hang-up after the alert line', async () => {
    const { r } = desk([`Mike is being alerted right away — we'll get someone out there tonight. Stay safe! ${END_CALL_MARKER}`]);
    const turn = await r.handleUserTurn('A tree just fell on my house!');
    expect(turn.reply).toBe(`${NINE_ONE_ONE} ${g.emergency.alertLine} ${END_CALL_MARKER}`);
  });

  it('a blocked turn that was not a goodbye gains no hang-up', async () => {
    const { r } = desk(["We'll be there Tuesday — what's the address?"]);
    const turn = await r.handleUserTurn('Can somebody look at my oak?');
    expect(turn.reply).toBe(DATE_LINE);
  });

  it('on the bridge, a blocked goodbye still hangs up and still files the record and the R18 hold', async () => {
    const holds: CallHold[] = [];
    const records = new CallRecordStore();
    const llm = new ScriptLlm([
      "Got it — what's the property address?",
      `Sounds like Thursday works for you — I'll pass that along to Mike and he'll confirm. Thanks, have a good one! ${END_CALL_MARKER}`,
    ]);
    const bridge = createElevenLabsBridge({
      guardrails: g, legal, llm, alerter: { emergency: async () => {} }, bridgeSecret: 's',
      callRecords: records,
      calendarHold: async (h: CallHold) => { holds.push(h); },
      googleWrites: true, // the dormant R18 path — R33 keeps holds off in the app (test/r33ReadOnly.test.ts)
      now: () => Date.parse('2026-09-22T15:00:00Z'),
    });
    const tools = [{ type: 'function', function: { name: 'end_call' } }];
    const said = ['Hi, this is SIM-Sam, I need a big oak removed at 9 Nullpoint Way.', 'ack', 'Thursday works for me. Thanks, bye!'];
    const call = (n: number) => bridge.handle('Bearer s', {
      user: '+17575550142', elevenlabs_extra_body: { conversation_id: 'sim-goodbye' }, tools,
      messages: said.slice(0, n).map((content, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content })),
    });
    await call(1);
    const out = await call(3);
    await new Promise((res) => setTimeout(res, 0)); // the hold is fire-and-forget
    const choice = (out.json as { choices: Array<{ message: { content: string; tool_calls?: unknown[] }; finish_reason: string }> }).choices[0]!;
    expect(choice.message.content).toBe(DATE_LINE); // the safe line, the marker never spoken
    expect(choice.finish_reason).toBe('tool_calls'); // the call ends
    expect(choice.message.tool_calls).toHaveLength(1);
    expect(records.list()).toHaveLength(1);
    expect(holds).toHaveLength(1);
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
    // review: a named person hurt, trapped or pinned
    ['My husband is hurt, a limb fell on him.', true, false],
    ["He's trapped under the tree.", true, false],
    ['My wife is pinned under a branch.', true, false],
    ['My son got hurt by a falling branch.', true, false],
    // review: a line on the ground, or a tree into the lines (plural too)
    ['The power line is on the ground.', false, true],
    ['Tree fell into the power lines.', false, true],
    ['The tree fell on the lines.', false, true],
    ['The tree is on the wires.', false, true],
    ['A tree is on the power lines.', false, true],
    ['A limb is on the power lines.', false, true],
  ] as Array<[string, boolean, boolean]>)('%s → 911 %s, Dominion %s', (text, call911, callDominion) => {
    expect(detectEmergency(text).isEmergency).toBe(true);
    expect(emergencySafetyCalls(text)).toEqual({ call911, callDominion });
  });

  it.each([
    'My truck is stuck in the yard.',
    'Can you trim the branches near the power lines?',
  ])('a routine call stays routine: %s', (text) => {
    expect(detectEmergency(text).isEmergency).toBe(false);
    expect(emergencySafetyCalls(text)).toEqual({ call911: false, callDominion: false });
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

// ─────────────── R29 #4 — DOWNED LINE, NOBODY HURT: DOMINION ONLY ───────────────
// Mike, 2026-10-20 (R29 #4): a downed power line with nobody hurt keeps the
// Dominion line only — NOT 911 ("call dominion"). Only an explicit denial
// drops the 911 line ("nobody hurt", "no one is injured", "nobody was
// injured", "no injuries", and the Spanish "nadie está herido", "no hay
// heridos"). Anything that leaves a person possibly hurt keeps it: another
// hurt word, "but my son…", "nobody else", a hedge ("I think"), a question,
// or a tree on a house or car. Detection stays sensitive: the intent, the
// alert to Mike and the notify tier do not move.
describe('R29 #4 — a downed line with nobody hurt: the Dominion line only, never 911 (Direction B P5)', () => {
  const INCIDENT_LINE = g.callRouting.incident.approvedLine;

  it.each([
    'The power line is down, nobody was injured.',
    'A line is down in the yard — no one is injured.',
    'Power line down, nobody hurt.',
    'A limb took the power line down. No injuries.',
    "There's a power line down but nobody's hurt.",
    'There’s a power line down but nobody’s hurt.',
    'Nobody was injured, but the wires are sparking.',
    'Se cayó un cable de luz, nadie está herido.',
    'Hay cables en el suelo. Nadie salió lastimado.',
    'Los cables se cayeron, no hay heridos.',
    'Se cayeron los cables, nadie se lastimó.',
  ])('denied: %s → injuryDenied', (text) => {
    expect(injuryDenied(text)).toBe(true);
  });

  it.each([
    // another hurt word, before or after the denial
    'No one is injured but my son is bleeding.',
    'My son is bleeding, nobody else is hurt.',
    // an exception that names a person
    'Nobody was injured except my dad.',
    "Nobody's hurt but my wife.",
    // "nobody else" says someone IS hurt
    'Nobody else was injured, but the line is down.',
    // a hedge, or a question
    "Nobody's hurt I think, the power line is down.",
    'Nobody hurt? The power line is down.',
    'Nobody was injured, right? The power line is down.',
    // no denial at all
    'Is anyone hurt? No. The power line is down.',
    'My son is hurt and a line is down.',
    'I am not hurt but the line is down.',
    // Spanish
    'Nadie está herido pero mi hijo está sangrando.',
    'Creo que nadie está herido, los cables están en el suelo.',
    'Nadie más se lastimó, pero los cables están en el suelo.',
  ])('not denied: %s', (text) => {
    expect(injuryDenied(text)).toBe(false);
  });

  it.each([
    'The power line is down, nobody was injured.',
    'A line is down in the yard — no one is injured.',
    'Power line down, nobody was seriously injured.',
  ])('English, run: "%s" (the injury path) → Dominion, no 911; Mike alerted as before', async (text) => {
    const { r } = desk([]);
    const before = alerts.length;
    const turn = await r.handleUserTurn(text);
    expect(turn.reply).toBe(`${DOMINION} ${INCIDENT_LINE}`);
    expect(turn.reply).not.toContain('911');
    // Detection did not move: still the injury incident, still the alert, still the same tier.
    expect(turn.intent).toBe('incident');
    expect(turn.incidentType).toBe('injury');
    expect(alerts.length).toBe(before + 1);
    expect(alerts.at(-1)).toMatch(/^INCIDENT \(injury\)/);
    const hurt = await desk([]).r.handleUserTurn('My son got hurt, a branch fell on him and he is bleeding.');
    expect(turn.notify).toEqual(hurt.notify);
  });

  it.each([
    // No injury trigger in these: they ride the power-line emergency, which never said 911 — and still does not.
    'A limb took the power line down. No injuries.',
    "There's a power line down but nobody's hurt.",
    // Spanish: "herido" is a person-in-danger word, so before R29 #4 these heard 911 too.
    'Se cayó un cable de luz, nadie está herido.',
    'Los cables se cayeron, no hay heridos.',
    'Se cayeron los cables, nadie se lastimó.',
  ])('the power-line emergency, run: "%s" → Dominion, no 911; Mike alerted as before', async (text) => {
    expect(emergencySafetyCalls(text)).toEqual({ call911: false, callDominion: true });
    const { r } = desk(['Mike is being alerted right away.']);
    const before = alerts.length;
    const turn = await r.handleUserTurn(text);
    expect(turn.intent).toBe('emergency');
    expect(alerts.length).toBe(before + 1);
    expect(alerts.at(-1)).toBe(detectEmergency(text).reason);
    expect(turn.reply).toBe(`${DOMINION} Mike is being alerted right away.`);
  });

  it.each([
    ['No one is injured but my son is bleeding.', false],
    ['Nobody else was injured, but the line is down.', true],
    // (an injury word, so the injury path is the one that must not drop it)
    ['Nobody was injured I think, the power line is down.', true],
    ['Nobody injured? The power line is down.', true],
    ['Is anyone hurt? No. The power line is down.', true],
    ['My son is hurt and a line is down.', true],
  ] as Array<[string, boolean]>)('keeps 911 whenever someone may be hurt: %s', async (text, dominion) => {
    const { r } = desk(['Mike is being alerted right away.']);
    const turn = await r.handleUserTurn(text);
    expect(turn.reply.startsWith(NINE_ONE_ONE)).toBe(true);
    expect(turn.reply.includes(DOMINION)).toBe(dominion);
  });

  it.each([
    ['A tree fell on my house and took the power line down — nobody was injured.', true],
    ['Nobody was injured, but a tree came down on my car.', false],
    ['Se cayó un árbol sobre la casa, nadie está herido.', false],
  ] as Array<[string, boolean]>)('a tree on a house or car keeps 911 even with "nobody hurt" (someone may be inside): %s', async (text, dominion) => {
    expect(emergencySafetyCalls(text).call911).toBe(true);
    const { r } = desk(['Mike is being alerted right away.']);
    const turn = await r.handleUserTurn(text);
    expect(turn.reply.startsWith(NINE_ONE_ONE)).toBe(true);
    expect(turn.reply.includes(DOMINION)).toBe(dominion);
  });

  it.each([
    'Nadie está herido pero mi hijo está sangrando.',
    'Creo que nadie está herido, los cables están en el suelo.',
  ])('Spanish keeps 911 whenever someone may be hurt: %s', async (text) => {
    expect(emergencySafetyCalls(text).call911).toBe(true);
    const { r } = desk(['Mike is being alerted right away.']);
    const turn = await r.handleUserTurn(text);
    expect(turn.reply.startsWith(NINE_ONE_ONE)).toBe(true);
  });

  it('the guardrails and the intent are untouched: "injured" is still an injury trigger, and the line still reads 911', () => {
    expect(g.callRouting.incident.triggers.injury).toContain('injured');
    expect(detectIntent('The power line is down, nobody was injured.', g)).toMatchObject({ intent: 'incident', incidentType: 'injury' });
    expect(g.emergency.safetyLines.personHurt).toBe(NINE_ONE_ONE);
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
    // review: the certified-arborist question, the way callers ask it
    'Do you have a certified arborist?',
    'Do you have any certified arborists?',
    'Do you guys employ certified arborists?',
    'Is your arborist certified?',
    'Is there a certified arborist who will look at it?',
    'Is the person coming out a certified arborist?',
    'Are you I.S.A.?',
    // review: narrowing the insurance pattern keeps these
    'Do you have insurance?',
    'Do you guys have a license?',
    'Do you have proof of insurance?',
    'Do you carry general liability insurance?',
    'Do you have workers comp insurance?',
    // ...and keeps what the open gap used to catch
    'Do you have a certificate of insurance?',
    'Do you have any kind of insurance?',
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
    // review: an arborist the CALLER needs is not a question about us
    'My HOA says I need a certified arborist letter.',
    'Is the city going to require a certified arborist?',
    'Is the county going to want a certified arborist report?',
    'Do you have to use a certified arborist for the permit?',
    // review: the caller's own insurance claim goes to the model (Mike's INSURANCE fact)
    'Do you have experience with insurance claims?',
    'Does Mike have time to talk to my insurance adjuster?',
    'Do you have to deal with my insurance company?',
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

  it('"do you have a certified arborist?" is answered by code, not the model', async () => {
    const { r, llm } = desk(['Yes, Mike is a certified arborist.']);
    const turn = await r.handleUserTurn('Do you have a certified arborist?');
    expect(turn.reply).toBe(CREDENTIAL_LINE);
    expect(llm.calls).toBe(0);
  });

  it("a question about the caller's own insurance claim reaches the model, not the credential line", async () => {
    const answer = 'Mike works with insurance companies and goes over that with you himself. What is the property address?';
    const { r, llm } = desk([answer]);
    const turn = await r.handleUserTurn('Do you have experience with insurance claims?');
    expect(llm.calls).toBe(1);
    expect(turn.reply).toBe(answer);
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
    // review: a tree resting on the house or car
    ['Hay un árbol encima de la casa.', true, false],
    ['Un árbol está sobre mi carro.', true, false],
    ['Hay un árbol en el techo.', true, false],
    // review: fallen cables, either word order, or a tree touching them
    ['Los cables se cayeron.', false, true],
    ['Se cayeron los cables.', false, true],
    ['El árbol está tocando los cables.', false, true],
    // review: someone hurt, said the everyday way
    ['Necesito una ambulancia, mi esposo se cayó del árbol.', true, false],
    ['Mi hijo se lastimó.', true, false],
    // review: a fence, as in English
    ['El árbol tumbó la cerca.', true, false],
    ['Se cayó un árbol sobre la cerca de mi vecino.', true, false], // "the neighbour's fence"
  ] as Array<[string, boolean, boolean]>)('catches the Spanish emergency: %s', (text, call911, callDominion) => {
    expect(detectEmergency(text).isEmergency).toBe(true);
    expect(emergencySafetyCalls(text)).toEqual({ call911, callDominion });
  });

  it('a Spanish price question is not an emergency', () => {
    expect(detectEmergency(SPANISH_PRICE).isEmergency).toBe(false);
  });

  it.each([
    'Tengo un árbol en mi casa que quiero podar.', // a tree AT my house, to prune
    'Vi su anuncio en línea.', // "online", not a power line
    'Perdón, se cayó la línea.', // the call dropped
    'Se cayó una rama cerca de la calle.', // "cerca de" here is "near"
  ])('a routine Spanish line is not an emergency: %s', (text) => {
    expect(detectEmergency(text).isEmergency).toBe(false);
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
