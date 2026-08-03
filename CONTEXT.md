# CONTEXT.md — the-synactic fork ground truth

**This file is fork-specific. `AGENTS.md` in this directory is upstream's and is still authoritative for architecture, build, and conventions — read both.**
Kept as a separate file so upstream merges never conflict with fork knowledge.

**v2 — 2026-07-29.** Corrected after `docs/plans/recon-01.md`, which refuted three v1 claims from source. Every correction is marked. Line numbers re-pinned to this checkout.

**v3 — 2026-07-30.** Charter change by the owner: the-synactic is now an MCP-accessible **read-only intelligence provider** for downstream authorized actors, not report-only. AGPL §13 escalation language removed (owner decision, legal cleared). The instrument stays read-only in its own code; execution lives downstream. README lineage credit and the LICENSE file are unchanged (attribution, not charter).

**v4 — 2026-08-03.** Owner amendment to boundary 1: **Kraken is authorized** (Kraken only), with a binding do-not-abuse-the-quota condition. See boundary 1.

**v5 — 2026-08-03.** Owner amendment to boundary 4: **local self-host / desktop entitlement is authorized**, gated on the build-time `VITE_SELFHOST_PRO` flag and strictly client-side. Hosted server-side auth is untouched and still governs anything calling `api.worldmonitor.app`. See boundary 4.

Also landed 2026-08-03 and reflected below: the brand rename to **the-synactic** for user-visible identity, **ReliefWeb removed** as a data source, and a **DEFCON OSINT indicator**.

**v6 — 2026-08-03.** **defconlevel.com granted MCP redistribution**, conditional on **no model training**. The `get_defcon_level` tool ships (registry now **69**), and the condition is carried in-band on every record as `usageRestrictions.training = 'prohibited'` — not in prose alone, because the consumer is a machine. Do not strip that field.

> **Provenance, right-sized 2026-08-03.** The permission rests on an owner-relayed account of the email rather than an attached artifact — the same shape as the Kalshi and Kraken records. **This is deliberately NOT flagged as urgent**, because the owner has stated he is the sole consumer of this MCP surface and expects to remain so. The failure mode that made the Kalshi gap expensive — a paraphrased term reaching third parties who cannot check it against the original — does not apply to a consumer set of one.
>
> What that leaves is ordinary hygiene: if the surface is ever opened to another consumer, or the `usageRestrictions` wording is ever quoted outward, pin it to the actual email first (date, from-address, their exact phrasing on training). Widening the consumer set is the trigger, not the calendar.

---

## What this instrument is

Praxen's analytical instrument (**the-synactic**), built on a WorldMonitor fork. It collects at machine scale and exposes **read-only intelligence** — over an MCP tool surface and as human-authored reports. Downstream systems that hold their own execution authority (Claude Code sessions, trading repos) consume that intelligence via MCP and act on it under their own permissions.

Consequences that shape every decision here:

- **Correctness and provenance matter more than in a product**, because a wrong figure lands in a client deliverable or a downstream decision. Prefer failing loudly over degrading silently.
- **The instrument is a source of truth, not an actor.** It reads, scores, and serves; it never places an order, executes a trade, or moves money in its own code. Execution lives downstream, gated by those systems' own authorization.
- **Serving the MCP surface to downstream systems is the intended operating model** (owner decision, legal cleared). Build the tool surface to be robust, self-describing, and pleasant for LLM consumers — that is now a first-class goal, not a charter risk.

---

## HARD BOUNDARIES — do not cross without an explicit human decision

1. **The instrument itself stays read-only — it never places orders, executes trades, or moves money.** The-synactic serves market data, risk scores and prediction-market signals over MCP to downstream systems that hold their own trading authorization; those systems execute, the instrument does not. Order/execution code does not live in this repo. (This is the instrument's own design, and the line Claude holds when authoring its code.)

   > **v3 CORRECTION 2026-07-30 — the venue list in v1/v2 was false for this checkout.** Earlier drafts asserted "OANDA, Binance, Kraken, and Coinbase integrations are read-only pricing/rates streams." Repo-wide search says otherwise: **OANDA** appears only as the substring "Quint**oAnda**r" in two map configs plus one test fixture string `OANDA:EUR_USD`; **Kraken** appears only in this file and a minified Clerk vendor bundle; **Coinbase** appears only as two map pins (a VC portfolio entry and an HQ marker); **Binance** appears only as the Finnhub candle symbol `BINANCE:BTCUSDT` (`scripts/seed-economy.mjs:471`) and as the CoinGecko token id `binancecoin`. **Three of the four have no integration at all, and the fourth arrives through Finnhub — itself a blocked-for-new-wiring upstream.** **Polymarket** is genuinely wired (`api/polymarket.js`, a key- and rate-limit-gated relay handler, plus a direct Gamma call in `scripts/seed-prediction-markets.mjs:37`). **Kalshi is ALSO live-wired** — see the correction under boundary 3; the "source enum label only" claim was false and is retracted.

   **RESOLVED 2026-07-30 (owner) — the instrument does not ingest venue market data at all.** OANDA is dropped, and Binance / Kraken / Coinbase are not to be wired either. Venue price, funding and depth data belong to the **downstream trading repos**, which hold the exchange accounts and the licences that come with them, and which fetch their own feeds. The-synactic's job in that topology is the **realtime OSINT baseline** — geopolitical, conflict, sanctions, advisory, supply-chain, energy and macro context that a price feed cannot supply — which those repos fuse with their own market data to drive watches and trades.

   That split is not just tidy, it dissolves most of the licensing exposure surveyed in `docs/plans/venue-licensing-01.md`: the clauses that bite hardest (OANDA §15.0(a) re-transmission, Coinbase's internal fair-value ban, Polymarket §4.2 Capital-Market-Client access) all attach to *market data* we no longer carry. The account-holding repo using its own venue data to trade at that venue is squarely inside every one of those licences.

   **v4 AMENDMENT 2026-08-03 (owner) — KRAKEN IS AUTHORIZED. Kraken only.**
   Chris obtained permission from Kraken for this use case: ingest Kraken market data and
   re-serve it, including to a downstream consumer. This reverses the 2026-07-30 resolution
   **for Kraken alone**. Kraken was already the cheapest venue to unblock — no derived-data
   clause, and `marketdata@kraken.com` is a named permission channel — and that channel was used
   rather than assumed.

   **Owner-imposed condition, treat as binding:** the integration must not run up API credits
   or trip rate limits. Respect the published limits, cache aggressively, poll at the lowest
   cadence that serves the use case, and prefer one streaming connection over polling loops.
   Boundary 2 already says respect published rate limits and back off; that applies here with
   full force. A permission obtained and then abused is worse than no permission.

   **What this does NOT authorize.** Binance, Coinbase and OANDA are unchanged — still not to
   be wired. In particular `scripts/seed-economy.mjs:471` still falls back to `BINANCE:BTCUSDT`
   via Finnhub, and `FINNHUB_API_KEY` is now SET (2026-08-03), so that path is live-capable.
   Kraken permission does not cover it. Kraken's own public OHLC endpoint is now the correct
   replacement for that fallback, and CoinGecko / CoinPaprika are already wired in this repo
   as non-venue alternatives.

   > **Provenance, right-sized 2026-08-03 (session 09, owner-directed).** The permission rests
   > on an owner-relayed account of the marketdata@kraken.com exchange rather than an attached
   > artifact — the same shape as the Kalshi and defconlevel.com records. **Deliberately NOT
   > flagged as urgent**, for the same reason as CONTEXT.md v6's DEFCON note: the owner is the
   > sole consumer of this MCP surface and expects to remain so, which removes the failure mode
   > that made the Kalshi gap expensive (a paraphrased term reaching a third party who cannot
   > check it). What remains is ordinary hygiene with a **condition, not a calendar**: if the
   > surface is ever opened to another consumer, or the scope wording is ever quoted outward,
   > pin this block to the actual thread first (date, channel, the scope Kraken agreed). Until
   > an artifact is attached, treat the SCOPE as "what Kraken agreed", not "whatever we build" —
   > the session-09 integration (4 spot pairs, Ticker + daily OHLC, 45-min cadence, re-served
   > over MCP with `redistributionScope` in-band) is the current outer edge of what is built.

   **Design consequence:** do not build cross-venue spread, funding-stress, or depth-decay tools here. Those need venue data. Build the OSINT surface a machine consumer cannot reconstruct — and keep `source`, `fetched_at` and freshness state on every record so the consumer can reason about staleness.

2. **Retention decided 2026-07-29: OREF, the Telegram MTProto layer, and OpenSky / `PROXY_URL` STAY.** The keep/disable question is closed — they are not to be removed, and refactors must not break them.

   **v3 change (owner, 2026-07-30): collection-path resilience is IN SCOPE.** Diagnosing our own TLS/JA3 fingerprint, sequestering collection clients by fingerprint, proxy rotation, exit-IP diversity, and comparable narrow, orthogonal measures are ordinary collection infrastructure and may be researched, built, and hardened. Earlier drafts of this file forbade them; that restriction is lifted by owner decision.

   **The one line that stays:** measures whose only purpose is to defeat a third party's control in order to take more than that party permits — impersonating a browser to get around an anti-bot product that has deliberately blocked us, or cycling identities to evade a published per-IP quota — remain out. Respect published rate limits and back off. Path diversity for reliability is fine; laundering identity to exceed a quota is not.

   Reading them, keeping them compiling, and refactoring around them is fine and expected.

3. **Blocked upstreams — do not wire NEW live paths:** Kalshi, Finnhub, ACLED.
   Existing upstream paths are retained per the 2026-07-29 retention decision — notably Finnhub is already live-called at `api/symbol-search.ts:224` with `FINNHUB_API_KEY` passed through in docker-compose. Retention ≠ authorization to add new integrations against these providers.

   > **v3 CORRECTION 2026-07-30 — Kalshi IS live-wired, and has been all along.** v1/v2 said Kalshi "appears only as a `source` enum label on seeded prediction-market rows (no live wiring)." **False.** `scripts/seed-prediction-markets.mjs:16` sets `KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2'` and `:56` fetches `/events?status=open&with_nested_markets=true&limit=100`, merging the result into `prediction:markets-bootstrap:v1` alongside Polymarket. It is scheduled (Railway service in `docs/railway-seed-consolidation-runbook.md:545`) and **it has executed on this machine** — `seed-meta:prediction:markets` shows `recordCount: 75` written 2026-07-30. `docs/architecture.mdx:245` credits only "Polymarket Gamma API"; the Kalshi leg is live and undocumented. So boundary 3 was never a "do not start" for Kalshi — it is a **stop-or-keep decision on a running path**.
   >
   > Both prediction-market calls also send a spoofed browser UA: `scripts/_seed-utils.mjs:38` defines `CHROME_UA` as a full Chrome/134 string and `seed-prediction-markets.mjs:37,55` sends it to Polymarket **and** Kalshi. Whatever is decided on retention, an honest bot UA is the defensible posture; a Chrome string is the one fact that reads as circumvention rather than ordinary use of a public API.
   >
   > Licensing detail is in `docs/plans/venue-licensing-01.md`.
   >
   > **RESOLVED 2026-07-30 by the owner, and it corrects my reading.** From the Data Terms §II text alone I read the AI/ML clause as reaching **inference**. Chris has spoken with **Kalshi's legal counsel**, who confirmed the clause is scoped to **training, not inference**. Counsel's construction of their own instrument outranks a document read, so that is the operative position: serving Kalshi-derived data into an LLM's context for reasoning is not the prohibited activity. **Still open:** the Developer Agreement §4.1.1 Exchange-membership question — Chris is getting confirmation. Do not treat that one as settled yet.
   >
   > This is also now largely moot for this repo under the boundary-1 resolution above: prediction-market *trading* lives in the downstream repos. The Kalshi collection path here supplies OSINT context, not an execution feed.
   **ACLED specifically: `ACLED_MODE` must stay defaulted to `fixture` pre-licence.**

4. **Do not target the hosted `worldmonitor.app` entitlement system.** Never patch Pro-grant checks (`MCP_PRO_GRANT_HMAC_SECRET`, `MCP_INTERNAL_HMAC_SECRET`) or work around `wm_` quotas. In this fork those are our own secrets and configuring them is normal. If you encounter those code paths, note and move on.

   **v5 AMENDMENT 2026-08-03 (owner) — LOCAL ENTITLEMENT IS AUTHORIZED. Local only.**
   The owner holds a paid Pro membership on worldmonitor.app and runs this fork himself under
   its open-source licence. ADV-34 had unlocked premium UI through `hasPremiumAccess()`, but a
   **second, independent predicate** — `isEntitled()` — gated the account-shaped surfaces
   (Notifications, data export, MCP Clients). It reads a Convex snapshot that only ever arrives
   for a signed-in Clerk user against the **hosted** service, so a self-host had those
   permanently padlocked on a deployment that owns its own data and its own wired API keys.
   On a desktop build that is a **defect, not a licensing control**, and fixing it was the
   stated point of the fork.

   **What is authorized:** `src/services/entitlements.ts` synthesizes a local
   `EntitlementState` behind `effectiveState()`, gated on the **existing** build-time
   `isSelfHostPremiumUnlock()` (`VITE_SELFHOST_PRO`). A hosted build resolves that to false and
   is entirely unaffected. A real Convex snapshot always wins when one exists.

   **The line that stays — and it is the whole reason this is not circumvention.** This unlocks
   **client-side UI only**. Anything that actually calls hosted `api.worldmonitor.app` still
   meets that service's own **server-side** auth and is still refused. A client-side patch
   cannot and must not be used to obtain hosted server resources without paying. If you find
   yourself editing a *server* check, or forging a credential, or making a hosted endpoint
   answer for an unpaid caller, you have left the authorized scope.

   **Consequences already applied, do not "fix" them back:**
   - `isEntitlementActive()` is deliberately **pure**. It encodes the real paid-user rule and
     its tests must keep measuring that rule, so the self-host branch lives in the callers.
   - `UnifiedSettings` uses `hasLocalPro`, deliberately **separate** from `isSignedIn`, because
     the latter also gates "Plan & billing" — a billing tab on a self-host would error on every
     action.
   - The **API Keys** tab is NOT unlocked by this. It manages keys *issued by* the hosted
     service; unlocking it would show buttons that all fail. It renders a self-host panel
     (endpoints, `X-WorldMonitor-Key`, effective entitlement) instead. **No secret is rendered
     there** — `WORLDMONITOR_VALID_KEYS` is server-side only and
     `tests/browser-bundle-secret-guard.test.mts` enforces that. Keep it that way.
   - `seedSecretsFromEnvironment()` applies the unlock **above** the `isDesktopRuntime()`
     early-return. It sat below it until 2026-08-03, which meant `VITE_SELFHOST_PRO` silently
     did nothing in the desktop app.

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

**v3 amendment — the cure is not durable, and the deadlock returns hourly.** The stale key is written with `RISK_STALE_TTL = 3600` (`get-risk-scores.ts:1417`, write at `:1545`) and compose's `cii-warmer` is a one-shot (`restart: "no"`). A live probe on 2026-07-30, roughly four hours after session-02's successful warm, found the key **absent** (`TTL -2`) with the other two gate keys still present — `get_country_risk` was failing closed again. Re-running `docker compose run --rm cii-warmer` restored it (exit 0, `ciiScores=31`, `degraded=false`, TTL 3600 s).

**v4 resolution 2026-07-30 (ADV-28): the recurrence is now automated.** A `cii-warmer-loop` compose service (same image, same bind-mounted script, same `CII_WARM_*` isolation contract) re-warms every 45 min on success and retries in 5 min on any non-zero exit; the one-shot service stays for on-demand *verified* warms. First loop tick verified live. Two residual cautions: (1) the loop ignores per-run exit codes beyond retry pacing, so check `docker logs the-synactic-cii-warmer-loop` before trusting a long-idle stack; (2) `intelligence:advisories:v1` ALSO expires (TTL 10800) and is a `get_country_risk` gate key — a lapsed advisories seed presents as the deadlock while the CII key is healthy. Probe all three gate keys, not just the stale key.

### Trap 6 — the contract test is circular and provides false assurance

`tests/mcp-tool-output-contracts.test.mjs` — titled *"all 41 tools validate against declared outputSchema"* — **exercises zero real handler code**. For RPC tools it replaces `_execute` with a stub synthesized from the declared schema (`minimalShape(tool.outputSchema)`), then validates against that same schema (`:64-82,160-164,188`). Its own comment concedes it "proves the declared schema is internally consistent." Cache tools have every Redis read mocked to `{}` (`:103-106`).

Compounding it, the shared validator is **one-directional** (`tests/helpers/json-schema-mini.mjs:33-56`): missing non-required declared fields and undeclared extra payload fields both pass, and **no tool sets `additionalProperties:false`**. That is precisely why Trap 3's `score`-vs-`combinedScore` drift coexists with a green suite.

**No test asserts a live payload against a declared schema.** Green means nothing here.

---

## Verified facts an agent should not re-derive

- **Stack is Vite + vanilla TS + Preact.** Not Next.js.
- **This checkout exposes 70 MCP tools** — 37 cache + 21 rpc + 4 nlp + 7 analysis + 1 company-intel, from **five** registry files merged in `api/mcp/registry/index.ts` (re-derive lines; analysis + company-intel merge INTO `RPC_TOOLS` inside `rpc-tools.ts`, so index.ts imports only three names — CACHE_TOOLS, RPC_TOOLS, NLP_TOOLS). History: 41 at v2 (28+13), 46 after the session-03 cache batch (`ce3c9fcd1`), 51 after the session-04 RPC batch (Tier 1 complete, 50-tool charter goal met), 68 after the 2026-08 upstream sync, 69 at v6 (`get_defcon_level`, a cache tool, `4a33cee76`), **70 in session 09** (`get_kraken_market_data`, cache tool, boundary-1 v4 venue) — upstream open-sourced every formerly hosted-only tool (nlp/analysis/company-intel files), and the fork's 9 surviving additions ride on top. The fork's tenth, `get_population_exposure`, was RETIRED at the sync: upstream's richer analysis-tools implementation won the duplicate-name collision; its three fork-shape oracle captures were removed (recoverable at `48011d60f`) with a `pending` manifest entry demanding recapture + a Null-Island guard re-probe. Tier-1 oracle coverage otherwise carries over (`tests/fixtures/oracle/2026-07-30/`).
  > **v1 CORRECTION.** v1 claimed 59 tools across five registry files. That count was taken from the **live hosted service**, not this source tree, and was written up as a source claim in error. Both are probably true of different things: **the fork checkout is roughly 18 tools behind the hosted instance.** Anything captured from hosted may have no local implementation — check before reconciling.
  >
  > **v3 — SETTLED 2026-07-30, recon OQ1 closed.** Keyless `tools/list` against `https://worldmonitor.app/mcp` returns **59 tools**; `tools/list` against the running self-host returns **41**. The gap is **exactly 18**, and those 18 names match the carried-over list one-for-one. v1's "59" was right about hosted and wrong only as a claim about this source tree. Discovery requires no credential (their SDK docs say so; verified live), so enumerating the public manifest is ordinary discovery and does not touch the entitlement system — boundary 4 intact. Their declared schemas stay a **hint surface only** (Trap 3): use them to learn what a tool is *for*, never to generate a client and never as the source of our own `outputSchema`.
  >
  > **v5 — 2026-08-01, the hosted gap is CLOSED.** The upstream sync brought the OSS registry to full hosted parity (59) and the fork adds 9 on top (68). The 10 upstream-reconstructed-by-us names from sessions 03-04 all landed WITHOUT collision except `get_population_exposure` (see above). "Hosted has tools this checkout lacks" is no longer true; retire that reflex. Trap-3 discipline is UNCHANGED for the 17 newly-arrived upstream tools — presumed-drift until probed/captured.
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
