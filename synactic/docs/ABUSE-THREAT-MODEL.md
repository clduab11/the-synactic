# Abuse & Threat Model

## Overview

Defensive priorities framing for the-synactic platform, informed by milspec-related considerations.

## Threat Categories

- **Data poisoning** — Injection of misleading data into intelligence pipelines
- **Tool abuse** — Unauthorized or unintended use of mediated tools
- **Provenance spoofing** — Falsification of source attribution metadata
- **Policy bypass** — Circumvention of tool policy enforcement
- **Model manipulation** — Adversarial input targeting model routing or inference

## Defensive Priorities

1. Provenance integrity — all data carries verifiable source metadata
2. Policy enforcement — tool access governed by explicit, auditable policy
3. Human oversight — write operations require human approval
4. Audit trail — all tool calls and decisions are logged

## Phase 0 Status

Threat model is documented only. No enforcement mechanisms exist in code.
