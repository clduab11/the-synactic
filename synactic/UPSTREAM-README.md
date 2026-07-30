# the-synactic

> Phase 2 — MCP Gateway + Model Router Foundations (in progress); Phase 1 complete

## Status

This repository has completed **Phase 1** and is actively building **Phase 2**.

- **packages/contracts** — zod schemas: `SynacticEvent`, `SourceProvenance`, `ToolCallRecord`, `ActionPolicy`, `Digest`
- **packages/event-envelope** — envelope create/validate/serialize with secret-redaction guard
- **packages/tool-policy** — deterministic default-deny policy evaluator
- **services/mcp-gateway** — in-process tool registry + policy hook + envelope integration + mock transport (Phase 2)
- **services/model-router** — provider abstraction, fake provider, routing table with envelope wrapping (Phase 2)
- **~426 tests green** across all implemented workspaces
- **CI active**: check/lint/test/build on ubuntu-latest + windows-latest, dependency audit, gitleaks secret-scan, network-boundary guard
- **Mutation-verified guards**: tool-policy default-deny and event-envelope secret rejection were mutation-tested
- Services briefing-service remains a scaffold (Phase 3+)

## What This Is

- Monorepo using pnpm workspaces and Turborepo
- Implemented core packages: contracts, event-envelope, tool-policy
- Service workspaces as scaffolds for future implementation
- Documentation framework: architecture decisions, policies, use-case catalog
- Contracts-first, MCP-first architecture direction

## What This Is Not

- Not a working application
- Not a deployable service
- Not a production system

## Architecture Direction

Contracts-first, MCP-first. All inter-component communication flows through typed event envelopes. Tools are mediated by policy. Model routing is abstracted behind a gateway.

## Current Structure

```
the-synactic/
├── packages/
│   ├── contracts/          # Shared type definitions
│   ├── event-envelope/     # Event envelope protocol
│   └── tool-policy/        # Tool policy engine
├── services/
│   ├── mcp-gateway/        # MCP protocol gateway
│   ├── model-router/       # Model routing layer
│   └── briefing-service/   # Briefing generation service
├── docs/
│   ├── ADR/                # Architecture Decision Records
│   └── ...                 # Documentation files
├── experiments/            # Experimental prototypes
└── .github/workflows/      # CI pipeline
```

## Dev Workflow

Build, check, lint, and test pipelines are active via Turborepo. Run from the repo root with `corepack pnpm <build|check|lint|test>`. See `docs/DEVELOPMENT-WORKFLOW.md` for details.

## Licensing Boundaries

All code in this repository is original unless otherwise noted. See `docs/LICENSE-REGISTER.md` for details.

## Phase 1 Scope (Complete)

Phase 1 implemented: core contracts, the event-envelope protocol with runtime schema validation, the tool-policy engine core, full test infrastructure, and CI.

No network integrations of any kind in Phase 1 (no WorldMonitor, no feeds, no LLM APIs); pure local contracts + validation + tests.

Non-goals for Phase 1: mcp-gateway / model-router / briefing-service logic, protobuf/sebuf, deployment, any MCP server transport.
