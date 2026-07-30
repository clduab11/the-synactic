# synactic/ — vendored clean-room core

Vendored 2026-07-30 from Chris's original `the-synactic` monorepo (local-only
repo, retired after vendoring per the one-repo decision). All code here is
**original work by clduab11** — it predates and does not derive from the
surrounding WorldMonitor fork. `UPSTREAM-README.md` is the monorepo's README
at vendoring time; `docs/LICENSE-REGISTER.md` carries its licensing register.

## What's here

- `packages/contracts` — zod schemas: `SynacticEvent`, `SourceProvenance`,
  `ToolCallRecord`, `ActionPolicy`, `Digest`
- `packages/event-envelope` — envelope create/validate/serialize with a
  secret-redaction guard (mutation-tested)
- `packages/tool-policy` — deterministic default-deny policy evaluator
  (mutation-tested) — the intended policy gate for the Msty Go agent council
- `services/mcp-gateway`, `services/model-router` — Phase-2 foundations
  (in-process tool registry + policy hook; provider abstraction + routing);
  `services/briefing-service` is a Phase-3 scaffold
- `docs/` — ADRs and policies; `ci-reference/` — the monorepo's GitHub
  Actions pipeline, kept as the porting reference for this repo's CI

## Toolchain (deliberately separate)

This tree keeps its own pnpm/turbo toolchain and is NOT wired into the
fork's npm/Vite build. Run from this directory:

```bash
corepack pnpm install
corepack pnpm test
```

## Integration rule

The orchestration ring talks to the instrument **over the MCP wire only**
(`/api/mcp`, env_key auth) — `services/mcp-gateway` consumes the fork's MCP
server as a remote surface. Keep it that way: no imports across the
`synactic/` boundary in either direction.
