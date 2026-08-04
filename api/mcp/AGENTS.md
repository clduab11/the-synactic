# AGENTS.md — api/mcp/

**v3 — 2026-08-04.** Tool count re-verified three ways (70, not 41). ⚠ The line
citations below this header were last checked at v2 and several have since
drifted — re-derive any line number before relying on it.

## Self-hosting facts the docs omit

`SELF_HOSTING.md` contains **zero** occurrences of "mcp" (against 36 "redis" and 25 "docker"). This surface ships complete and entirely undocumented. Read the source here, not the guide.

- `api/mcp.ts` is a re-export shim — **106 lines** including protocol-version exports and a `__testing__` hatch. It carries no dispatch logic. *(v1 said "6-line"; substance held, size was wrong.)*
- The server is **`api/mcp/handler.ts`**, 843 lines, method switch at **`:685`**. *(v1 cited `:692`.)*
- `tools/call` at `handler.ts:736-753` → `dispatchToolsCall` (`dispatch.ts:121`). Tool results are JSON-stringified into `content[0].text` (`dispatch.ts:207,260`).
- `api/mcp-proxy.ts` is **not** the server. It is an outbound SSRF-guarded proxy letting the web app act as an MCP *client*. Do not confuse them.
- Self-host branch: non-production hosts route tool fetches to their own origin — ternary at `downstream.ts:101-107`, assignment at `:105`.

## Tool count — 70 in this checkout

**37 cache + 29 rpc + 4 nlp = 70**, across **five** registry files. Verified three
independent ways on 2026-08-04: evaluating `TOOL_REGISTRY.length` = 70,
`public/.well-known/mcp/server-card.json`.tools.length = 70, and
`docs/generated/stats.json`.mcpToolCount = 70.

> **COUNTING TRAP.** `api/mcp/registry/index.ts` imports only THREE names
> (CACHE_TOOLS, NLP_TOOLS, RPC_TOOLS), so counting its imports yields three files
> and is wrong. `rpc-tools.ts` itself imports ANALYSIS_TOOLS and COMPANY_INTEL_TOOL
> and folds them into its own export, so the "29 rpc" already absorbs 7 analysis
> tools and 1 company-intel tool. Five files, three imports, one merged count.

> **DO NOT HAND-EDIT THIS NUMBER.** Regenerate with `npm run product:facts`
> and `npm run docs:stats`. Note that `docs/generated/stats.json` does NOT read
> the registry — it reads `server-card.json`.tools.length — so adding a tool and
> running only `docs:stats` leaves the published count stale.

> **v1/v2 CORRECTION (2026-08-04).** v1 claimed 59 tools; v2 claimed 41 from
> "exactly two registry files" and cited two test titles that no longer contain
> that number. Both were wrong about this checkout, and the hosted-vs-local drift
> theory v2 advanced is obsolete — local IS the full 70.

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
