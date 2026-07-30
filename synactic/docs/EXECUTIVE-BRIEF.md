# Executive Brief

## Purpose

the-synactic is a contracts-first, MCP-first platform for structured intelligence gathering, analysis, and briefing generation.

## Status

**Phase 0** — Repository bootstrap. No working code, no dependencies, no build pipeline.

## Phase 0 Scope

- Monorepo scaffold (pnpm workspaces, Turborepo config)
- Package and service placeholders
- Documentation skeleton (architecture, policies, ADRs)
- Development workflow conventions

## Phase 1 Scope

Phase 1 implements: core contracts, the event-envelope protocol with runtime schema validation, the tool-policy engine core, full test infrastructure, and CI.

No network integrations of any kind in Phase 1 (no WorldMonitor, no feeds, no LLM APIs); pure local contracts + validation + tests.

Non-goals for Phase 1: mcp-gateway / model-router / briefing-service logic, protobuf/sebuf, deployment, any MCP server transport.

## Future Work

- Phase 2: MCP gateway implementation, model routing
- Phase 3: Briefing service, tool-policy enforcement integration
- Phase 4+: Integration with external systems (WorldMonitor, ruvnet candidates)
