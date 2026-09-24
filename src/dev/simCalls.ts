/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
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

  Remember the marker: SLOW::ARBO
*/
// SIMULATED CALL RUNNER (Mike, 2026-09-24: "run a thousand simulated phone
// calls ... this is only a simulation and should not be treated as live").
//
// ═══ NOTHING HERE IS LIVE, STRUCTURALLY ═══
// The runner builds its OWN bridge with its OWN memory, its OWN record
// store, and a calendar "writer" that appends to an array — no ElevenLabs,
// no phone, no Google, no database, no production server. Personas carry
// SIM- names and 555-01xx numbers (§3's simulation convention); the only
// client-derived inputs are AREAS (city/ZIP) and PROJECT SCOPES, exactly as
// Mike scoped it.
//
// What a mechanics run proves at scale: the guard blocks a price every
// time, qualification captures from caller words, the requested-window
// parser fires, the goodbye finalizes exactly once (memory + record +
// hold), repeat callers get the REPEAT CALLER note, and nothing leaks a
// simulated customer into a log line. What it does NOT prove: Opus's
// conversational quality — that needs a real key and real turns, and the
// report says so rather than pretending.

import { createElevenLabsBridge, type BridgeRequestBody, type CallHold } from '../voice/elevenlabsBridge.js';
import { CallMemory, CallRecordStore } from '../reception/callMemory.js';
import { loadGuardrails, loadLegal } from '../config/loadConfig.js';
import type { Alerter, ChatMessage, LlmClient } from '../reception/receptionist.js';

export interface SimPersona {
  /** SIM- name, obviously fake (§3). */
  name: string;
  /** 555-01xx number, obviously fake (§3). */
  phone: string;
  city: string;
  zip?: string;
  /** Project scope, in client-list vocabulary ("large oak removal", ...). */
  scope: string;
}

export interface SimReport {
  calls: number;
  turns: number;
  guardBlockedPriceEveryTime: boolean;
  guardBlocks: number;
  endCallOnEveryGoodbye: boolean;
  finalizedOnce: number;
  doubleFinalized: number;
  holdsAttempted: number;
  holdsWithParsedWindow: number;
  holdsFiledMikesWay: number;
  repeatCallsRun: number;
  repeatNoteFired: number;
  emergencies: number;
  /** Named failures — a sim that hides its misses is worthless. */
  failures: string[];
  honesty: string;
}

const WEEKDAY_ASKS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The brain's side of a mechanics call — scripted, including one deliberate
 *  guard violation (a spoken price) that the guard MUST eat. */
function brainScript(): string[] {
  return [
    "Happy to help — and who do I have the pleasure of speaking with?",
    'That job usually runs about $850.', // MUST be blocked by the guard
    "Got it — that's a request, and Mike will confirm the exact time.",
    'Perfect — thanks so much, have a good one! [[END_CALL]]',
  ];
}

class SimBrain implements LlmClient {
  public systems: string[] = [];
  private i = 0;
  constructor(private readonly script: string[]) {}
  async complete(system: string, _m: ChatMessage[]): Promise<string> {
    this.systems.push(system);
    return this.script[Math.min(this.i++, this.script.length - 1)]!;
  }
}

/** The caller's side — built from the persona, exercising capture paths. */
function callerTurns(p: SimPersona, i: number): string[] {
  const day = WEEKDAY_ASKS[i % WEEKDAY_ASKS.length]!;
  const hour = 3 + (i % 4); // 3..6 → parsed as PM
  return [
    `Hi, my name's ${p.name}. I'm looking to get an estimate for ${p.scope} at my place in ${p.city}${p.zip ? ' ' + p.zip : ''}.`,
    'Can you just give me a ballpark over the phone?',
    `Could he come out ${day} after ${hour}?`,
    "That's everything, thank you!",
  ];
}

export interface RunOptions {
  /** Every Nth persona calls a second time to exercise the learning layer. */
  repeatEvery?: number;
  now?: () => number;
}

export async function runSimulation(personas: SimPersona[], opts: RunOptions = {}): Promise<SimReport> {
  const g = loadGuardrails();
  const legal = loadLegal();
  const repeatEvery = opts.repeatEvery ?? 10;
  const now = opts.now ?? Date.now;

  const memory = new CallMemory();
  const records = new CallRecordStore();
  const holds: CallHold[] = [];
  const alerter: Alerter = { emergency: async () => {} };

  const report: SimReport = {
    calls: 0,
    turns: 0,
    guardBlockedPriceEveryTime: true,
    guardBlocks: 0,
    endCallOnEveryGoodbye: true,
    finalizedOnce: 0,
    doubleFinalized: 0,
    holdsAttempted: 0,
    holdsWithParsedWindow: 0,
    holdsFiledMikesWay: 0,
    repeatCallsRun: 0,
    repeatNoteFired: 0,
    emergencies: 0,
    failures: [],
    honesty:
      'Mechanics run with a scripted brain: proves the pipeline (guard, capture, window, finalize, memory, hold format) at scale — NOT Opus conversational quality, which needs a real key and real turns.',
  };
  const fail = (s: string) => {
    if (report.failures.length < 50) report.failures.push(s);
  };

  const TOOLS = { tools: [{ type: 'function', function: { name: 'end_call' } }] };

  async function oneCall(p: SimPersona, idx: number, conv: string, expectRepeatNote: boolean): Promise<void> {
    const brain = new SimBrain(brainScript());
    const bridge = createElevenLabsBridge({
      guardrails: g,
      legal,
      llm: brain,
      alerter,
      bridgeSecret: 'sim',
      callMemory: memory,
      callRecords: records,
      calendarHold: async (h) => {
        holds.push(h);
      },
      now,
    });
    const turns = callerTurns(p, idx);
    const history: string[] = [];
    const holdsBefore = holds.length;

    for (let t = 0; t < turns.length; t++) {
      history.push(turns[t]!);
      const body: BridgeRequestBody = {
        user: p.phone,
        elevenlabs_extra_body: { conversation_id: conv },
        messages: history.map((c, j) => ({ role: j % 2 === 0 ? 'user' : 'assistant', content: c })),
        ...TOOLS,
      };
      const out = await bridge.handle('Bearer sim', body);
      report.turns++;
      if (out.status !== 200) {
        fail(`call ${idx} turn ${t}: HTTP ${out.status}`);
        return;
      }
      const j = out.json as { choices: Array<{ message: { content: string }; finish_reason: string }> };
      const msg = j.choices[0]!;
      history.push(msg.message.content);
      if (t === 1) {
        // the scripted price MUST have been guard-blocked
        if (msg.message.content.includes('$')) {
          report.guardBlockedPriceEveryTime = false;
          fail(`call ${idx}: price reached the caller`);
        } else {
          report.guardBlocks++;
        }
      }
      if (t === turns.length - 1) {
        if (msg.finish_reason !== 'tool_calls') {
          report.endCallOnEveryGoodbye = false;
          fail(`call ${idx}: goodbye did not end the call`);
        }
      }
    }

    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget hold land
    report.calls++;
    // Finalization is measured by the UNBOUNDED hold capture, not the record
    // store — the store caps at 200 by design (newest kept), and measuring by
    // its growth false-alarmed from call 201 on. The newest record must be
    // THIS call's; holds delta of exactly 1 proves finalize ran once.
    const newHoldCount = holds.length - holdsBefore;
    const newest = records.list()[0];
    if (newHoldCount === 1 && newest?.callerId === p.phone) report.finalizedOnce++;
    else if (newHoldCount > 1) {
      report.doubleFinalized++;
      fail(`call ${idx}: finalized ${newHoldCount} times`);
    } else fail(`call ${idx}: never finalized (holds ${newHoldCount}, newest ${newest ? 'stale' : 'none'})`);

    const newHolds = holds.slice(holdsBefore);
    report.holdsAttempted += newHolds.length;
    for (const h of newHolds) {
      const digits = p.phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      const mikesWay = h.summary.endsWith(`- ${digits}`) && h.description.startsWith('Estimate - ') && h.description.includes('UNCONFIRMED');
      if (mikesWay) report.holdsFiledMikesWay++;
      else fail(`call ${idx}: hold not filed Mike's way (${h.summary.slice(0, 20)}...)`);
      if (h.description.includes('Caller asked for:')) report.holdsWithParsedWindow++;
    }

    if (expectRepeatNote) {
      report.repeatCallsRun++;
      if (brain.systems[0]?.includes('REPEAT CALLER')) report.repeatNoteFired++;
      else fail(`call ${idx}: repeat caller got no note`);
    }
  }

  for (let i = 0; i < personas.length; i++) {
    const p = personas[i]!;
    await oneCall(p, i, `sim-${i}-a`, false);
    if (i % repeatEvery === 0) {
      await oneCall(p, i, `sim-${i}-b`, true);
    }
  }

  return report;
}
