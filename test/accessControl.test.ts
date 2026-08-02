import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// §8C.1 hard-ceiling regression guard. The live proof (crew sees 0 leads /
// 0 jobs while admin sees 37 / 11) was run by impersonation against the real
// database on 2026-08-02 and is recorded in the migration header. THIS test
// keeps the ceiling from being loosened later: it fails the build if anyone
// grants the crew role a policy on a table Mike's half owns.

const sql = readFileSync(
  new URL('../supabase/migrations/0010_access_control_roles_and_rls.sql', import.meta.url),
  'utf8',
);

/** Tables the crew must NEVER have a policy on (§8C.1). */
const ADMIN_ONLY_TABLES = [
  'lead', 'contact', 'property', 'estimate', 'job', 'invoice', 'permit',
  'behavior_profile', 'campaign', 'keyword_phrase', 'area_performance',
  'neighborhood_area', 'leakage_event', 'agent_run', 'event', 'app_user',
  'equipment_unit', 'conversation_log', 'photo', 'contract',
];

/** Every `create policy <name> on <table>` in the migration. */
function policies(): Array<{ name: string; table: string }> {
  const out: Array<{ name: string; table: string }> = [];
  const re = /create\s+policy\s+(\w+)\s+on\s+(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push({ name: m[1]!, table: m[2]! });
  return out;
}

describe('§8C access control — the hard ceiling is structural', () => {
  it('grants admin uniform access via a single generated policy', () => {
    expect(sql).toMatch(/create policy admin_all on %I for all to authenticated/);
    expect(sql).toMatch(/using \(arbo_is_admin\(\)\)/);
  });

  it('gives the crew role NO policy on any admin-only table', () => {
    const crewPolicies = policies().filter((p) => p.name.startsWith('crew_'));
    const violations = crewPolicies.filter((p) => ADMIN_ONLY_TABLES.includes(p.table));
    expect(violations, `crew policy on admin-only table(s): ${violations.map((v) => `${v.name}→${v.table}`).join(', ')}`)
      .toEqual([]);
  });

  it('scopes every self-service crew policy to the caller, never a blanket true', () => {
    for (const name of ['crew_self_read', 'crew_self_certs', 'crew_self_training_read', 'crew_self_time']) {
      const block = sql.slice(sql.indexOf(`create policy ${name}`));
      const clause = block.slice(0, block.indexOf(';'));
      expect(clause, `${name} must scope to the current crew member`).toMatch(/arbo_current_crew_member\(\)/);
      expect(clause).not.toMatch(/using \(true\)/);
    }
  });

  it('crew training content is gated on published — drafts are invisible (§4.7)', () => {
    const block = sql.slice(sql.indexOf('create policy crew_published_training'));
    expect(block.slice(0, block.indexOf(';'))).toMatch(/using \(published\)/);
  });

  it('the photo-proof law survives under RLS: no crew update can close a task without one', () => {
    const block = sql.slice(sql.indexOf('create policy crew_maint_close'));
    expect(block.slice(0, block.indexOf(';'))).toMatch(/status <> 'done' or proof_photo_file is not null/);
  });

  it('identity helpers are SECURITY DEFINER with a pinned search_path', () => {
    for (const fn of ['arbo_current_role', 'arbo_is_admin', 'arbo_current_crew_member']) {
      const block = sql.slice(sql.indexOf(`function ${fn}()`));
      expect(block.slice(0, 300)).toMatch(/security definer set search_path = public/);
    }
  });
});
