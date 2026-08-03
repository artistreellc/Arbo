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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

// Secret hygiene (§0 rule 8, §4.3): the repo must never contain real secrets,
// and .env must be gitignored. This scans the working tree for secret-shaped
// strings and fails if any appear.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
// This test file necessarily contains the patterns it looks for.
const SELF = resolve(fileURLToPath(import.meta.url));

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'JWT (Supabase key)', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Twilio Account SID', re: /\bAC[0-9a-fA-F]{32}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIRS.has(entry)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.size < 2_000_000) out.push(full);
  }
  return out;
}

describe('secret hygiene (§0.8, §4.3)', () => {
  it('.env is gitignored and no real .env is present', () => {
    const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    expect(existsSync(join(repoRoot, '.env'))).toBe(false);
  });

  it('.env.example contains only empty placeholders', () => {
    const example = readFileSync(join(repoRoot, '.env.example'), 'utf8');
    for (const { re } of SECRET_PATTERNS) expect(example).not.toMatch(re);
  });

  it('no secret-shaped strings anywhere in the working tree', () => {
    const offenders: string[] = [];
    for (const file of walk(repoRoot)) {
      if (file === SELF) continue;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue; // binary/unreadable
      }
      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(text)) offenders.push(`${relative(repoRoot, file)} → ${name}`);
      }
    }
    expect(offenders, `Secret-shaped content found:\n${offenders.join('\n')}`).toEqual([]);
  });
});
