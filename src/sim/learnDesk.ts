// R25 Learn desk (Mike, 2026-09-28: "train its brain … a complete list of
// problems a human might face via a simulated learning environment").
//
// Law: NOTHING RETRAINS ITSELF. A run scores the brain against Mike's rules;
// each failure becomes a LESSON PROPOSAL. Mike approves or rejects it. An
// approved lesson is a written instruction for the next prompt revision —
// it does not edit a prompt, a rule, or any code on its own.
//
// Runs are simulations only: SIM- people, 555-01xx numbers, streets that do
// not exist. No customer record is read or written.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SCENARIOS, SECTIONS, RULES } from './scenarios.js';
import { runSimulation, scriptedBrain, opusBrain, lessonsFrom, type SimReport, type LessonProposal } from './harness.js';

export type Decision = 'approved' | 'rejected';
export interface LessonRecord extends Omit<LessonProposal, 'status'> {
  status: 'proposed' | Decision;
  decidedAt?: string;
  fromRun: string;
}

/** Lessons live on the storage disk when there is one; otherwise in memory, and the desk SAYS so. */
export class LessonBook {
  private lessons: LessonRecord[] = [];
  private where: 'disk' | 'memory' = 'memory';
  constructor(private readonly dir: string = process.env.ARBO_SECRET_DIR ?? '/data') {
    try {
      this.lessons = JSON.parse(readFileSync(join(dir, 'sim-lessons.json'), 'utf8')) as LessonRecord[];
      this.where = 'disk';
    } catch { /* no file yet, or no disk — decided on first save */ }
  }
  private save(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = join(this.dir, 'sim-lessons.json.tmp');
      writeFileSync(tmp, JSON.stringify(this.lessons, null, 1));
      renameSync(tmp, join(this.dir, 'sim-lessons.json'));
      this.where = 'disk';
    } catch {
      this.where = 'memory';
    }
  }
  /** A new run's proposals join the book; one already decided is not asked again. */
  propose(proposals: LessonProposal[], runId: string): void {
    for (const p of proposals) {
      const had = this.lessons.find((l) => l.id === p.id);
      if (had && had.status !== 'proposed') continue;
      const rec: LessonRecord = { ...p, status: 'proposed', fromRun: runId };
      if (had) Object.assign(had, rec);
      else this.lessons.push(rec);
    }
    this.save();
  }
  decide(id: string, decision: Decision, now = new Date()): LessonRecord | null {
    const l = this.lessons.find((x) => x.id === id);
    if (!l) return null;
    l.status = decision;
    l.decidedAt = now.toISOString();
    this.save();
    return l;
  }
  list(): { where: 'disk' | 'memory'; lessons: LessonRecord[] } {
    return { where: this.where, lessons: [...this.lessons] };
  }
}

export function catalog() {
  const bySection = Object.fromEntries(SECTIONS.map((s) => [s, SCENARIOS.filter((x) => x.section === s).length]));
  return {
    total: SCENARIOS.length,
    bySection,
    rules: RULES,
    scenarios: SCENARIOS.map((s) => ({ id: s.id, section: s.section, title: s.title, persona: s.persona, difficulty: s.difficulty, rules: s.rules })),
  };
}

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'failed';
  brain: 'scripted' | 'opus' | null;
  startedAt: string | null;
  report: SimReport | null;
  error: string | null;
}

/**
 * One run at a time. The scripted brain runs in-line (no network, a second
 * or two). The Opus brain is Mike's explicit tap — it calls the model once
 * per scenario — and runs in the background; the desk polls its state.
 */
export class LearnDesk {
  state: RunState = { status: 'idle', brain: null, startedAt: null, report: null, error: null };
  constructor(readonly book = new LessonBook(), private readonly apiKey: string | undefined = process.env.ANTHROPIC_API_KEY) {}

  get opusAvailable(): boolean { return Boolean(this.apiKey); }

  async start(brain: 'scripted' | 'opus'): Promise<{ ok: boolean; reason?: string }> {
    if (this.state.status === 'running') return { ok: false, reason: 'a_run_is_already_going' };
    if (brain === 'opus' && !this.apiKey) return { ok: false, reason: 'no_model_key_on_server' };
    const startedAt = new Date().toISOString();
    this.state = { status: 'running', brain, startedAt, report: null, error: null };
    const run = (async () => {
      try {
        const b = brain === 'opus' ? opusBrain(new Anthropic({ apiKey: this.apiKey })) : scriptedBrain();
        const report = await runSimulation(b, SCENARIOS, { concurrency: brain === 'opus' ? 4 : 8, brainName: brain });
        this.book.propose(lessonsFrom(report), startedAt);
        this.state = { status: 'done', brain, startedAt, report, error: null };
      } catch (e) {
        this.state = { status: 'failed', brain, startedAt, report: null, error: e instanceof Error ? e.name : 'error' };
      }
    })();
    if (brain === 'scripted') await run;
    else void run;
    return { ok: true };
  }
}
