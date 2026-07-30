# Development Workflow

## Branch Strategy

- `main` — stable branch, protected
- `feature/*` — feature branches from `main`
- `fix/*` — bug fix branches from `main`
- `experiment/*` — experimental branches, may be rebased or discarded

## PR Process

1. Create feature branch from `main`
2. Implement changes with tests
3. Open pull request with description referencing relevant ADRs
4. Review and approval required before merge
5. Squash merge to `main`

## Testing Expectations

- All new code must include tests
- Contracts package requires schema validation tests
- Services require integration tests
- 372 tests currently green across `contracts`, `event-envelope`, and `tool-policy`

## Import Conventions (NodeNext)

The repo uses NodeNext module resolution. Relative TypeScript imports **must** use explicit `.js` extensions, even though the source files are `.ts`:

```ts
// Correct
import { SynacticEventSchema } from "./schemas/synactic-event.js";

// Wrong — will fail typecheck/build
import { SynacticEventSchema } from "./schemas/synactic-event";
```

Package-name imports (e.g. `@the-synactic/contracts`) do not take an extension.

## Running Tests

Run the full suite from the repo root:

```
corepack pnpm test
```

Run tests for a single workspace by filtering on its package name:

```
corepack pnpm test --filter @the-synactic/contracts
corepack pnpm test --filter @the-synactic/event-envelope
corepack pnpm test --filter @the-synactic/tool-policy
```

(The service workspaces — `@the-synactic/briefing-service`, `@the-synactic/mcp-gateway`, `@the-synactic/model-router` — are scaffolds running `vitest --passWithNoTests`.)

The same pattern applies to the other root scripts: `build`, `check`, `lint`.

## CI Gates

Every push/PR runs the following gates on both **ubuntu-latest** and **windows-latest**:

1. `corepack pnpm check` — typecheck
2. `corepack pnpm lint` — eslint flat config
3. `corepack pnpm test` — full vitest suite
4. `corepack pnpm build` — turbo build
5. Dependency audit — `pnpm audit --prod`, fails on high-or-greater severity
6. Secret scan — gitleaks over the repository history
7. Network-boundary guard — verifies Phase 1 code makes no network calls (no feeds, no LLM APIs)

All gates must pass before merge.
