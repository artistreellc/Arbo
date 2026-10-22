// R27 (D110) — the Spanish ban list, its normalizer, and the mechanical gates
// every Spanish string passes (docs/R27_SPANISH_PLAN.md: "Banned in Spanish,
// as in English" and "Mechanical gates"). R27 #4: the Spanish never says
// "clear" or "exempt" either — "libre", "exento", "no necesita permiso"…
import { describe, it, expect } from 'vitest';
import { normalizeEs, findBannedEs, hasBannedEs, ES_BANNED } from '../src/i18n/banList.js';
import { esGateProblems } from '../src/i18n/gates.js';

describe('the normalizer — accents folded, lower case, non-breaking and thin spaces collapsed', () => {
  it('folds accents and case', () => {
    expect(normalizeEs('RESCATE AÉREO')).toBe('rescate aereo');
    expect(normalizeEs('Está Calificado')).toBe('esta calificado');
    expect(normalizeEs('Ningún permiso')).toBe('ningun permiso');
  });

  it('collapses NBSP, thin, narrow and other spaces into one plain space', () => {
    expect(normalizeEs('luz\u00A0verde')).toBe('luz verde');
    expect(normalizeEs('luz\u2009verde')).toBe('luz verde');
    expect(normalizeEs('luz\u202F\u2002 verde')).toBe('luz verde');
    expect(normalizeEs('  zona   libre  ')).toBe('zona libre');
  });

  it('drops invisible marks, so a word cannot hide behind a zero-width space or a soft hyphen', () => {
    expect(normalizeEs('li\u200Bbre')).toBe('libre');
    expect(normalizeEs('exen\u00ADto')).toBe('exento');
    expect(normalizeEs('\uFEFFdespejado')).toBe('despejado');
  });
});

describe('the ban list — every word and phrase the plan names is caught, however it is typed', () => {
  const caught: Array<[string, string]> = [
    ['clear', 'La zona está libre.'],
    ['clear', 'VÍA LIBRE'],
    ['clear', 'paso\u00A0libre'],
    ['clear', 'li\u200Bbre'],
    ['clear', 'Este trabajo está exento de permiso.'],
    ['clear', 'EXENTA'],
    ['clear', 'No necesita permiso.'],
    ['clear', 'no se necesita un permiso'],
    ['clear', 'No requiere permiso'],
    ['clear', 'No hace falta permiso.'],
    ['clear', 'No hace falta ningún permiso.'],
    ['clear', 'No es necesario un permiso.'],
    ['clear', 'Permiso no requerido.'],
    ['clear', 'Despejado'],
    ['clear', 'el área quedó despejada'],
    ['clear', 'Tiene luz verde.'],
    ['clear', 'luz\u2009verde'],
    ['clear', 'Listo para cortar.'],
    ['clear', 'listos para cortar'],
    ['clear', 'Sin fecha de vencimiento'],
    ['clear', 'Rescate aéreo'],
    ['clear', 'RESCATE AEREO'],
    ['clear', 'Zona marcada'],
    ['credential', 'Somos licenciados.'],
    ['credential', 'Licenciado'],
    ['credential', 'Acreditado'],
    ['safety_board', 'Está calificado para trepar.'],
    ['safety_board', 'ESTÁ CALIFICADA'],
    ['safety_board', 'Autorizado para trepar'],
    ['price', 'El precio es $400.'],
    ['price', 'Le cuesta unos 500.'],
    ['price', 'Precio aproximado'],
    ['price', 'más o menos $300'],
    ['price', 'Le cobramos $200.'],
    ['money', 'Le hacemos un descuento.'],
    ['money', 'Sin cargo.'],
    ['money', 'No le cobramos el tocón.'],
    ['money', 'Se lo regalamos.'],
    ['money', 'Lo incluimos gratis.'],
    ['money', 'Igualamos el precio.'],
    ['dig', 'Es seguro excavar.'],
    ['dig', 'Listo para excavar.'],
    ['dig', 'Ya puede excavar.'],
    ['dig', 'Se puede excavar.'],
    ['dig', 'No hace falta llamar al 811.'],
    ['dig', 'Ya están localizadas.'],
  ];
  for (const [category, text] of caught) {
    it(`${category}: ${JSON.stringify(text)}`, () => {
      const hits = findBannedEs(text);
      expect(hits.length, text).toBeGreaterThan(0);
      expect(hits.map((h) => h.category)).toContain(category);
      expect(hasBannedEs(text)).toBe(true);
    });
  }

  it('every entry carries its own example, and each example is caught by its own entry', () => {
    expect(ES_BANNED.length).toBeGreaterThan(15);
    for (const b of ES_BANNED) {
      expect(findBannedEs(b.example).map((h) => h.id), b.id).toContain(b.id);
    }
  });
});

describe('the ban list does not bite honest Spanish — the plan’s own labels and the safety lines pass', () => {
  const fine = [
    'PROBABLEMENTE SE NECESITA PERMISO',
    'PERMISO: HAY QUE REVISAR',
    'VERIFIQUE CON LA CIUDAD — EL MAPA NO MOSTRÓ ZONA PROTEGIDA',
    'CHEQUEO DE PERMISO SIN HACER',
    'NO SE MANEJA — FRENOS/DIRECCIÓN',
    'NO PUEDE TRABAJAR EN ALTURA',
    'FALTA LA FECHA DE VENCIMIENTO',
    'No excave sin llamar al 811.',
    'No se puede excavar hasta que llegue el ticket.',
    'Todavía no se puede excavar.',
    'No le dé precio al cliente.',
    'Pare el trabajo y llame a la oficina.',
    'zona de caída (drop zone)',
    'Llame a Dominion.',
    '"licensed and insured" (con licencia y seguro)',
    'Cuesta arriba, cuidado con la astilladora.',
  ];
  for (const text of fine) {
    it(JSON.stringify(text), () => expect(findBannedEs(text)).toEqual([]));
  }
});

describe('the mechanical gates — a translation that changes the meaning is caught', () => {
  it('a good pair passes', () => {
    expect(esGateProblems('Do not start work — call the office.', 'No empiece a trabajar — llame a la oficina.')).toEqual([]);
    expect(esGateProblems('{n} calls today', '{n} llamadas hoy')).toEqual([]);
    expect(esGateProblems('PERMIT LIKELY', 'PROBABLEMENTE SE NECESITA PERMISO')).toEqual([]);
  });

  it('a dropped number fails', () => {
    expect(esGateProblems('Read for 10s more', 'Lea un poco más').join(' ')).toMatch(/10/);
  });

  it('a dropped NO fails', () => {
    expect(esGateProblems('Do not start work.', 'Empiece a trabajar.').join(' ')).toMatch(/negation/);
  });

  it('a hedge stays a hedge: "may apply" never becomes "applies"', () => {
    expect(esGateProblems('A permit may apply.', 'Se aplica un permiso.').join(' ')).toMatch(/hedge/);
    expect(esGateProblems('A permit may apply.', 'Puede aplicar un permiso.')).toEqual([]);
  });

  it('placeholders must match exactly', () => {
    expect(esGateProblems('{n} calls today', '{count} llamadas hoy').join(' ')).toMatch(/placeholder/);
    expect(esGateProblems('{n} calls today', 'llamadas hoy').join(' ')).toMatch(/placeholder/);
  });

  it('STOP, the carrier keyword, is never translated', () => {
    expect(esGateProblems('Reply STOP to opt out.', 'Responda ALTO para salir.').join(' ')).toMatch(/STOP/);
    expect(esGateProblems('Reply STOP to opt out.', 'Responda STOP para no recibir más mensajes.')).toEqual([]);
  });

  it('the register is usted — a tú form fails', () => {
    expect(esGateProblems('You can start.', 'Puedes empezar.').join(' ')).toMatch(/usted/);
    expect(esGateProblems('Check your phone.', 'Revise tu teléfono.').join(' ')).toMatch(/usted/);
  });

  it('the pinned false friends fail: conductor, utilidad, aplicado', () => {
    expect(esGateProblems('Stay 10 ft from the conductor.', 'Manténgase a 10 ft del conductor.').join(' ')).toMatch(/conductor/);
    expect(esGateProblems('Call the utility.', 'Llame a la utilidad.').join(' ')).toMatch(/utility/);
    expect(esGateProblems('APPLIED', 'APLICADO').join(' ')).toMatch(/applied/);
    expect(esGateProblems('APPLIED', 'SOLICITADO')).toEqual([]);
  });

  it('qualifiers survive: "at least" ↔ "al menos", "working days" ↔ "días hábiles"', () => {
    const p = esGateProblems('Allow at least 10 working days.', 'Cuente 10 días.').join(' ');
    expect(p).toMatch(/at least/);
    expect(p).toMatch(/working days/);
    expect(esGateProblems('Allow at least 10 working days.', 'Cuente al menos 10 días hábiles.')).toEqual([]);
  });

  it('a § cite, a phone number and "ft" stay as written', () => {
    expect(esGateProblems('Per Z133 §5.1', 'Según Z133').join(' ')).toMatch(/§5\.1/);
    expect(esGateProblems('Call 1-800-552-7001.', 'Llame a Dominion.').join(' ')).toMatch(/1-800-552-7001/);
    expect(esGateProblems('Stay 10 ft back.', 'Quédese a 10 pies.').join(' ')).toMatch(/ft/);
  });

  it('a banned word fails the gate too, and an empty Spanish line fails', () => {
    expect(esGateProblems('NO OVERLAY — VERIFY W/ CITY', 'ZONA LIBRE — VERIFIQUE').join(' ')).toMatch(/banned/);
    expect(esGateProblems('Language', '  ').join(' ')).toMatch(/empty/);
  });
});
