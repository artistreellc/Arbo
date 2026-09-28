// Tests live in test/. Agent worktrees under .claude/ carry their own copy of
// the repo and must never be collected as a second suite.
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
