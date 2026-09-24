/*
  SLOW::ARBO — this file tests the data-link switch. The note at the top of
  test/dataLinks.test.ts applies here in full.
*/
// R19 (Mike, 2026-09-24): "contecting the links for the data it needs one by
// one after a multiple step verification process." The per-link layer must
// fail closed exactly like the master: a link opens only on the exact string
// 'live' in ITS OWN variable AND the master's, and the refusal names the
// link so nobody hunts a vague 500.
import { describe, it, expect, afterAll, vi } from 'vitest';

const REAL_LOOKING_URL = 'https://wdpyysgxmwvvoyveihum.supabase.co';
const REAL_LOOKING_KEY = 'sb_secret_TESTONLYTESTONLYTESTONLY';
const saved = { ...process.env };

async function load(masterValue: string | undefined, linkVars: Record<string, string> = {}) {
  vi.resetModules();
  process.env = { ...saved };
  process.env.SUPABASE_URL = REAL_LOOKING_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = REAL_LOOKING_KEY;
  for (const k of Object.keys(process.env)) if (k.startsWith('ARBO_LINK_')) delete process.env[k];
  if (masterValue === undefined) delete process.env.ARBO_DATA_LINKS;
  else process.env.ARBO_DATA_LINKS = masterValue;
  Object.assign(process.env, linkVars);
  const client = await import('../src/db/client.js');
  const links = await import('../src/db/links.js');
  return { client, links };
}

afterAll(() => {
  process.env = { ...saved };
  vi.resetModules();
});

describe('per-link switches (R19)', () => {
  it('master live + link unset = that link is CUT, refused BY NAME at the from() door', async () => {
    const { client } = await load('live');
    const db = client.getDb();
    expect(() => db.from('lead')).toThrow(/link 'leads' is CUT/);
    expect(() => db.from('lead')).toThrow(/ARBO_LINK_LEADS/);
    // The table is named as untouched, mirroring the master's "Nothing was deleted".
    expect(() => db.from('lead')).toThrow(/was not touched/);
  });

  it.each(['', 'off', 'true', 'LIVE', ' live'])(
    'a link variable of %o keeps its link CUT — only the exact string "live" opens it',
    async (value) => {
      const { links } = await load('live', { ARBO_LINK_LEADS: value });
      expect(links.linkOpen('leads')).toBe(false);
    },
  );

  it('link live + master cut = STILL CUT — the master always rules', async () => {
    const { links } = await load('off', { ARBO_LINK_LEADS: 'live' });
    expect(links.linkOpen('leads')).toBe(false);
    expect(links.openLinks()).toEqual([]);
  });

  it('master live + link live = the door opens for THAT link only', async () => {
    const { client, links } = await load('live', { ARBO_LINK_LEADS: 'live' });
    expect(links.openLinks()).toEqual(['leads']);
    const db = client.getDb();
    // The open link builds a query (no network until awaited)…
    expect(db.from('lead')).toBeTruthy();
    // …while its neighbours stay shut.
    expect(() => db.from('job')).toThrow(/link 'jobs' is CUT/);
    expect(() => db.from('contact')).toThrow(/link 'contacts' is CUT/);
  });

  it('a table no link covers is refused — unmapped fails closed, not open', async () => {
    const { client } = await load('live', { ARBO_LINK_LEADS: 'live' });
    expect(() => client.getDb().from('some_future_table')).toThrow(/belongs to no data link/);
  });

  it('every table the code touches is covered by exactly one link', async () => {
    const { links } = await load(undefined);
    const all = Object.values(links.DATA_LINKS).flat();
    expect(new Set(all).size).toBe(all.length); // no table in two links
    // The tables repositories.ts and friends actually query:
    for (const t of ['property', 'contact', 'contact_property', 'lead', 'estimate', 'job', 'contract',
      'photo', 'permit', 'permit_correspondence', 'location_ping', 'conversation_log', 'event',
      'event_cursor', 'agent_run', 'ops_setting', 'crew_member', 'invoice', 'change_order',
      'equipment_unit', 'equipment_part', 'maintenance_task', 'near_miss', 'site_condition_record',
      'leakage_event', 'time_entry', 'certification', 'training_item', 'training_event', 'tree',
      'campaign', 'reference_entry']) {
      expect(links.linkForTable(t), t).not.toBeNull();
    }
  });

  it('LinkCutError carries the link and table for the 503 the server sends', async () => {
    const { links } = await load(undefined);
    const err = new links.LinkCutError('lead', 'leads');
    expect(err.link).toBe('leads');
    expect(err.table).toBe('lead');
    expect(err.name).toBe('LinkCutError');
  });
});
