# Foundations

## Core Design Principles

1. **Contracts-first** — All interfaces defined before implementation
2. **MCP-first** — External tool interactions mediated through Model Context Protocol
3. **Event-driven** — System communication flows through typed event envelopes
4. **Policy-governed** — Tool access and side effects controlled by explicit policy
5. **Provenance-aware** — All data carries source provenance metadata

## Evidence Labels

Design decisions are annotated with evidence labels indicating their basis:

- `[spec]` — Derived from formal specification
- `[pattern]` — Based on established architectural pattern
- `[constraint]` — Driven by technical or operational constraint
- `[decision]` — Explicit team decision

## Phase Status

Phase 1 (contracts, envelope, policy) is complete with tests and CI. Phase 2 (mcp-gateway, model-router) is in progress. Phase 0 wording is retained for historical context.
