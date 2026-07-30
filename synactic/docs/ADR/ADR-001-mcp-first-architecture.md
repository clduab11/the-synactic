# ADR-001: MCP-First Architecture

## Status

Accepted

## Context

The platform requires a standardized protocol for mediating interactions between AI models and external tools/data sources. [constraint]

## Decision

Adopt Model Context Protocol (MCP) as the primary mechanism for all external tool interactions. [decision] All tool calls flow through an MCP gateway that enforces policy, tracks provenance, and mediates access. [decision]

## Consequences

- Standardized tool interface across all components [pattern]
- Centralized policy enforcement point [pattern]
- Provenance tracking built into protocol layer [pattern]
- Dependency on MCP specification and ecosystem maturity [constraint]

## Follow-up

- Define MCP gateway service contract
- Evaluate MCP SDK options
- Design policy enforcement hooks

> Evidence labels follow the convention in `docs/FOUNDATIONS.md`.
