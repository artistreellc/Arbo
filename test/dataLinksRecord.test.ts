// M7 (audit 2026-10-20): the R19 link-verification record said the permits
// link was "clean, 0 rows" while `permit_correspondence` held 22 rows of
// permit mail mined from Gmail (D38), and called contacts and properties
// "clean" though most were written in the August ingestion batches. Step 3
// of the verification is the safeguard §3 asked for; a hand-typed count
// defeated it. The record is corrected (nothing deleted) and step 3 now
// takes a pasted read-only provenance query, never a typed number.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const doc = readFileSync(new URL('../docs/DATA_LINKS.md', import.meta.url), 'utf8');
const row = (link: string) => doc.split('\n').find((l) => l.startsWith(`| ${link} |`)) ?? '';

describe('M7 — the data-link record tells the truth about what is in the tables', () => {
  it('permits is HELD with its 22 rows and their origin (D38), never "0, clean"', () => {
    expect(row('permits')).not.toMatch(/permit_correspondence \(0\)/);
    expect(row('permits')).toContain('permit_correspondence (**22**)');
    expect(row('permits')).toContain('HELD');
    expect(row('permits')).toContain('D38');
    expect(doc).not.toContain('(0 at the 2026-09-24 check)');
  });

  it('contacts and properties are FLAGGED for one ruling with the 11 jobs, not "clean"', () => {
    for (const link of ['contacts', 'properties']) {
      expect(row(link), link).toContain('FLAGGED');
      expect(row(link), link).not.toMatch(/\| clean \|$/);
    }
    expect(doc).toContain('contacts, properties and the 11 jobs — one ruling for the set');
  });

  it('step 3 takes a pasted read-only provenance query — counts, batches, links into held tables, the time it ran', () => {
    expect(doc).toContain('**Paste, never type**');
    expect(doc).toContain('select now() as ran_at');
    expect(doc).toContain("date_trunc('minute', created_at) as batch");
    expect(doc).toContain('Writes nothing.');
    // Read-only: the query block carries no write verb.
    const sql = doc.slice(doc.indexOf('```sql'), doc.indexOf('```', doc.indexOf('```sql') + 6));
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
  });

  it('nothing was deleted — the correction says so', () => {
    expect(row('permits')).toContain('Nothing deleted.');
  });
});
