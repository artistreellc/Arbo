// R27 (D110) — the customer fence, proven by OUTPUT. The Spanish version is for
// Art-is-Tree's own Spanish-speaking employees (R27 #3): what callers hear and
// what customers read stay exactly as they were. Every fingerprint below was
// taken at main 2265c8d, before the Spanish foundation existed; each output is
// rebuilt here from the running code and must still match it byte for byte.
// None of these can see the phone's language — a server never reads arboLang —
// so a change here is a change somebody made to customer-facing text, and it
// gets its own review, never a Spanish PR's.
//
// Pinned at base on purpose: these pass before the foundation's changes too.
// They are the proof the foundation did not move them, and they keep every
// later Spanish unit (Phase A, Phase B) honest the same way.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import { buildReceptionistSystemPrompt } from '../src/reception/systemPrompt.js';
import { guardReply } from '../src/reception/outputGuard.js';
import { TALK_SYSTEM } from '../src/voice/ownerTalk.js';
import { VOICE_FALLBACK_LINE } from '../src/voice/anthropicLlm.js';
import { createBrain } from '../src/agents/brain.js';
import { loadTalkHtml } from '../src/server/appPage.js';
import { isStopText } from '../src/ops/outreach.js';
import { buildEventTitle, buildEventDescription } from '../src/scheduling/eventFormat.js';
import { buildEstimateHold } from '../src/reception/estimateHold.js';
import { buildPortalView, type PortalProperty, type PortalTree } from '../src/portal/customerView.js';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const g = loadGuardrails();

/** Fingerprints at main 2265c8d (2026-10-22), before any Spanish code. */
const BASE = {
  receptionistPrompt: '0f76384a9518202ad27b9f575c916ade35cb7d42b3395bbbd41180c0951257ae',
  guardReplies: '479373e29713bb82df61e53300fb568d2b082ffbae2be76743288abba81aacb7',
  talkSystem: 'ca8391539b6e8d9b67bce32e8149e391961f2ec6808f2b78824e832f86580ae0',
  voiceFallback: '2b98dd7325e02f485f134ad7cb7f5ca3656ba384ef900824c885389c3168d9b2',
  brainSystem: 'd93776af9743ff88a6fd4441d5497574205427f35bf220d12cc8012198517463',
  talkHtml: '8442be87f5e29efe4df0889fe52f50ced6c2855bd9533f80ccfe1ad2911f0d10',
  eventTitles: 'ded07a57aea7f3dc3d834d1dc7940bd8d7915769ffbce42a52b6e6fef0b8fee0',
  estimateHold: 'cb8cfdf92a18844e9a30120fe7b0c3f19fbd6c14a174b93be4c8dcb4291be039',
  portalView: '4ece2642fc9b23d0ab477688db0ca823971ed41d8acc22474376582e853e3aa3',
  quoExtractPrompt: 'd4675018f6a3ec0392571db9e92b434f8d73efee1f71e5f50d2be236fe8b8318',
  quoStudyPrompt: 'fa751d9862436597df3036ad282ea5013d72a054f7dff2ab90d0ae9bcbc23027',
  pages: {
    '/': '200 3c3d534ca33dbe0575c80dc18be65bc386c6cb3c065d09a0e41b17f6f1da583a',
    '/privacy': '200 acc7e6d33edc2c5200beb72c60fbaa741f4f9ba802307514b9171824d167f262',
    '/terms': '200 131a54ac4886c560222df7b3f73541011e5c7bd0087e01d1b092cd8f8b98f8a8',
    // The phone line is cut (R21/R36), so /talk answers its own "Phone line is off" page.
    '/talk': '503 a6e2cf2294e3b422afc4a5561a2609dab8522276008239f7ef9b076a1482e01c',
  } as Record<string, string>,
};

describe('R27 customer fence — the receptionist, voice and model prompts are byte-identical', () => {
  it('the receptionist’s system prompt (Mike’s own prompt, R13) is unchanged', () => {
    expect(sha(buildReceptionistSystemPrompt(g, loadLegal()))).toBe(BASE.receptionistPrompt);
  });

  it('the receptionist’s guard says exactly what it said before, line for line', () => {
    const candidates = [
      'It will cost about $450 to take that down.',
      'That oak is dead and has to come down.',
      "We'll knock a hundred off if you book today.",
      "We'll be there Tuesday at 9am.",
      'We are TCIA accredited.',
      'Sounds good — Mike will call you back.',
    ];
    expect(sha(JSON.stringify(candidates.map((c) => guardReply(c, g))))).toBe(BASE.guardReplies);
  });

  it('voice’s fallback line and Talk’s system prompt are unchanged', () => {
    expect(sha(VOICE_FALLBACK_LINE)).toBe(BASE.voiceFallback);
    expect(sha(TALK_SYSTEM)).toBe(BASE.talkSystem);
  });

  it('the brain hands the model the same system prompt', async () => {
    let system = '';
    await createBrain({ complete: async (s: string) => { system = s; return 'Two desks read.'; } }, () => g).summarize({
      agentId: 'crew', name: 'Crew Chief', section: 'crew', ranAt: '2026-10-22T10:00:00Z', status: 'ok', inputs: [], findings: [], proposals: [], wrapped: [],
    } as never);
    expect(sha(system)).toBe(BASE.brainSystem);
  });

  it('the Sona-call and customer-study prompts (written as constants) are unchanged', () => {
    const literal = (file: string) => {
      const sf = ts.createSourceFile(file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
      let text = '';
      sf.forEachChild((n) => {
        if (!ts.isVariableStatement(n)) return;
        for (const d of n.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === 'SYSTEM' && d.initializer && ts.isNoSubstitutionTemplateLiteral(d.initializer)) text = d.initializer.text;
        }
      });
      return text;
    };
    expect(sha(literal('ops/quoExtract.ts'))).toBe(BASE.quoExtractPrompt);
    expect(sha(literal('ops/quoStudy.ts'))).toBe(BASE.quoStudyPrompt);
  });
});

describe('R27 customer fence — customer texts, STOP, calendar titles and the portal are byte-identical', () => {
  it('STOP handling reads exactly what it read before — and Spanish opt-out words are NOT STOP (flagged out of scope, R27 plan)', () => {
    const said = ['STOP', 'stop please', 'Please stop texting me', 'unsubscribe', 'ok stop.', 'ALTO', 'BASTA', 'BAJA', 'no gracias', 'Yes still interested'];
    expect(said.map((t) => [t, isStopText(t)])).toEqual([
      ['STOP', true], ['stop please', true], ['Please stop texting me', true], ['unsubscribe', true], ['ok stop.', true],
      ['ALTO', false], ['BASTA', false], ['BAJA', false], ['no gracias', false], ['Yes still interested', false],
    ]);
  });

  it('the R22 customer text and its STOP line live in guardrails.json, which no Spanish file touches', () => {
    const raw = readFileSync(new URL('../src/policy/guardrails.json', import.meta.url), 'utf8');
    expect(raw).not.toMatch(/[áéíóúñ¿¡]/i);
  });

  it('calendar titles and the estimate hold read exactly as before', () => {
    expect(sha(JSON.stringify([
      buildEventTitle({ name: 'SIM Caller', source: 'GG', phone: '(757) 555-0101' }),
      buildEventTitle({ name: '', source: 'lsa', phone: '7575550102' }),
      buildEventDescription({ serviceType: 'removal', treeInfo: 'two oaks', proximity: 'over the house', access: 'gate on the left', urgency: 'storm', bestContact: 'text', notes: 'SIM' }),
    ]))).toBe(BASE.eventTitles);
    expect(sha(JSON.stringify(buildEstimateHold({
      state: { name: 'SIM Caller', address: '101 Simulation Row', city: 'Virginia Beach', jobType: 'removal', treeInfo: 'pine', proximityPowerLines: 'no' } as never,
      callerId: '+17575550101', zip: '23451', window: null, nowMs: Date.parse('2026-10-22T14:00:00Z'), bookedBy: 'Sona',
    })))).toBe(BASE.estimateHold);
  });

  it('the customer portal draws the same view (its flags guard now also holds the Spanish ban list — output unchanged)', () => {
    const prop: PortalProperty = {
      id: 'p1', address: '101 Simulation Row', city: 'Virginia Beach', zip: '23451', geoLat: 36.85, geoLng: -75.98,
      hazardPowerLines: true, powerLinesCheckedAt: '2026-09-01T12:00:00Z', waterMeterLocation: null, waterMeterPathNote: null, siteFeaturesNote: null,
    };
    const tree = (over: Partial<PortalTree> = {}): PortalTree => ({
      id: 't1', species: 'Live oak', size: 'large', locationOnLot: 'front left', conditionNotes: 'Good structure, minor deadwood.',
      lastServiceDate: '2025-03-01', nextDueForecast: '2027-03-01', ...over,
    });
    const view = buildPortalView({ property: prop, trees: [tree(), tree({ id: 't2', conditionNotes: null, species: null })], job: null, linkFor: () => null, screen: null });
    expect(sha(JSON.stringify(view))).toBe(BASE.portalView);
  });
});

describe('R27 customer fence — the public pages and talk.html are byte-identical and carry no Spanish runtime', () => {
  it('talk.html is served as the file itself — no dictionary, no runtime, no language switch', () => {
    const talk = loadTalkHtml();
    expect(talk).toBe(readFileSync(new URL('../src/app/talk.html', import.meta.url), 'utf8'));
    expect(sha(talk)).toBe(BASE.talkHtml);
    expect(talk).not.toContain('arbo-i18n');
    expect(talk).not.toContain('ARBO:I18N');
  });

  it('/, /privacy, /terms and /talk answer exactly what they answered before', async () => {
    const saved = process.env.ARBO_DATA_LINKS;
    delete process.env.ARBO_DATA_LINKS;
    try {
      const { createArborRequestHandler } = await import('../src/server.js');
      const srv = createServer(createArborRequestHandler());
      await new Promise<void>((r) => srv.listen(0, r));
      const port = (srv.address() as { port: number }).port;
      try {
        for (const [path, want] of Object.entries(BASE.pages)) {
          const r = await fetch(`http://127.0.0.1:${port}${path}`);
          const body = await r.text();
          expect(`${r.status} ${sha(body)}`, path).toBe(want);
          expect(body, path).not.toContain('arbo-i18n');
        }
      } finally {
        srv.close();
      }
    } finally {
      if (saved === undefined) delete process.env.ARBO_DATA_LINKS; else process.env.ARBO_DATA_LINKS = saved;
    }
  });
});
