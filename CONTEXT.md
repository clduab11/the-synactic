# CONTEXT.md — the-synactic fork ground truth

**This file is fork-specific. `AGENTS.md` in this directory is upstream's and is still authoritative for architecture, build, and conventions — read both.**
Kept as a separate file so upstream merges never conflict with fork knowledge.

**v2 — 2026-07-29.** Corrected after `docs/plans/recon-01.md`, which refuted three v1 claims from source. Every correction is marked. Line numbers re-pinned to this checkout.

---

## What this fork is

Praxen's internal analytical instrument (working name **the-synactic**), forked from AGPL-3.0 WorldMonitor. It is an **internal tool that produces human-authored reports**. No external users ever touch the running instance.

Consequences that shape every decision here:

- **No SLA, no multi-tenancy, no auth hardening, no uptime obligation.** Do not build them.
- **Correctness and provenance matter more than in a product**, because a wrong figure lands in a client deliverable. Prefer failing loudly over degrading silently.
- AGPL §13 network copyleft does not trigger while there are no external users. If anyone proposes client logins or an exposed API, that is a charter change — stop and escalate.

---

## HARD BOUNDARIES — do not cross without an explicit human decision

1. **Never write code that places orders, executes trades, or moves money.** This system is information plumbing. OANDA, Binance, Kraken, and Coinbase integrations are **read-only pricing/rates streams**. Order endpoints are out of scope, permanently.

2. **Retention decided 2026-07-29: OREF, the Telegram MTProto layer, and OpenSky / `PROXY_URL` STAY.** The keep/disable question is closed — they are not to be removed, and refactors must not break them.

   **What has not changed:** do not actively improve the circumvention capability itself. Specifically, do not enhance JA3 fingerprint evasion, add proxy rotation or exit-IP diversity, or harden these paths against detection. Keeping a component and upgrading its evasion are different acts, and only the first was decided.

   Reading them, keeping them compiling, and refactoring around them is fine and expected.

3. **Blocked upstreams — do not wire NEW live paths:** Kalshi, Finnhub, ACLED.
   Existing upstream paths are retained per the 2026-07-29 retention decision — notably Finnhub is already live-called at `api/symbol-search.ts:224` with `FINNHUB_API_KEY` passed through in docker-compose, and Kalshi appears only as a `source` enum label on seeded prediction-market rows (no live wiring). Retention ≠ authorization to add new integrations against these providers.
   **ACLED specifically: `ACLED_MODE` must stay defaulted to `fixture` pre-licence.**

4. **Do not target the hosted `worldmonitor.app` entitlement system.** Never patch Pro-grant checks (`MCP_PRO_GRANT_HMAC_SECRET`, `MCP_INTERNAL_HMAC_SECRET`) or work around `wm_` quotas. In this fork those are our own secrets and configuring them is normal. If you encounter those code paths, note and move on.

---

## THE SIX TRAPS

Traps 1–4 were found by analysis and independently re-verified by `recon-01.md`. Traps 5–6 were found by that recon and are the most operationally dangerous of the set.

### Trap 1 — the test fixtures encode the broken state

`tests/fixtures/jmespath-samples/` holds exactly three fixtures. `medium-get-conflict-events.response.json` carries `ciiContribution` **31 times, zero in all 31**, captured **2026-05-17** from an already-degraded instance. Its degraded entries include UA (`combinedScore: 67` with unrest/conflict zeroed while `militaryActivity` reads 35), SY, YE.

Three independent staleness axes: zeroed CII components, missing disclosure fields the current emitter writes (`eventMultiplier`, `methodologyVersion`, `advisoryLevel`, `advisoryProvenance`), and a retained `iran-events` dataset from a sunset domain.

**A green test suite is not evidence that CII scoring works.** Fresh captures belong in `tests/fixtures/oracle/<capture-date>/` — which does not exist yet.

### Trap 2 — the wire field names lie

Verified from source (`get-risk-scores.ts:1214-1219` writes, `src/services/cached-risk-scores.ts:90-95` reads), from the live dashboard's U/C/S/I labels, and from live MCP payloads.

| Wire field | Actually means | Actually fed by |
|---|---|---|
| `ciiContribution` | **unrest** | **ACLED event stream** (protests/riots/fatalities, `:859-887` → formula `:1077-1087`) **plus internet-outage boosts** (`infra:outages:v1` → `outageBoost` at `:1086`) |
| `geoConvergence` | **conflict** | `acledScore + fatalityScore + civilianBoost + strikeBoost + orefBoost` (`get-risk-scores.ts:1102`) |
| `militaryActivity` | **security** | military flights + vessels (`:1104-1119`) |
| `newsActivity` | **information** | news feed (`:1121-1125`) |

> **v1 CORRECTION.** v1 attributed the unrest component to a GDELT unrest feed. **Wrong.** The strings `gdelt` and `unrest:events` appear **zero times** in `get-risk-scores.ts`. The GDELT-backed `unrest:events:v1` key feeds the `get_conflict_events` MCP tool's `events` label (`cache-tools.ts:265`) and dashboard panels — **not** the server CII path that MCP serves.
>
> **Consequence: ACLED feeds TWO of four components — unrest and conflict — carrying 0.55 of the event-score weight combined.**

**`geoConvergence` has nothing to do with `src/services/geo-convergence.ts`.** A case-insensitive grep for "convergence" in `get-risk-scores.ts` returns exactly one hit — the field name at `:1217`. **Read the assignment, never the name.**

**Scoring weights** (`:1127`, `:1183-1194`, `:1197-1202`):
```
eventScore = unrest*0.25 + conflict*0.30 + security*0.20 + information*0.25
blended    = baseline*0.4 + eventScore*0.6 + ten additive boosts
floors     = ucdpFloor (70 war / 50 minor)  |  advisoryFloor (60 do-not-travel / 50 reconsider)
composite  = min(100, max(floor, round(blended)))
```
UCDP is a **floor, not a component**, derived over a 2-year trailing window (`:481-510`).

### Trap 3 — declared output schemas disagree with actual payloads

Three Critical drifts that produce silently wrong generated clients:

1. **`get_country_risk`** (`rpc-tools.ts:514-531` vs `538-547`) — declares `cii: number|null`, actual is an object (or **absent**, never `null`); declares `components{unrest,conflict,security,news}`, actual is the four fossil names; declares `travelAdvisory`/`sanctionsExposure`, actual is `advisoryLevel`/`sanctionsActive`/`sanctionsCount`.
2. **`get_conflict_events`** (`cache-tools.ts:237-243`) — declares `scores.ciiScores[].score`, which **never exists**. Actual field is `combinedScore`.
3. **`get_country_brief`** (`rpc-tools.ts:391-413`) — declares `country_code`, upstream returns `countryCode`. Also carries an in-source "METHOD DRIFT" note: `_execute` POSTs while OpenAPI declares GET (`:494-498`).

**Generate client code from observed payloads, never from `describe_tool` or declared `outputSchema`.** Cache-tool schemas are explicitly a "hint surface … not an exhaustive bytecode-level contract" (`api/mcp/filters.ts:280-307`). 17 cache tools remain undiffed — treat as presumed-drift until probed.

### Trap 4 — `SELF_HOSTING.md` never mentions MCP

Case-insensitive grep on this checkout: `mcp` **0**, `redis` **36**, `docker` **25**. The MCP server ships complete (`api/mcp/handler.ts`, 843 lines, method switch at `:685`) and is entirely undocumented in the self-hosting guide. Read the source, not the guide.

### Trap 5 — COLD-START DEADLOCK on the stale CII key `[most dangerous]`

`getCountryRisk` reads **only** `risk:scores:sebuf:stale:v8` (`get-country-risk.ts:12,44-45`). **No seeder writes that key.** Repo-wide grep finds only constant mirrors, one test, and readers. It is written solely by the leader-gated path inside `getRiskScores` on a fresh compute (`get-risk-scores.ts:1545,1617-1621`).

The relay's CII warm-ping hard-codes the **hosted** origin `https://api.worldmonitor.app` (`scripts/ais-relay.cjs:4655`) and 401s without `WORLDMONITOR_RELAY_KEY` (`:4632-4634`); docker-compose sets neither (`:71-79`).

**A fresh self-host with all 156 seeders green still returns `upstreamUnavailable: true` from `get_country_risk` — forever — until something hits the LOCAL `/api/intelligence/v1/get-risk-scores`.** Note `cii` is *absent*, not `null` (`get-country-risk.ts:53-64`).

Runbook: curl the local endpoint once after seeding, or add a fork-local warmer. Do not debug the seeders for this.

### Trap 6 — the contract test is circular and provides false assurance

`tests/mcp-tool-output-contracts.test.mjs` — titled *"all 41 tools validate against declared outputSchema"* — **exercises zero real handler code**. For RPC tools it replaces `_execute` with a stub synthesized from the declared schema (`minimalShape(tool.outputSchema)`), then validates against that same schema (`:64-82,160-164,188`). Its own comment concedes it "proves the declared schema is internally consistent." Cache tools have every Redis read mocked to `{}` (`:103-106`).

Compounding it, the shared validator is **one-directional** (`tests/helpers/json-schema-mini.mjs:33-56`): missing non-required declared fields and undeclared extra payload fields both pass, and **no tool sets `additionalProperties:false`**. That is precisely why Trap 3's `score`-vs-`combinedScore` drift coexists with a green suite.

**No test asserts a live payload against a declared schema.** Green means nothing here.

---

## Verified facts an agent should not re-derive

- **Stack is Vite + vanilla TS + Preact.** Not Next.js.
- **This checkout exposes 41 MCP tools** — 28 cache + 13 rpc, from **two** registry files (`api/mcp/registry/index.ts:5-12`), corroborated by `tests/mcp-output-budget.test.mjs:22` and `tests/mcp-tool-output-contracts.test.mjs:84`.
  > **v1 CORRECTION.** v1 claimed 59 tools across five registry files. That count was taken from the **live hosted service**, not this source tree, and was written up as a source claim in error. Both are probably true of different things: **the fork checkout is roughly 18 tools behind the hosted instance.** Anything captured from hosted may have no local implementation — check before reconciling.
- **Convex is NOT required for a single-operator self-host.** `env_key` is ungated by design: `api/mcp/auth.ts:484-498` (`runContextPreChecks` returns null — no entitlement gate) and `api/mcp/dispatch.ts:147-153` (quota guard is `pro || user_key` only, `describe_tool` exempt by name). 60/min limiter fails open (`auth.ts:506-521`). Keys resolve from `WORLDMONITOR_VALID_KEYS` via `X-WorldMonitor-Key` (`auth.ts:305-317`).
- **No Upstash or Railway needed.** `docker-compose.yml:94-95` ships `redis` (`--maxmemory 256mb --maxmemory-policy allkeys-lru`); `:100-107` ships `redis-rest` (Serverless Redis HTTP shim) on `127.0.0.1:8079`.
- **156 seeder scripts** driven by `scripts/run-seeders.sh`. `SEED_TIMEOUT` defaults 1800s (`:70`) and **silently degrades to plain `node` without GNU `timeout`** (`:74,96`). Nothing in the app container runs seeders — the Dockerfile has zero `seed`/`cron` references.
- **Redis is `allkeys-lru` against a Redis-first read path with no upstream fallback.** Evicted seed keys present as empty panels with no error. `noeviction` would fail loudly at write time instead — config decision, unowned.
- **Dead-by-default inputs:** Iran events (`IRAN_EVENTS_ENABLED=false`, `:723,734`); temporal anomalies (gathered, never scored — `:1171-1177`); trend prior (flat STABLE for ~24h on a fresh deploy, `:411-420`).
- Fixture-capture env vars are `WM_MCP_ENDPOINT`, `WM_MCP_KEY`, `WM_MCP_OAUTH_TOKEN` (`scripts/capture-mcp-fixture.mjs:40-42`).
  > **v1 CORRECTION.** v1 claimed `WM_MCP_BEARER` has "zero matches repo-wide." **False** — it exists at `.env.example:967`. The substance held (the capture script never reads it) but the claim did not. *Never assert a negative from a silent grep.*

---

## Working conventions for agents in this repo

- **Label every claim** `[VERIFIED]` (cite file:line), `[OPEN]` (say so plainly), or `[BOUNDARY]` (a rule, not a finding).
- **Read the assignment, not the name.** Fields, files, and functions here point at the wrong subsystem.
- **Never assert a negative from an empty grep.** Confirm positively. This document has been wrong that way once already.
- **Re-derive line numbers.** Citations in this file and the scoped `AGENTS.md` files drift on upstream merges. Flag drift inline rather than silently correcting.
- **Runtime claims are `[OPEN]` from source alone.** Live component values, observed payloads, and probe results cannot be derived from the repo. Say so.
- **Copy upstream's honesty patterns rather than stripping them.** `unavailable_inputs` vs `failed_inputs`, `quiet` vs `unavailable` domain lists, per-feed ingest counters, `countryCoverage: unknown` meaning unobserved rather than zero. These are the best thing in this codebase.
- **Preserve the embedded content-safety notes** on third-party text fields (`title`, `summary`, `sourceUrl` on intel-history records). This fork relays that text into client deliverables — those guards matter more here, not less.
- Do not uniformly lower TTLs. AviationStack already ships `MIN_REFRESH_MIN`, `MONTHLY_BUDGET`, and `REQUEST_BUDGET` because someone learned that lesson.

## Fork document index

- `docs/plans/recon-01.md` — full verified recon, 15 open questions (gitignored, local only)
- `tests/fixtures/AGENTS.md` — fixture contamination and capture policy
- `server/worldmonitor/intelligence/v1/AGENTS.md` — CII path, field decode, weights
- `api/mcp/AGENTS.md` — MCP surface, credential classes, self-host branch
- `shared/threat-matrix-output.schema.json` — constrained output contract for the inference layer
