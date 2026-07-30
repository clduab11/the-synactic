# Architecture

## Overview

Contracts-first, MCP-first architecture. All inter-component communication is mediated through typed contracts and event envelopes.

## Flow

```
[External Sources] --> [MCP Gateway] --> [Event Envelope] --> [Model Router] --> [Briefing Service]
                            |                  |                   |                     |
                            +------------------+-------------------+---------------------+
                                               |
                         +---------------------+----------------------+
                         |          Shared Platform Layer             |
                         |     [Contracts]        [Tool Policy]       |
                         +--------------------------------------------+
```

Contracts and Tool Policy are platform-wide layers: every component consumes them. Neither belongs to any single component.

## Components

### Packages

- **contracts** — Shared type definitions for events, sources, tool calls, policies, and digests
- **event-envelope** — Envelope protocol for wrapping and routing events through the system
- **tool-policy** — Policy engine governing tool access, permissions, and side-effect controls

### Services

- **mcp-gateway** — MCP protocol gateway mediating all external tool interactions
- **model-router** — Abstraction layer for routing requests to appropriate AI models
- **briefing-service** — Generates structured briefings from processed intelligence

## Current Status

Phase 1 complete: packages implemented and tested. Phase 2 in progress: mcp-gateway and model-router are implemented with tests, envelope/policy integration, and in-process fakes. Briefing-service remains a scaffold for Phase 3.
