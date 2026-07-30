# AGENTS.md — tests/fixtures/

**v2 — 2026-07-29.** Extended with the circularity findings from `docs/plans/recon-01.md`.

## STOP: the fixtures in `jmespath-samples/` are contaminated

`medium-get-conflict-events.response.json` carries `ciiContribution` **31 times, zero in all 31**. Captured **2026-05-17** from an upstream instance whose CII scoring was already degraded. Its entries include UA (`combinedScore: 67`, unrest/conflict zeroed, `militaryActivity` 35), SY (61), YE (60) — active-war countries with dead components.

Three independent axes of staleness: zeroed components; **missing disclosure fields** the current emitter writes (`eventMultiplier`, `methodologyVersion`, `advisoryLevel`, `advisoryProvenance`); and a retained `iran-events` dataset from a domain since sunset.

**A green test run is not evidence that CII scoring works.** It is evidence that the code still reproduces a broken snapshot.

## The suite cannot detect what you think it detects

Three findings from `recon-01.md`, all verified:

1. **The contract test is circular.** `tests/mcp-tool-output-contracts.test.mjs` — titled *"all 41 tools validate against declared outputSchema"* — replaces RPC `_execute` with a stub synthesized from the declared schema itself, then validates against that same schema (`:64-82,160-164,188`). Cache tools have every Redis read mocked to `{}` (`:103-106`). It exercises **zero real handler code**. Its own comment concedes it "proves the declared schema is internally consistent."

2. **The validator is one-directional.** `tests/helpers/json-schema-mini.mjs:33-56` — missing non-required declared fields pass, undeclared extra payload fields pass, and **no tool sets `additionalProperties:false`**. That is why `get_conflict_events` can declare `scores.ciiScores[].score` (a field that never exists; actual is `combinedScore`) and still show green.

3. **No test asserts a live payload against a declared schema.** The only real-payload coverage is the three captured fixtures, one of which encodes the degraded state. `tests/mcp-output-budget.test.mjs:22` says it plainly: *"only 3/41 tools have captured fixtures today."*

**Do not treat suite health as system health in this repo.** If you need to know whether something works, capture a real payload.

## Clean by construction — use these

`tests/cii-scoring.test.mts` asserts formula semantics against synthetic in-memory ACLED rows and aux objects (war floor `:950`, advisory floors `:1014,1022`, riot-vs-protest ordering `:913`, outage ordering `:1081`, displacement monotonicity `:1137`, ACLED time-decay `:835-838`). These are **good tests** — they never touch Redis, the ACLED fetch, or the stale-key pipeline.

Which is also their limit: **a green run here is fully compatible with a completely dark live pipeline.** Formula correctness and data flow are separate questions and this suite only answers the first.

`tests/cached-risk-scores.test.mts:244-261` verifies the wire→semantic reverse mapping with synthetic values. Same class, same limit.

## Rules

1. **Never write a new test that asserts against `jmespath-samples/`** for CII, conflict, unrest, or information values. Shape assertions are fine; value assertions are not.
2. **Never "fix" code to make these fixtures pass.** If code and fixture disagree on a component value, the fixture is the more likely liar.
3. Fresh captures go in `oracle/<capture-date>/` and stay separate. `oracle/` now exists — its README documents the separation, the hosted-vs-checkout tool gap, and capture mechanics.
4. The three shipped fixtures exist to exercise JMESPath projection at three payload sizes. Use them for that.
5. Pre-existing tests in `mcp-jmespath-doc-parity` and `mcp-output-budget` assert sizes and projection-equality rather than CII values — technically compliant with rule 1 while still inheriting the contamination. Do not extend that pattern.

## Capturing new fixtures

`scripts/capture-mcp-fixture.mjs`. Auth via `WM_MCP_KEY` (sends `X-WorldMonitor-Key`) or `WM_MCP_OAUTH_TOKEN` (sends `Authorization: Bearer`); endpoint override `WM_MCP_ENDPOINT` (`:40-42`). `WM_MCP_BEARER` exists at `.env.example:967` but **the script never reads it** — do not set it and expect anything.

Against the hosted service a subscriber key is metered. Against this fork — where we are the operator — `env_key` is unmetered, so replay and diff are free. One script, two endpoints.

**Caveat:** hosted exposes roughly 18 more tools than this checkout implements. A hosted capture may describe a tool with no local code. Check `api/mcp/registry/` before reconciling.
