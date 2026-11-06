# CONTEXT.md — the-synactic fork ground truth

**This file is fork-specific. `AGENTS.md` in this directory is upstream's and is still authoritative for architecture, build, and conventions — read both.**
Kept as a separate file so upstream merges never conflict with fork knowledge.

**v12 — 2026-11-06. Upstream sync: koala73/worldmonitor `4cad4a5e4` merged (295 commits since
the 2026-10-31 `e3268a4a8` sync; 39 conflicted paths), on the same branch as the v11 sync (PR #8),
which first fast-forwarded over the nine fork fixes ported from PR #1 (`port/pr1-fork-fixes`):
the prediction-market price archiver and its activation-marker probe, the trader charter at
boundary 1 v5, the self-host `VITE_SELFHOST_PRO` image unlock, the README trader console, the
catalog domain overrides, HTML-escaped variant meta, the call-shape long-completion budget, and the
archiver's attribution entries. PR #1 is superseded by this branch.** Decisions that took judgment:

- **Version and inventories.** `package.json`, the lockfile, `tauri.conf.json` and `Cargo.toml` are
  at upstream's 2.11.8 (from 2.11.6). The MCP server card is 1.50.0 at **112 tools** (upstream 102 +
  the 10 fork tools; no name collisions). `/api/health` walks **417 probes** (upstream 414 + `defconLevel`,
  `krakenMarkets`, `predictionPriceArchive`); the four health/api-platform example bodies say so, and
  `check-health-probe-cutovers.mts origin/main` passes for every new upstream probe (the regional
  energy fleet) and the fork's archiver probe.
- **Registry ledger (`scripts/mcp-registry-published-versions.json`).** `1.47.0` keeps the fork's
  109-tool pin; upstream's `1.48.0` and `1.49.0` entries are kept verbatim although they describe
  hosted inventories the fork never built (they keep the ledger merge-friendly and the test only
  enforces the newest entry); `1.50.0` is re-pinned at 112 tools with the fork manifest fingerprint
  `6789c8e5…`. `server.json` took upstream's new description wording.
- **Generated artifacts are regenerated, not hand-merged.** Product catalog/facts, the server and
  agent cards, `llms.txt`/`llms-full.txt`, `ai-search.md`, the agent-skills index and skill
  extension, the attribution manifest and the full "Observed Source Inventory" block of
  `docs/source-attribution.mdx` (the drift PR #8 had deferred), sandbox fixtures, depth/hero/copy
  stats and the pro-test locales all come from `npm run generate` on an LF tree. The OpenAPI
  documents were hand-patched for the one proto comment that differs (`climate_disaster.proto`:
  "GDACS, NASA FIRMS, EONET. (ReliefWeb removed 2026-08-03.)" — EONET is upstream's addition, the
  ReliefWeb removal is the fork's); `make generate` still needs the Go toolchain this machine lacks.
- **Locales.** The four upstream-rewritten locale files (`fa`, `nl`, `sw`, `uk`) took upstream's
  translations, had `shell.documentTitle` pruned again (the fork keeps its static title, v10), and
  got the 86 fork keys back through `sync-locale-keys` (one genuinely translated fork value in `fa`
  and `nl` restored). `scripts/locale-baselines/app.json` is the sorted flat snapshot of the merged
  `en.json` — upstream's baseline is exactly that for its keys, so the fork keys simply join it.
- **Spliced source conflicts.** `api/health.js` activation markers carry the archiver marker beside
  upstream's regional-energy block; `rpc-tools.ts` imports both the fork's classifier/chokepoint
  symbols and upstream's `argNum`/`argStrList`; `panel-layout.ts` imports `widgetsEvictedBySaving`
  (fork) and `subscribeWidgetAccess` (upstream); `StockBacktestPanel` keeps the fork's
  `number | undefined` tone with upstream's CSS-variable colours; the ais-relay widget client composes
  the fork's `WIDGET_ANTHROPIC_BASE_URL` with upstream's `timeout`/`maxRetries: 0`; `seed-fx-yoy`
  keeps the Windows-safe `pathToFileURL` main guard over upstream's `fetchYahooJson` import;
  `variant-meta.ts`/`index.html` keep the fork title and take upstream's "169 of 196" description;
  `docker-compose.yml` keeps the fork's `EXA_API_KEYS` block and takes upstream's
  `ALPHA_VANTAGE_API_KEY` placement (the fork's alias-block copy was removed — Compose rejects the
  duplicate key); `SELF_HOSTING.md` takes upstream's rewritten rows with the fork's `the-synactic`
  container names; README and the superseded-audit banner stay the fork's.
- **Tests adapted to recorded fork rulings.** `mcp-published-endpoint-canonical` (new upstream) no
  longer requires README.md to carry the hosted MCP endpoint (same ruling as `cii-docs-drift`).
  Three LLM-policy suites that were already red before this sync now encode the free-tier default:
  the critical_signals route tag follows `openrouterModel()`, the chain-telemetry "paid" rung is the
  resolved primary, and the forecast fallback test tells the free rung apart by model identity
  rather than a `:free` suffix (the fork's primary is free too). `news-digest-methodology-parity`
  pins the fork primary ahead of upstream's new `nemotron-3.5-super-vl` third model.
- **Verified here, then on CI (the Actions budget was back for this push):** `typecheck`,
  `typecheck:api`, `lint:boundaries`, `lint`, `docs:check`, the cutover gate and a 56-suite focused
  data-test batch (1,129 tests; the 21 failures are the Windows path classes below). CI then ran for
  the first time on this PR and found three things this box could not: `proto-changes`/`proto-freshness`
  refuse to classify because GitHub's files API caps a PR at 3,000 changed files and this sync PR has
  more (a size property of the PR, not a defect); `audit-lockfile` flagged two high brace-expansion
  advisories in the fork-only `docker/runtime-package-lock.json` (the runtime image gained `sax` and
  the seeder tiers after upstream's lock); and `docs-stats` found three derived files stale on Linux
  that were "current" here. The follow-up commit fixes the latter two: the docker runtime lock now
  carries the root's brace-expansion and uuid floors (npm audit: 0), the crawlable-corpus snapshot
  path is `posix.join`ed (it is published verbatim in `llms-full.txt` and `teasers.json`), and
  `docs/source-attribution.mdx` is back to one generated block. Still failing on Windows only,
  reproduced identically on a pristine upstream checkout: `docs-stats-bootstrap-cache`,
  `docs-stats-category-explainer`, `docs-stats-plan-layer-entitlement` (double-drive `C:\C:\` paths)
  and `agent-corpus-canonical-host` (backslash paths); `crawlable-corpus` "builds a non-trivial static
  corpus" also fails here and did before the sync. The entitlement crosswalk's scanner shells to POSIX
  `grep` through `cmd.exe` on Windows and returns nothing; run through bash it reports 390 rules, 0
  unmapped, 0 drift.
- **Windows lesson for the next sync.** This repo has no `* text=auto`, so with `core.autocrlf=true`
  every non-source file materializes CRLF. Splice-style generators then misbehave in two ways: they
  write mixed-EOL files (`build-ai-search`, `build-llms-full`), and when their heading or marker regex
  no longer matches the CRLF text they APPEND a second generated block instead of replacing the first
  (`llms-full.txt` doubled to 523 KB; `docs/source-attribution.mdx` carried upstream's rows in block
  one and the fork's in block two, so every checker read the stale first block). Any `join()` of a
  repo-relative path that is published verbatim leaks backslashes. Regenerate only from a worktree
  created with `git -c core.autocrlf=false -c core.eol=lf worktree add` (or rewrite `w/crlf` AND
  `w/mixed` tracked files to LF first; `checkout-index -f` does not renormalize), then compare
  generated-marker counts against upstream before committing. Node 24.22.2 and 26.7 ship the same
  ICU 78.3 / CLDR 48, so collation was not a factor.

**v11 — 2026-10-31. Upstream sync: koala73/worldmonitor `e3268a4a8` merged (870 commits since
the 2026-10-05 `9e8b2f650` sync; 101 conflicted paths).** Key decisions and adaptations:

- **Single-source health verdict (`#9883`) adopted.** Upstream retired `seed-freshness-baseline.json`
  and the `expiring-ack` mode for new cutovers (23 pre-existing `expiring-ack` entries remain in
  `SEED_META`); all 37 new upstream probes since `9e8b2f650` carry `activation-marker`
  cutovers and pass `check-health-probe-cutovers.mts` against `origin/main`. Fork standalone probes
  (`defconLevel`, `krakenMarkets`) remain in `STANDALONE_KEYS` / `SEED_META` (total 351 probes).
- **Boundary 2 & Free-tier LLM policy preserved.** `seed-jodi-oil.mjs` composes upstream's streaming
  `stallMs`/`budgetMs` reader with the fork's `JODI_UA`, 4xx `nonRetryable` refusal handling, and
  `assertParseableCsv`. `seed-prediction-markets.mjs` keeps `HONEST_UA` across the new Kalshi
  order-book liquidity pass. Primary OpenRouter slots in `seed-forecasts.mjs`,
  `seed-forecast-resolutions.mjs` (`liveJudgeModelIds().a`), `brief-llm.mjs`, and `classify_event`
  remain on `openrouterModel()` (`nvidia/nemotron-3-ultra-550b-a55b:free`), while adopting upstream's
  removal of the retired Groq fallback.
- **MCP domain and annotation contracts (`1.47.0`, 109 tools).** The 10 fork MCP tools are registered
  in `api/mcp/domains.ts`, carry human-readable `title` annotations, and obey the tool-description
  policy (no cross-tool references, ≤1024 B per tool, 76 KiB total budget across 109 tools).
  Cloudflare Radar preset uses `https://radar.mcp.cloudflare.com/mcp`.
- **CII v14 & TypeScript 7 (`#9489`, `#9506`).** `get-risk-scores.ts` passes `acled.rows` to
  `assessCiiInputAvailability` while preserving `degraded: acled.unavailable`; `intel-history-client.ts`
  preserves the local Chroma `useLocalBackend()` branch under the paginated `nextCursor` signature;
  `McpConnectModal.ts` wraps `premiumFetch` in `Promise.resolve().then(...)` so mock/test callers
  never throw before `.catch()`.
- **Same-day review correction.** The merge had dropped the fork's `companyMonitoringWorker`
  activation-marker cutover from `SEED_META` and edited its test to match; restored, and
  `check-health-probe-cutovers.mts origin/main` still passes. The `shell-quote` override floor had
  come back as upstream's `^1.8.4`; raised to `^1.12.0` (the lockfile already resolved 1.12.0) so
  the advisory-affected range stays excluded. CI did not run on this PR (Actions budget exhausted);
  `typecheck:all` and `lint` pass locally, `generate:check` and `docs:check` do not — see the PR.

**v10 — 2026-10-05. Upstream sync: koala73/worldmonitor `9e8b2f65` merged (2,850 commits since
the 2026-08-05 sync; 175 conflicted paths).** Every fork boundary below survived the merge; the
decisions that took judgment are recorded here so the next sync does not re-litigate them:

- **Boundary 2 posture kept where upstream re-added retry-through-refusal.** Upstream rebuilt its
  Open-Meteo Decodo proxy cascade around a soft deadline; the fork keeps the honest-UA, no-proxy
  helper (`scripts/_open-meteo-archive.mjs`) and ported only the deadline seam
  (`deadlineAtMs` / `OPEN_METEO_DEADLINE_CODE`) so `seed-climate-zone-normals` still budgets its
  fetch phase. Same call in `seed-jodi-oil`: upstream's `fetchYearCsv` advanced through every
  error; the fork's "advance on 404 or non-CSV, stop on a refusal" rule is ported into it. JODI,
  Yahoo (`YAHOO_UA`), HDX and the prediction venues stay on declared bot UAs.
- **Free-tier LLM policy kept.** Upstream pinned paid models at several new call sites
  (`deepseek-v4-flash`, `gemini-3.5-flash-lite`, `deepseek-v4.1-flash` for relay classification).
  Primary OpenRouter slots stay on `openrouterModel()` / `OPENROUTER_MODEL`; upstream's new
  `openrouter-free` / `openrouter-free-backup` / Groq fallback entries are kept behind them. The
  brief's `BRIEF_LLM_SKIP_PROVIDERS` override replaces upstream's hard `allowedProviders` pin.
- **Fork tools migrated to upstream's registry contract.** `_seedMetaKey`/`_maxStaleMin` became
  `_freshnessChecks`; `classify_event_keyword` declares `_apiPaths: []`; registry downstream
  calls go through `fetchMcpDownstream(url, init, execution)`; the 10 fork tools
  (`get_defcon_level`, `get_kraken_market_data`, `get_security_advisories`,
  `get_sovereign_stress_screen`, `get_rates_fx_credit_pressure`, `get_financial_conditions_regime`,
  `get_stablecoin_stress`, `get_chokepoint_history`, `get_regional_snapshot`,
  `classify_event_keyword`) sit beside upstream's new ones. The fork's `get_gold_intelligence`
  was dropped in favour of upstream's tool of the same name (same identity, richer schema).
  `get_chokepoint_history` now rejects an unknown id with `RpcValidationError` instead of a
  result-level `error` key, so its outputSchema stays a strict subset of the wire shape. Tool
  counts quoted in older entries below (69/70) are superseded by the registry-derived product
  facts; the MCP registry ledger pins `1.30.0` at 99 tools.
- **Widget catalog excludes the two licence-bearing fork keys.** `defconLevel` and
  `krakenMarkets` are listed in `EXCLUDED_BOOTSTRAP_KEYS` (`scripts/_widget-data-policy.cjs`)
  because the embeddable widget path attaches no attribution / usage-restriction rider; both
  stay reachable only through their MCP tools, where the rider travels in-band.
- **MCP auth adopted upstream's posture.** `api/mcp/auth.ts` is now identical to upstream
  (HMAC `buildAuthHeaders` for `user_key`); the fork's raw-forward and
  `addLocalSidecarTransportToken` paths are gone. Self-host still unlocks client-side via
  `VITE_SELFHOST_PRO` (boundary 4), unchanged.
- **Brief grounding relaxation narrowed.** Upstream's tokenizer now ends a proper-noun sequence
  at a plain "and" and retains it only inside a registered expansion or a repeated-name entity
  ("Johnson and Johnson"). The fork's coordinator-split relaxation therefore only ever fired on
  the names that retention exists to protect, so it was removed; the verbatim-run,
  reordered-window and headline-side hyphen relaxations stay (`shared/brief-llm-core.js` and
  its `scripts/shared/` mirror, pinned by `tests/brief-llm-core-mirror-parity.test.mjs`).
- **Taken from upstream, replacing fork work it subsumed:** the `#5947` brief-synthesis
  rewrite (`composeSynthesizedBriefResult` + `BRIEF_REJECTIONS`) replaces the fork's
  `splitLeadSentences` gate and its tests; the country-risk MCP app and `get_country_risk`
  schema now describe `cii.components` as upstream does; `_open-meteo` aside, upstream's
  HAPI snapshot-primary ordering (`#7658`) stands, with the fork's 444/scraping bot-block tests
  re-appended.
- **Sources retired in the attribution manifest** because nothing references them any more:
  `api.reliefweb.int`, `reliefweb.int` (owner removal, v5), `open-meteo.caseyjhand.com` and
  `radar.mcp.cloudflare.com` (preset curation), `web.archive.org`. Fork hosts gained the
  origin-country (`scripts/source-origin.mjs`) and catalog-domain
  (`scripts/crawlable-sources-page.mjs`) entries upstream's build guards now require.
- **Upstream's acquisition-copy lint** (`docs-stats --check`) forbids hard inventory counts in
  hand-authored copy; the README's flagged lines were reworded, not exempted. Upstream now builds
  `public/pro/` at deploy time (no longer committed) and generates the MCP server card.
- New upstream locales (`sw`, `zh-TW`) carry the fork keys via `sync:locales` / `locales:zh-tw`
  (the latter needs `pip install opencc-python-reimplemented`).
- **Preset curation kept, one endpoint followed upstream.** `src/services/mcp-store.ts` still
  ships the fork list (NOAA Weather Records instead of the Open-Meteo community server; PostHog;
  no Slack / Sentry / Datadog / Notion / Airtable / PostgreSQL). Cloudflare Radar moved to
  upstream's current `https://radar.mcp.cloudflare.com/sse` endpoint. `tests/mcp-presets.test.mjs`
  pins that list. Climate news stays at seven feeds (ReliefWeb removed, v5); the dangling
  `mapReliefItem` export that crashed `seed-climate-disasters` on import is gone.
- **Forecast chain resolves the primary model per call.** `resolveForecastLlmProviders` reads
  `openrouterModel()` at call time (not module load), so an `OPENROUTER_MODEL` set after import —
  by an operator or a test — is the model actually sent, and the Flash fail-fast/timeout policy
  keys off it. Tests that exercise Flash-specific budgets pin Flash explicitly; tests that pinned
  upstream's paid defaults (`classify-event-model-override`, `seeder-llm-telemetry`,
  `regional-snapshot-weekly-brief`, `news-digest-methodology-parity`) now expect the fork default.
- **Bootstrap byte ledger carries fork estimates apart from the capture.** The frozen
  2026-08-21 ledger in `scripts/_bootstrap-payload-budget.mjs` must reconstruct the captured
  bodies byte-for-byte, so `defconLevel` / `krakenMarkets` live in a separate
  `FORK_ESTIMATED_KEY_DECODED_BYTES` table (measured from representative payloads built to each
  seeder's shape) that `ledgerBytesForKey()` consults; re-measure from a live `tier=slow`
  capture when one is taken. `api/download.js` accepts `trader`; `index.html` writes
  the raw `&` in the title/meta so the VARIANT_META build replacement is a no-op; `shell.documentTitle`
  stays absent from `en.json` (the fork keeps its static index.html title), so the key upstream's
  new `sw` locale carried was dropped rather than resurrected.
- **`docs/mcp-tools-reference.mdx` is upstream's page plus the ten fork sections** (kraken after
  `get_market_data`, DEFCON after `get_military_posture`, the seven finance/chokepoint/regional
  tools at the head of Meta, `classify_event_keyword` before `describe_tool`). An earlier splice
  had truncated it to one screen; `tests/mcp-tools-reference-docs.test.mjs` and `docs:check`
  guard it now. `tests/cii-docs-drift.test.mts` no longer lists README.md as a canonical-page
  surface — the fork README does not market the hosted worldmonitor.app pages.
- **Known environment-only test failures** (reproduced identically on a pristine upstream
  checkout, so not fork regressions): `natural-events-request-diagnostics`,
  `natural-events-transport`, `market-physical-freshness`, `widget-agent-relay-failure`,
  `dashboard-build-guards`, `map-viewport-runtime`, `social-velocity-boundary` (its Docker
  sandbox copy of `shared/bootstrap-tier-keys.js` lacks the named export);
  `dry-run-resilience-education-flip` hashes the harness at HEAD and only passes on a committed
  tree; `pretest:data` (`docs:dates`) needs full git history, so run
  `node scripts/run-data-tests.mjs tests/*.test.mjs tests/*.test.mts cli/test/*.test.mjs
  api/security/report.test.mjs` directly on a shallow clone.

**v2 — 2026-07-29.** Corrected after `docs/plans/recon-01.md`, which refuted three v1 claims from source. Every correction is marked. Line numbers re-pinned to this checkout.

**v3 — 2026-07-30.** Charter change by the owner: the-synactic is now an MCP-accessible **read-only intelligence provider** for downstream authorized actors, not report-only. AGPL §13 escalation language removed (owner decision, legal cleared). The instrument stays read-only in its own code; execution lives downstream. README lineage credit and the LICENSE file are unchanged (attribution, not charter).

**v4 — 2026-08-03.** Owner amendment to boundary 1: **Kraken is authorized** (Kraken only), with a binding do-not-abuse-the-quota condition. See boundary 1.

**v5 — 2026-08-03.** Owner amendment to boundary 4: **local self-host / desktop entitlement is authorized**, gated on the build-time `VITE_SELFHOST_PRO` flag and strictly client-side. Hosted server-side auth is untouched and still governs anything calling `api.worldmonitor.app`. See boundary 4.

Also landed 2026-08-03 and reflected below: the brand rename to **the-synactic** for user-visible identity, **ReliefWeb removed** as a data source, and a **DEFCON OSINT indicator**.

**v9 — 2026-08-03.** Owner amendment to boundary 2: **a block is a prompt to RE-SOURCE, not a dead
end.** When an upstream refuses us, actively search for a sanctioned alternative route — a
different endpoint at the same provider, a different provider with equivalent data and better
terms, a mirror, or a one-email permission request — and report BLOCKED only after that search
comes back empty, naming what was tried. The prohibition on defeating a control by impersonation
or identity-cycling is unchanged. See boundary 2.

**v8 — 2026-08-03.** Owner amendment to boundary 3: **ACLED's AI/LLM restriction is scoped to
TRAINING, not inference** — confirmed by Chris with ACLED's CIO office, which supersedes a
session-09 read of the public documents. **ACLED is cleared for use here.** Two non-AI clauses
(§10 competitive use, §13 confidentiality) are recorded as separate open questions, and the cheap
answer to both is to serve the derived CII score rather than raw event rows. See boundary 3.

**v7 — 2026-08-03.** Owner amendment to boundary 1: **Trader mode is approved** (dashboard +
MCP only; execution stays downstream), and **the MCP consumer set is the owner himself** —
which reframes every clause whose operative restriction is *third-party* redistribution.
Pyth is reclassified from boundary-blocked to a cost decision; OANDA stays out on a clause that
reaches the licensee's own estate. See boundary 1.

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

   **v7 AMENDMENT 2026-08-03 (owner) — TRADER MODE IS APPROVED, AND THE CONSUMER SET IS
   CLARIFIED. Both parts matter; the second one corrects an analytical error of mine.**

   **Trader mode is authorized as a dashboard + MCP surface.** It is NOT an exception to
   boundary 1 — it is precisely the topology boundary 1 describes. The-synactic renders panels
   for the owner's own visibility and serves intelligence over MCP; **downstream repos (e.g.
   `oanda-autobot`) hold their own venue accounts, their own licences, and their own trading
   authorization, and THOSE repos execute.** No order-placement, transfer, or execution code
   enters this repo — that line is unchanged and non-negotiable. Do not add one "for testing".

   **The consumer set is the owner, and that is load-bearing for licensing.** Several clauses
   surveyed in `docs/plans/venue-licensing-01.md` are scoped to redistribution to **third
   parties**. There are none here: the MCP surface serves the owner's own systems, and he
   decides what any downstream repo of his consumes. A session-09 analysis flattened Douro
   Labs DaaS §2.1(b) ("no such display provides any **third party** with access to the Data in
   the form of a data feed … or other systematic or machine-readable delivery") into a blanket
   "MCP re-serving is prohibited". **That was wrong.** Owner-to-own-systems delivery is
   §2.1(a) "internal business purposes". Apply this reading to any clause whose operative
   restriction is third-party redistribution.

   **Consequences, stated precisely so they are not over-applied:**
   - **Pyth is no longer boundary-blocked — it is a COST decision.** FX / equities /
     commodities live in the Pro tier (from $2,500/mo); Starter ($500/mo) is crypto-only. The
     public Hermes endpoint goes key-mandatory **2026-08-18**. Wire it if and when the owner
     decides the tier is worth paying for.
   - **Residual Pyth item, and it is NOT cured by the consumer-set clarification:** DaaS
     restriction (i) bars using the Data to "develop, train, or improve" an ML model without
     written consent. That constrains the customer's OWN use, not just third parties. It is
     very likely inference-safe — the same training-vs-inference distinction Kalshi's counsel
     confirmed for their clause, and Pyth ships its own MCP server for agent consumption — but
     it is a separate question from §2.1(b) and should be answered on its own terms if Pyth is
     ever wired. Channel: `ops@dourolabs.xyz`.
   - **OANDA stays out, and for a reason the consumer-set clarification does NOT dissolve.**
     OANDA §15.0(a) bars re-transmission *"including retransmission to other premises of the
     Licensee"* — it reaches the licensee's own estate, so "it is all one operator" is not an
     answer to it. This costs nothing: `oanda-autobot` holds the OANDA account and fetches its
     own feed directly, which is lower-latency and fresher than anything this instrument could
     relay. Binance and Coinbase likewise stay unwired; Kraken remains the one authorized venue.
   - The **DEFCON no-training condition** (v6) is unaffected — it is a publisher term carried
     in-band, not a third-party-redistribution question. Keep `usageRestrictions` intact.

   **Design consequence for Trader mode:** build the OSINT baseline a price feed cannot
   reconstruct, plus the non-venue and authorized-venue market context already wired — Kraken,
   CoinGecko/CoinPaprika, Yahoo, Polymarket, Kalshi. Keep `source`, `fetched_at` and freshness
   state on every record so the downstream repo can reason about staleness before it trades.

   **Design consequence:** do not build cross-venue spread, funding-stress, or depth-decay tools here. Those need venue data. Build the OSINT surface a machine consumer cannot reconstruct — and keep `source`, `fetched_at` and freshness state on every record so the consumer can reason about staleness.

2. **Retention decided 2026-07-29: OREF, the Telegram MTProto layer, and OpenSky / `PROXY_URL` STAY.** The keep/disable question is closed — they are not to be removed, and refactors must not break them.

   **v3 change (owner, 2026-07-30): collection-path resilience is IN SCOPE.** Diagnosing our own TLS/JA3 fingerprint, sequestering collection clients by fingerprint, proxy rotation, exit-IP diversity, and comparable narrow, orthogonal measures are ordinary collection infrastructure and may be researched, built, and hardened. Earlier drafts of this file forbade them; that restriction is lifted by owner decision.

   **The one line that stays:** measures whose only purpose is to defeat a third party's control in order to take more than that party permits — impersonating a browser to get around an anti-bot product that has deliberately blocked us, or cycling identities to evade a published per-IP quota — remain out. Respect published rate limits and back off. Path diversity for reliability is fine; laundering identity to exceed a quota is not.

   **v9 AMENDMENT 2026-08-03 (owner) — A BLOCK IS A PROMPT TO RE-SOURCE, NOT A DEAD END.**

   Session 09 closed ~30 health checks as "blocked" and stopped there. That was too passive.
   When an upstream refuses us — a 403, a 429, a "not available for scraping" notice, a dead
   endpoint — the required next step is to **actively re-explore contextually relevant resources
   for a route around the obstacle**, and only report BLOCKED once that search comes back empty.

   **What "a route around" means here — all of these are in scope and expected:**
   - A different, sanctioned access path at the SAME provider: an official API instead of the
     HTML page, a bulk/archive download instead of the live endpoint, an RSS or S3 mirror, a
     documented data dump.
   - A different PROVIDER carrying equivalent data, weighed on licence terms as well as
     coverage. This is exactly how ACLED was resolved — blocked, so GDELT (a materially more
     permissive licence) plus UCDP VPP and CCC replaced it, and the result was *better*.
   - An aggregator, mirror, or government/academic redistribution of the same source.
   - A free tier, an account, or a one-email permission request. The Kraken and defconlevel.com
     unblocks both came from simply asking through a named channel. **Ask before concluding.**
   - Reconstructing the signal from primary sources we already hold.

   **What it does NOT mean, and this line is unchanged:** using a technical measure whose purpose
   is to make a party who has deliberately refused us believe we are someone else. Do not
   impersonate a browser to defeat an anti-bot product, do not rotate IPs or identities to evade
   a published per-IP quota, and do not retry through a 429 rather than backing off. If the only
   way "around" is to look like a different requester than we are, that is not a route around —
   it is the thing this boundary forbids, and it also converts a fixable licensing conversation
   into an unfixable one.

   **Record the search, not just the verdict.** A BLOCKED entry should name the alternatives
   considered and why each failed, so the next session does not silently re-derive it. A bare
   "blocked" is now an incomplete finding.

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

   > **v8 AMENDMENT 2026-08-03 (owner) — THE ACLED AI/LLM RESTRICTION IS SCOPED TO TRAINING, NOT
   > INFERENCE. ACLED IS CLEARED FOR USE HERE.**
   >
   > Chris raised this directly with **ACLED (CIO's office)** and was told the AI/ML/LLM
   > restriction concerns **training**, not inference. That is the publisher's own construction of
   > their own instrument, and it outranks a document read — the same rule that settled the Kalshi
   > clause under this boundary. **Serving ACLED-derived data into an LLM's context for reasoning
   > is not the prohibited activity.** Treat ACLED as an authorized source: `ACLED_MODE=live` is
   > legitimate once credentials exist, and the fixture default is now an operational safety, not
   > a licensing gate.
   >
   > **Do not re-raise the inference question.** A session-09 audit of the public documents read
   > §7.2 ("any LLM … that incorporates or **references** ACLED Content") as reaching inference and
   > concluded the Kalshi precedent did not transfer. The owner's channel supersedes that reading.
   > The lesson is the one this repo already learned once: **a broad-reading clause is a question
   > to ask the provider, not a verdict to hand the owner.**
   >
   > **Two NON-AI clauses remain open, and they are separate questions the above does not answer.**
   > Recorded, not blocking — flagged once so they are not discovered late:
   > - **§10 Competitive Use** bars developing datasets/APIs/tools "similar in content, structure,
   >   or function" to ACLED's own products (they ship a Conflict Index and an API). It has no
   >   external-distribution qualifier, so unlike the Pyth §2.1(b) case the v7 consumer-set
   >   clarification does **not** dissolve it.
   > - **§13** makes Licensed Content "Confidential Information", internal-use-only. Relevant to
   >   whether **raw ACLED event records** may transit a third-party LLM API; a **derived score**
   >   (the CII) is transformative under §3.1 and does not raise it.
   >
   > **Design consequence, and it is cheap:** prefer serving the **derived CII score** over raw
   > ACLED event rows on the MCP surface. That is the shape §3.1 explicitly permits, it is what
   > downstream consumers actually need, and it sidesteps both clauses above without costing
   > capability. If raw-event exposure is ever wanted, ask the same channel
   > (`licensing@acleddata.com`) — the questions are drafted in the audit doc.
   >
   > **Practical access note (unchanged by the above):** ACLED assigns tier by **email domain** —
   > a generic address lands on Open, which has **no API**. Getting a working credential is an
   > access question, not a licensing one. Full document quotes, alternatives, and the drafted
   > questions: `docs/plans/acled-licence-audit-01.md` (gitignored).
   >
   > **GDELT stays wired regardless** — it is the most permissive licence in the audit
   > ("unlimited and unrestricted use for any … commercial … use of any kind without fee", no AI
   > clause) and codes protest/riot as CAMEO root 14. Its current 429 is an ENGINEERING problem.

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
