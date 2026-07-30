import { defineConfig } from 'vitest/config';

// The monorepo ran vitest with DEFAULT config (no vitest.config anywhere).
// Vendored inside the fork, config resolution walks up past synactic/ and
// finds the fork's vitest.config.mts (convex/server include patterns) —
// so every package suddenly "has no tests". This file stops the walk at
// the synactic/ boundary and restores vitest's default include, scoped to
// the invoking package's cwd (tests live in src/ and test/ per package).
export default defineConfig({
  test: {
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
