// Tests live in test/. Agent worktrees under .claude/ carry their own copy of
// the repo and must never be collected as a second suite.
// R27 (D110): every test file starts with the Spanish runtime's names (T, tf,
// tn, esPick, esPair…) on the global object, in English — the stubs every page
// harness needs (test/support/i18nGlobals.ts).
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '.claude/**'], setupFiles: ['test/support/i18nGlobals.ts'] },
});
