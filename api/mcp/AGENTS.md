# AGENTS.md — api/mcp/

**v2 — 2026-07-29.** Tool count and line numbers corrected against `docs/plans/recon-01.md`.

## Self-hosting facts the docs omit

`SELF_HOSTING.md` contains **zero** occurrences of "mcp" (against 36 "redis" and 25 "docker"). This surface ships complete and entirely undocumented. Read the source here, not the guide.

- `api/mcp.ts` is a re-export shim — **106 lines** including protocol-version exports and a `__testing__` hatch. It carries no dispatch logic. *(v1 said "6-line"; substance held, size was wrong.)*
- The server is **`api/mcp/handler.ts`**, 843 lines, method switch at **`:685`**. *(v1 cited `:692`.)*
- `tools/call` at `handler.ts:736-753` → `dispatchToolsCall` (`dispatch.ts:121`). Tool results are JSON-stringified into `content[0].text` (`dispatch.ts:207,260`).
- `api/mcp-proxy.ts` is **not** the server. It is an outbound SSRF-guarded proxy letting the web app act as an MCP *client*. Do not confuse them.
- Self-host branch: non-production hosts route tool fetches to their own origin — ternary at `downstream.ts:101-107`, assignment at `:105`.

## Tool count — 41 in this checkout

**28 cache tools + 13 RPC tools = 41**, merged from exactly **two** registry files (`cache-tools.ts`, `rpc-tools.ts`) at `api/mcp/registry/index.ts:5-12`. Corroborated by two in-repo anchors: `tests/mcp-output-budget.test.mjs:22` ("3/41 tools") and `tests/mcp-tool-output-contracts.test.mjs:84` ("all 41 tools").

> **v1 CORRECTION.** v1 claimed "exactly 59 tools across five registry files: cache 30 / rpc 17 / analysis 7 / company-intel 1 / nlp 4." Those files do not exist here. The 59 figure came from the **live hosted service**; it was written up as a claim about repo source in error.
>
> **Both are likely true of different things — this checkout is roughly 18 tools behind hosted.** Contracts captured from the hosted instance may describe tools with no local implementation. Verify a tool exists in `registry/` before reconciling its schema.

## Credential classes — Convex is off the critical path

| Gate | `env_key` | Source |
|---|---|---|
| Entitlement | **skipped** — `runContextPreChecks` returns null | `auth.ts:484-498` |
| Daily quota | **never entered** — guard is `pro \|\| user_key`, `describe_tool` exempt by name | `dispatch.ts:147-153` |
| Per-minute (60) | applies, **fails open** on error | `auth.ts:506-521` |

`env_key` is the operator-owned class (`auth.ts:464-465`: *"operator-owned and intentionally ungated"*), resolved from `WORLDMONITOR_VALID_KEYS` via the `X-WorldMonitor-Key` header (`auth.ts:305-317`).

**A single-operator self-host on `env_key` does not need Convex.** It does need Redis — the rate limiter, the seeded data layer, and every cache tool read it.

## The contract test does not test contracts

`tests/mcp-tool-output-contracts.test.mjs` replaces RPC `_execute` with a stub synthesized from the declared schema, then validates the result against that same schema (`:64-82,160-164,188`); cache tools have Redis mocked to `{}` (`:103-106`). It exercises **zero real handler code**. Its own comment concedes it "proves the declared schema is internally consistent."

Do not cite a green run of this test as evidence any tool works. See Trap 6 in `CONTEXT.md`.

## Schema declarations are a hint surface, not a contract

`api/mcp/filters.ts:280-307` — `cacheEnvelope` requires only `cached_at/stale/data`, leaves per-label `data.properties` optional and `additionalProperties` implicit-true, and describes itself as *"the LLM's hint surface … not an exhaustive bytecode-level contract."* The shared validator (`tests/helpers/json-schema-mini.mjs:30-70`) never rejects undeclared extras.

**Probe with `jmespath: "keys(@)"` before writing any real projection.** It is the cheapest possible shape check and the only trustworthy one.

## Context-engineering features worth preserving

- JMESPath server-side projection — `jmespath.ts:46`
- `TOOL_DESCRIPTION_MAX_BYTES = 120` — `constants.ts:329`. Raising it in this fork is a one-constant change, but consider whether you want to: compression plus a quota-exempt `describe_tool` expansion path is good design.
- Compressed and expanded descriptions both flow through `buildPublicTool`, so they cannot drift.
