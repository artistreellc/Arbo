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
