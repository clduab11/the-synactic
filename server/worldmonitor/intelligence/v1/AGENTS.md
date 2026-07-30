# AGENTS.md — server/worldmonitor/intelligence/v1/

**v2 — 2026-07-29.** Unrest provenance corrected, weights added, lines re-pinned against `docs/plans/recon-01.md`.

## The CII field names do not mean what they say

`get-risk-scores.ts:1214-1219` emits:

```js
components: {
  newsActivity:     information,
  ciiContribution:  unrest,
  geoConvergence:   conflict,
  militaryActivity: security,
}
```

Read back symmetrically at `src/services/cached-risk-scores.ts:90-95`, so nothing is broken. The **names** are back-compat fossils.

| Wire field | Semantic | Fed by |
|---|---|---|
| `ciiContribution` | unrest | **ACLED events** (`:859-887` → formula `:1077-1087`) + outage boosts (`infra:outages:v1` → `outageBoost` `:1086`) |
| `geoConvergence` | conflict | `acledScore + fatalityScore + civilianBoost + strikeBoost + orefBoost` (`:1102`) |
| `militaryActivity` | security | `:1104-1119` |
| `newsActivity` | information | `:1121-1125` |

> **v1 CORRECTION.** v1 said unrest is fed by GDELT. **Wrong** — `gdelt` and `unrest:events` appear **zero times** in this file. The GDELT-backed `unrest:events:v1` key feeds the `get_conflict_events` MCP tool's `events` label (`cache-tools.ts:265`) and dashboard panels, not the server CII path.

**ACLED therefore feeds two of the four components — unrest and conflict — carrying 0.55 of the event-score weight combined.** That is the licensing exposure, and it is larger than v1 recorded.

## `geoConvergence` is not geo-convergence

`src/services/geo-convergence.ts` is **never called in this file**. A case-insensitive grep for "convergence" here returns exactly one hit: the field name at `:1217`.

**`orefBoost` stays.** OREF was retained by decision on 2026-07-29 — it contributes `orefBoost` in the conflict term (`:1099-1101`) and `orefBlendBoost` in the blend (`:1141-1144`), IL-scoped. Do not remove it, do not compensate for it, and do not improve the underlying evasion mechanism.

## The scoring formula

```
eventScore = unrest*0.25 + conflict*0.30 + security*0.20 + information*0.25   (:1127)
blended    = baseline*0.4 + eventScore*0.6 + ten additive boosts              (:1183-1194)
ucdpFloor      = ucdpWar ? 70 : ucdpMinor ? 50 : 0                            (:1197)
advisoryFloor  = do-not-travel ? 60 : reconsider ? 50 : 0                     (:1198-1200)
composite  = min(100, max(floor, round(blended)))                             (:1202)
```

UCDP is a **floor, not a component**, derived from the cached event list over a 2-year trailing window (`:481-510`). A country sitting at exactly 70 with zeroed components is reporting the war floor, not a computed blend.

## COLD-START DEADLOCK — read before debugging an empty CII

`getCountryRisk` reads **only** `risk:scores:sebuf:stale:v8` (`get-country-risk.ts:12,44-45`). **No seeder writes that key** — repo-wide grep finds only constant mirrors, one test, and readers. It is written solely by the leader-gated path in `getRiskScores` (`get-risk-scores.ts:1545,1617-1621`).

The relay's CII warm-ping hard-codes the **hosted** origin (`scripts/ais-relay.cjs:4655`) and 401s without `WORLDMONITOR_RELAY_KEY` (`:4632-4634`), which docker-compose does not set (`:71-79`).

**A fresh self-host with every seeder green still returns `upstreamUnavailable: true` until something hits the LOCAL `/api/intelligence/v1/get-risk-scores`.** `cii` is *absent*, not `null` (`get-country-risk.ts:53-64`). Curl the local endpoint after seeding. Do not go hunting in the seeders.

## Two advisory paths, only one with a fallback

Top-level `advisoryLevel` is `byCountry[code] ?? ''` from the advisories seed with **no fallback** (`get-country-risk.ts:69-70`). `cii.advisoryLevel` is `liveLevel || fallbackLevel` against an embedded table (`get-risk-scores.ts:840-845`, table `:137-143`). An empty top-level string with a populated `cii.advisoryLevel` is this asymmetry, not a bug.

## Dead-by-default inputs

- **Iran events** — `IRAN_EVENTS_ENABLED` defaults false (`:723,734`)
- **Temporal anomalies** — gathered but never scored; producer emits `region:'global'` only (`:1171-1177`)
- **Trend prior** — flat STABLE for ~24h on a fresh deploy (`:411-420,1484-1492`)

## Separately: the geo-convergence service has a real calibration problem

`src/services/geo-convergence.ts` — `WINDOW_MS = 24h` (`:18`), `CONVERGENCE_THRESHOLD = 3` (`:19`), one-degree cells (`:21-23`), four event types (`:7`). A 2026-07-29 live probe showed all four feeds ingesting across 53 cells with **zero alerts** — three distinct domains cannot co-occur in one ~111 km cell at that volume.

That probe is a **runtime observation, `[OPEN]` from source**. It is a genuine issue for the **dashboard map's convergence alerts** and unrelated to the CII. The field name conflates them; do not let the code follow.
