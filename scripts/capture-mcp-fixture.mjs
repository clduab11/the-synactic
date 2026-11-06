#!/usr/bin/env node
/**
 * Capture a real MCP tool response for the JMESPath fixture set (U6).
 *
 * Hits the production MCP HTTP endpoint with supplied MCP credentials and writes
 * the response envelope (`{cached_at, stale, data}` for cache tools, or
 * the raw RPC return for `_execute` tools) to disk under
 * `tests/fixtures/jmespath-samples/`. Pass `summary: true` or any other
 * filter arg via `--arg key=value` to capture a narrowed response.
 *
 * Usage:
 *   WM_MCP_KEY="wm_0123456789abcdef0123456789abcdef01234567" \
 *     node scripts/capture-mcp-fixture.mjs \
 *     --tool get_market_data \
 *     --name fat-get-market-data
 *
 *   # Or use an OAuth access token from /api/oauth/token:
 *   WM_MCP_OAUTH_TOKEN="eyJhbGciOi..." node scripts/capture-mcp-fixture.mjs \
 *     --tool get_market_data \
 *     --name fat-get-market-data
 *
 *   # With filter args:
 *   node scripts/capture-mcp-fixture.mjs --tool get_conflict_events \
 *     --name medium-get-conflict-events --arg limit=30
 *
 *   # Oracle capture (value-assertable, per tests/fixtures/oracle/README.md):
 *   node scripts/capture-mcp-fixture.mjs --tool get_country_risk \
 *     --dir oracle/2026-07-30 --name get-country-risk-ua --arg country_code=UA
 *
 * Authentication:
 *   - WM_MCP_KEY sends X-WorldMonitor-Key: <key>
 *   - WM_MCP_OAUTH_TOKEN sends Authorization: Bearer <token>
 *
 * Endpoint defaults to https://worldmonitor.app/mcp; override with
 * WM_MCP_ENDPOINT for staging.
 *
 * Output directory: --dir <path relative to tests/fixtures/> selects the
 * fixture family; default is jmespath-samples (the shape-only projection
 * set). Oracle captures MUST use --dir oracle/<capture-date> so they never
 * land inside the contaminated jmespath-samples/ tree.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FIXTURES_ROOT = resolve(ROOT, 'tests/fixtures');
const ENDPOINT = process.env.WM_MCP_ENDPOINT ?? 'https://worldmonitor.app/mcp';
const API_KEY = process.env.WM_MCP_KEY;
const OAUTH_TOKEN = process.env.WM_MCP_OAUTH_TOKEN;

function parseArgs(argv) {
  const out = { args: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tool') out.tool = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--dir') out.dir = argv[++i];
    else if (a === '--arg') {
      const [k, ...rest] = argv[++i].split('=');
      const v = rest.join('=');
      // Coerce numeric / boolean strings to their JS equivalents so the
      // tool receives the right type (matches MCP JSON-RPC semantics).
      let parsed = v;
      if (v === 'true') parsed = true;
      else if (v === 'false') parsed = false;
      else if (/^-?\d+(\.\d+)?$/.test(v)) parsed = Number(v);
      out.args[k] = parsed;
    }
  }
  return out;
}

function fail(msg) { process.stderr.write(`ERROR: ${msg}\n`); process.exit(1); }

const { tool, name, dir, args } = parseArgs(process.argv);
if (!tool) fail('--tool required (e.g. get_market_data)');
if (!name) fail('--name required (e.g. fat-get-market-data)');
// Resolve the fixture family under tests/fixtures/ and refuse traversal out
// of it — --dir/--name are operator input but a typo must not scatter
// captures across the repo.
const FIXTURES_DIR = resolve(FIXTURES_ROOT, dir ?? 'jmespath-samples');
if (FIXTURES_DIR !== FIXTURES_ROOT && !FIXTURES_DIR.startsWith(FIXTURES_ROOT + sep)) {
  fail(`--dir must stay under tests/fixtures/ (got ${FIXTURES_DIR})`);
}
if (API_KEY && OAUTH_TOKEN) fail('Set only one of WM_MCP_KEY or WM_MCP_OAUTH_TOKEN');
if (!API_KEY && !OAUTH_TOKEN) fail('WM_MCP_KEY or WM_MCP_OAUTH_TOKEN env var required');

const headers = { 'Content-Type': 'application/json' };
if (OAUTH_TOKEN) headers['Authorization'] = `Bearer ${OAUTH_TOKEN}`;
else headers['X-WorldMonitor-Key'] = API_KEY;

const body = JSON.stringify({
  jsonrpc: '2.0', id: 1,
  method: 'tools/call',
  params: { name: tool, arguments: args },
});

process.stdout.write(`POST ${ENDPOINT}  tool=${tool}  args=${JSON.stringify(args)}\n`);

const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(30_000), method: 'POST', headers, body });
if (!res.ok) fail(`HTTP ${res.status} ${res.statusText}: ${await res.text()}`);

const rpc = await res.json();
if (rpc.error) fail(`JSON-RPC error: ${JSON.stringify(rpc.error)}`);
if (!rpc.result?.content?.[0]?.text) fail(`Unexpected response shape: ${JSON.stringify(rpc).slice(0, 200)}`);

// The MCP `content[0].text` is itself a JSON string of the tool envelope.
// Parse it back so the fixture is a structured JSON document (not a
// double-escaped string).
let envelope;
try {
  envelope = JSON.parse(rpc.result.content[0].text);
} catch (e) {
  fail(`content[0].text was not valid JSON: ${e.message}`);
}

mkdirSync(FIXTURES_DIR, { recursive: true });
const target = resolve(FIXTURES_DIR, `${name}.response.json`);
if (!target.startsWith(FIXTURES_DIR + sep)) {
  fail(`--name must resolve inside the fixture directory (got ${target})`);
}
writeFileSync(target, JSON.stringify(envelope, null, 2) + '\n');
// Report UTF-8 byte count — matches the runtime gate's contract
// (api/mcp.ts:utf8ByteLength) so the number a captured fixture reports
// here is comparable to what the projection cap measures.
const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
process.stdout.write(`wrote ${target} (${bytes} UTF-8 bytes of compact JSON)\n`);
