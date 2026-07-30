# CI Workflows

## `ci.yml`

Runs on every push and pull request to `main`. All action references are
SHA-pinned with the release tag noted in a trailing comment.

- **build-test** (matrix: `ubuntu-latest`, `windows-latest`) — corepack/pnpm
  install with `--frozen-lockfile`, then separate steps for the
  network-boundary guard (`scripts/check-network-boundary.mjs`), `pnpm check`,
  `pnpm lint`, `pnpm test`, and `pnpm build`.
- **dependency-audit** (`ubuntu-latest`) — `pnpm audit --prod
  --audit-level=high`. Production dependencies are `zod` only; the audit is
  expected to pass with zero exceptions.
- **secret-scan** (`ubuntu-latest`) — gitleaks over full git history.

## `scripts/check-network-boundary.mjs`

Phase 1 network-boundary guard. Fails the build if any file under
`packages/*/src` or `services/*/src` imports `node:http`, `node:https`,
`node:net`, `node:dns`, or `undici`, uses an `http:`/`https:` import
specifier, or calls the bare global `fetch()`. Run locally from the repo root:

```sh
node .github/scripts/check-network-boundary.mjs
```
