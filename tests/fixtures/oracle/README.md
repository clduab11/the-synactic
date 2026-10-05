# oracle/ — fresh, value-assertable fixture captures

This directory holds **fresh captures** of real tool responses, one subdirectory
per capture session: `oracle/<capture-date>/` (e.g. `oracle/2026-07-30/`).

## 1. The separation — why two fixture directories exist

| Directory | Purpose | Value assertions? |
|---|---|---|
| `tests/fixtures/jmespath-samples/` | Exercise JMESPath projection at three payload sizes (fat / medium / thin) | **No.** Values are contaminated — shape assertions only. |
| `tests/fixtures/oracle/<capture-date>/` | Fresh captures from a known instance | **Yes — this is the ONLY place value assertions are allowed.** |

The three shipped `jmespath-samples/` fixtures are contaminated as value
evidence (see `tests/fixtures/AGENTS.md` for the full findings):

- `medium-get-conflict-events.response.json` was captured 2026-05-17 from an
  upstream instance whose CII scoring was **already degraded**:
  `ciiContribution` appears 31 times and is zero in all 31 (entries include
  active-war countries with dead unrest/conflict components).
- Its `ciiScores` entries **lack the disclosure fields the current emitter
  writes** (`eventMultiplier`, `methodologyVersion`, `advisoryLevel`,
  `advisoryProvenance` — emitter at
  `server/worldmonitor/intelligence/v1/get-risk-scores.ts:1224-1230`).
- It still carries an **`iran-events` dataset from a since-sunset domain**.
- Each fixture file now opens with a `"_fixtureNotice"` sentinel recording its
  shape-only status and capture date.

**Never assert CII, conflict, unrest, or information VALUES from
`jmespath-samples/`.** A green test run against them only proves the code
reproduces a broken snapshot. Never "fix" code to make those fixtures pass —
if code and fixture disagree on a value, the fixture is the more likely liar.

Fresh captures land here in `oracle/<capture-date>/` and stay separate; they
are the only fixtures against which new value-asserting tests may be written.

## 2. Hosted-vs-checkout tool gap

This checkout exposes **41 MCP tools** (28 cache + 13 rpc, two registry files
merged at `api/mcp/registry/index.ts:5-12`). The hosted instance exposes
roughly **18 more**.

Consequence: a capture taken against the hosted endpoint may describe a tool
with **no local implementation**. Before reconciling a hosted capture against
this checkout, verify the tool exists in `api/mcp/registry/`. Do not treat a
hosted-only tool's capture as evidence of local breakage, and do not scaffold
local code to "match" a hosted capture without an explicit decision.

## 3. Capture mechanics

Use `scripts/capture-mcp-fixture.mjs` (see `:40-42`). It reads exactly three
environment variables:

- `WM_MCP_ENDPOINT` — endpoint override (hosted by default; point at this
  fork's deployment for operator-side captures).
- `WM_MCP_KEY` — sends `X-WorldMonitor-Key` (user API key).
- `WM_MCP_OAUTH_TOKEN` — sends `Authorization: Bearer` (OAuth access token
  from `/api/oauth/token`).

**`WM_MCP_BEARER` is NOT read by the script.** The string exists in
`.env.example:967` but the script never reads it — do not set it and expect
anything to happen.

Metering: against the hosted service a subscriber key is metered. Against
**this fork** — where we are the operator — the operator-owned `env_key` is
**unmetered**, so replay and diff runs are free. One script, two endpoints.

Example:

```bash
# Operator-side capture against this fork (unmetered)
export WM_MCP_ENDPOINT="https://<fork-deployment>/mcp"
export WM_MCP_KEY="<operator env_key>"
node scripts/capture-mcp-fixture.mjs --tool get_conflict_events \
  --dir oracle/2026-07-30 --name get-conflict-events
```

`--dir` is required for oracle captures: without it the script defaults to
`tests/fixtures/jmespath-samples/` (the shape-only set), and a path-shaped
`--name` would nest the capture **inside** the contaminated directory. The
script refuses `--dir`/`--name` values that resolve outside `tests/fixtures/`.

Record the capture date, target endpoint, and auth class in the capture
subdirectory so future diffing knows exactly what it is comparing.

## Schema drift after a capture

When an upstream sync adds a REQUIRED field to a tool's `outputSchema`, every
earlier capture of that tool fails the one-directional check until it is
retaken. Until then, the capture's manifest entry may carry a
`schemaDriftAllowances` list — one `{ pattern, reason }` per drifted key, where
`pattern` is a regex over the validator's error strings (for example
`^\$\.sources\[\d+\]\.sourceProvenance: required key missing$`). The test
ignores matching errors AND fails if an allowance matches nothing, so a retaken
capture forces the allowance to be deleted rather than lingering as a waiver.
