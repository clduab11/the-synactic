# Tool Policy

## Policy Statement

Conservative, defense-in-depth approach to tool access and side effects.

## Principles

1. **Read-only first** — Default posture for all tools is read-only access
2. **Human approval before writes** — Any write operation requires explicit human approval
3. **No secrets in transit** — Secrets are never logged, echoed, or passed through event envelopes
4. **No external side effects** — Tools do not trigger external actions without explicit policy allowance
5. **Tool call logging and provenance** — `ToolCallRecord` is a Phase 1 contract: the data type is defined in `@the-synactic/contracts`, and every tool call and policy decision is recorded with required `SourceProvenance`. Only the logging transport/sink (persistence, shipping) is deferred to a future phase.

> **Note:** Principle 5 supersedes the earlier deferral of tool-call logging to a future phase. `docs/ABUSE-THREAT-MODEL.md` requires that all tool calls and decisions are logged and that every event carries required `SourceProvenance`; the `ToolCallRecord` contract therefore lands in Phase 1, while the logging transport/sink remains future work.

## Phase Status

Tool policy contracts and evaluator are implemented in Phase 1. The gateway integration (Phase 2) invokes `evaluatePolicy` on every tool call. The logging transport/sink remains future work.
