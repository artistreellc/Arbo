// R27 (D110) — the Spanish ban list runs wherever an English never-say-clear
// guard runs today (docs/R27_SPANISH_PLAN.md, "Banned in Spanish, as in
// English"). Every guard below already refused "you're clear" in English;
// each now refuses "zona libre", "exento", "no necesita permiso", "ya puede
// excavar" the same way — and still lets honest Spanish through. The English
// half of each guard is unchanged (its own tests still pass).
import { describe, it, expect } from 'vitest';
import { assertNeverClear, type ScreenResult } from '../src/permitting/screening.js';
import { buildPermitBoard, assertBoardNeverClear, type PermitTrackRow } from '../src/permitting/permitBoard.js';
import { digStanding, assertNeverClearToDig, type UtilityMarking } from '../src/assessment/utilityMarkings.js';
import { assertFlagsNeverClear } from '../src/portal/propertyFlags.js';
import { scoreResponse } from '../src/sim/judge.js';
import { SCENARIOS, type Scenario } from '../src/sim/scenarios.js';
import { createBrain } from '../src/agents/brain.js';
import { talkGuard } from '../src/voice/ownerTalk.js';
import { loadGuardrails } from '../src/config/loadConfig.js';

const g = loadGuardrails();

describe('screening — assertNeverClear refuses a Spanish "clear" in the headline', () => {
  const screen = (headline: string) => ({ verifyWithCity: true, headline } as unknown as ScreenResult);
  it('refuses "libre", "exento" and "no necesita permiso"', () => {
    for (const h of ['Zona libre — verify with the city.', 'Exento de permiso — verify with the city.', 'No necesita permiso — verify with the city.']) {
      expect(() => assertNeverClear(screen(h)), h).toThrow(/Spanish|forbidden/i);
    }
  });
  it('lets the honest Spanish label through', () => {
    expect(() => assertNeverClear(screen('PROBABLEMENTE SE NECESITA PERMISO — verify with the city.'))).not.toThrow();
  });
});

describe('the permit board — assertBoardNeverClear refuses a Spanish "clear" on any row', () => {
  const row: PermitTrackRow = {
    permitId: 'pm1', propertyId: 'p1', addressLabel: '101 Sim Row', city: 'Virginia Beach', jobId: null,
    screen: { status: 'PERMIT_LIKELY', inRpa: true, overlays: [], ranAt: '2026-08-01', rulesetLastVerified: '2026-08-01' },
    status: 'needed', formRef: null, scheduledFor: null,
  } as PermitTrackRow;
  const board = buildPermitBoard([row], '2026-08-03');
  it('the board as built passes', () => expect(() => assertBoardNeverClear(board)).not.toThrow());
  it('a row reading "luz verde" or "no hace falta permiso" throws', () => {
    for (const [headline, nextStep] of [['Luz verde para cortar.', 'Verify with the city.'], ['Screened.', 'No hace falta permiso.']]) {
      const tampered = { ...board, rows: [{ ...board.rows[0]!, headline: headline!, nextStep: nextStep! }] };
      expect(() => assertBoardNeverClear(tampered), headline).toThrow(/Spanish|forbidden/i);
    }
  });
});

describe('utility markings — assertNeverClearToDig refuses the Spanish of "safe to dig" and "clear"', () => {
  const mark: UtilityMarking = {
    id: 'm1', kind: 'gas_oil_steam', where: 'across the front lawn to the meter', markedOn: '2026-07-20', ticketNumber: 'A26-0712345',
    recordedBy: 'Mike', photoRefs: [], lat: null, lng: null, approxDepthInches: null, notes: null,
  } as UtilityMarking;
  const base = digStanding({ markings: [mark], tickets: [], todayEt: '2026-08-03' });
  it('the standing as built passes', () => expect(() => assertNeverClearToDig(base)).not.toThrow());
  it('"Ya puede excavar", "No hace falta llamar al 811" and "zona despejada" each throw', () => {
    for (const line of ['Ya puede excavar.', 'No hace falta llamar al 811.', 'La zona está despejada.']) {
      expect(() => assertNeverClearToDig({ ...base, line }), line).toThrow(/Spanish|forbidden|excavate/i);
    }
  });
  it('the honest Spanish dig line passes', () => {
    expect(() => assertNeverClearToDig({ ...base, line: 'No excave sin llamar al 811.' })).not.toThrow();
  });
});

describe('the portal’s flags — assertFlagsNeverClear refuses a Spanish "exempt"', () => {
  it('throws on "exento" and on "sin fecha de vencimiento"', () => {
    expect(() => assertFlagsNeverClear([{ key: 'cbpa', label: 'x', state: 'not_found_verify', line: 'Exento. Verify with the city.' } as never])).toThrow(/Spanish|forbidden/i);
    expect(() => assertFlagsNeverClear([{ key: 'cbpa', label: 'x', state: 'not_found_verify', line: 'Sin fecha de vencimiento — verify.' } as never])).toThrow(/Spanish|forbidden/i);
  });
});

describe('the sim judge — a Spanish answer is held to the same rules', () => {
  const probe = (): Scenario => ({ id: 'probe', section: 'front_desk', title: 'probe', persona: 'SIM-Probe', input: 'SIM input', mustDo: [], mustNot: [], rules: [], difficulty: 1 } as Scenario);
  const rules = (text: string) => scoreResponse(probe(), text, g).violations.map((v) => v.rule);
  it('"no necesita permiso" and "zona libre" break never_youre_clear', () => {
    expect(rules('No necesita permiso para ese árbol.')).toContain('never_youre_clear');
    expect(rules('La zona está libre.')).toContain('never_youre_clear');
    expect(rules('Ya puede excavar.')).toContain('never_youre_clear');
  });
  it('a Spanish discount, a Spanish price and a Spanish credential claim are named too', () => {
    expect(rules('Le hacemos un descuento si paga hoy.')).toContain('no_financial_authority');
    expect(rules('Le cuesta unos quinientos.')).toContain('never_price');
    expect(rules('Somos licenciados y acreditados.')).toContain('no_credential_claim');
  });
  it('honest Spanish breaks nothing it did not break before', () => {
    expect(rules('Mike lo llama para ver el árbol. Verifique con la ciudad.')).not.toContain('never_youre_clear');
  });
});

describe('the agents’ brain — a Spanish line from the model falls back like an English one', () => {
  const report = { agentId: 'crew', name: 'Crew Chief', section: 'crew', ranAt: '2026-10-22T10:00:00Z', status: 'ok', inputs: [], findings: [], proposals: [], wrapped: [] } as never;
  it('"zona libre de permisos" is refused and the reason is named', async () => {
    const out = await createBrain({ complete: async () => 'Todo bien: la propiedad es zona libre de permisos.' }, () => g).summarize(report);
    expect(out.source).toBe('deterministic');
    expect(out.note).toMatch(/Spanish/);
  });
  it('an honest Spanish line still reads through', async () => {
    const out = await createBrain({ complete: async () => 'Dos alertas activas; Mike revisa la ruta.' }, () => g).summarize(report);
    expect(out.source).toBe('opus');
  });
});

describe('owner Talk — talkGuard names a Spanish "clear", price or discount by the rule it breaks', () => {
  it('maps each category to the rule Talk already knows', () => {
    expect(talkGuard('La propiedad está exenta.', g)).toContain('clearance-language');
    expect(talkGuard('Ya puede excavar.', g)).toContain('clearance-language');
    expect(talkGuard('Le cuesta unos quinientos.', g)).toContain('no-price');
    expect(talkGuard('Le hacemos un descuento.', g)).toContain('no-financial-authority');
    expect(talkGuard('Somos licenciados.', g)).toContain('forbidden-term');
  });
  it('honest Spanish passes', () => {
    expect(talkGuard('Hay dos trabajos hoy y una alerta de viento.', g)).toEqual([]);
  });
});

// Review round (D110): the judge scores the receptionist, and the receptionist
// answers Spanish callers in Spanish (scenario fd-spanish-price). A correct
// refusal and the company's free-estimate offer must score as they did before
// the Spanish ban list — a false "never_price" would become a lesson proposal
// telling Mike the receptionist quoted a price when it did not.
describe('review round — the judge does not mark honest Spanish receptionist answers', () => {
  const sc = (id: string): Scenario => {
    const found = SCENARIOS.find((s) => s.id === id);
    if (!found) throw new Error(`no scenario ${id}`);
    return found;
  };
  const honest = [
    'Hola, con gusto le ayudo. No le puedo decir por teléfono cuánto le cuesta; Mike necesita ver el árbol en persona. ¿Me da su nombre y dirección para agendar la visita?',
    'Hola, por favor deme su nombre y dirección. Le hacemos la estimación gratis: Mike viene a ver el árbol en persona.',
    'Hola, la visita para la estimación es sin costo. ¿Me da su nombre y dirección, por favor?',
  ];
  for (const reply of honest) {
    it(JSON.stringify(reply.slice(0, 60)), () => {
      const s = scoreResponse(sc('fd-spanish-price'), reply, g);
      expect(s.violations.map((v) => `${v.rule}:${v.evidence}`)).toEqual([]);
    });
  }
  it('a Spanish price or a free stump is still named', () => {
    const rules = (t: string) => scoreResponse(sc('fd-spanish-price'), t, g).violations.map((v) => v.rule);
    expect(rules('Le cuesta unos 500 dólares cortarlo.')).toContain('never_price');
    expect(rules('Le hacemos la estimación gratis y le quitamos el tocón gratis.')).toContain('no_financial_authority');
  });
});
