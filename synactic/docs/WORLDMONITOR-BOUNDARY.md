# WorldMonitor Network Boundary

## Overview

WorldMonitor is identified as a future network-boundary candidate for the-synactic platform.

## Phase 0 Status

Documentation only. No WorldMonitor integration, installation, or network configuration exists.

## Boundary Rules

1. **Deny-by-default egress** — All outbound network access is denied unless explicitly allowed by policy.
2. **No network calls without an approving ADR** — No network calls from `packages/` or `services/` in Phase 1–3 without an ADR approving the specific integration.
3. **worldmonitor license boundary (AGPL-3.0-only)** — worldmonitor (koala73/worldmonitor) is AGPL-3.0-only: no code may be copied, vendored, or paraphrase-translated into this repository. Patterns may be re-implemented from scratch.
4. **ruvnet approval gate** — No ruvnet components without explicit user approval (see ADR-003: ruvnet Integration Policy).

## Future Considerations

- Network boundary placement and segmentation
- API compatibility and protocol alignment
- Data flow authorization and provenance tracking
- Rate limiting and back-pressure mechanisms
