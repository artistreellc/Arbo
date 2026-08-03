/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// §8C.1 hard-ceiling regression guard. The live proof (crew sees 0 leads /
// 0 jobs while admin sees 37 / 11) was run by impersonation against the real
// database on 2026-08-02 and is recorded in the migration header. THIS test
// keeps the ceiling from being loosened later: it fails the build if anyone
// grants the crew role a policy on a table Mike's half owns.

// EVERY migration, not just the one that introduced the policies — a later
// migration granting the crew a policy on an admin table must fail the build.
const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8'))
  .join('\n');

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

  it('gives NO non-admin policy on any admin-only table, in ANY migration', () => {
    // Name-agnostic: `admin_all` is the only policy allowed on these tables.
    const crewPolicies = policies().filter((p) => p.name !== 'admin_all');
    const violations = crewPolicies.filter((p) => ADMIN_ONLY_TABLES.includes(p.table));
    expect(violations, `crew policy on admin-only table(s): ${violations.map((v) => `${v.name}→${v.table}`).join(', ')}`)
      .toEqual([]);
  });

  it('no crew policy is a blanket `using (true)` — every one needs an identity', () => {
    // A deactivated crew member's JWT stays valid; `using (true)` would keep
    // letting them read. Every crew policy must resolve an ACTIVE identity.
    for (const p of policies().filter((p) => p.name.startsWith('crew_'))) {
      // lastIndexOf: a later migration REPLACES an earlier policy definition.
      const block = sql.slice(sql.lastIndexOf(`create policy ${p.name} on ${p.table}`));
      const clause = block.slice(0, block.indexOf(';'));
      expect(clause, `${p.name} must not be an unscoped using(true)`).toMatch(
        /arbo_current_crew_member\(\)|arbo_is_active_crew\(\)|published/,
      );
    }
  });

  it('scopes every self-service crew policy to the caller, never a blanket true', () => {
    for (const name of ['crew_self_read', 'crew_self_certs', 'crew_self_training_read', 'crew_self_time']) {
      const block = sql.slice(sql.lastIndexOf(`create policy ${name}`));
      const clause = block.slice(0, block.indexOf(';'));
      expect(clause, `${name} must scope to the current crew member`).toMatch(/arbo_current_crew_member\(\)/);
      expect(clause).not.toMatch(/using \(true\)/);
    }
  });

  it('crew training content is gated on published — drafts are invisible (§4.7)', () => {
    const block = sql.slice(sql.lastIndexOf('create policy crew_published_training'));
    expect(block.slice(0, block.indexOf(';'))).toMatch(/using \(published\)/);
  });

  it('the photo-proof law survives under RLS: no crew update can close a task without one', () => {
    const block = sql.slice(sql.lastIndexOf('create policy crew_maint_close'));
    expect(block.slice(0, block.indexOf(';'))).toMatch(/status <> 'done' or proof_photo_file is not null/);
  });

  it('identity helpers are SECURITY DEFINER with a pinned search_path', () => {
    for (const fn of ['arbo_current_role', 'arbo_is_admin', 'arbo_current_crew_member']) {
      const block = sql.slice(sql.indexOf(`function ${fn}()`));
      expect(block.slice(0, 300)).toMatch(/security definer set search_path = public/);
    }
  });
});
