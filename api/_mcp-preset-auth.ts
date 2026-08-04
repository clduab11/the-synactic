/**
 * Server-side auth registry for the Connect-MCP quick-connect presets.
 *
 * WHY THIS EXISTS. The MCP panel used to be a pure browser path: you pasted a
 * key into the modal and it lived in localStorage under `wm-mcp-panels`, then
 * rode to `api/mcp-proxy.ts` as `customHeaders` on every call. That meant a key
 * already present in `.env` was invisible to the panel — the operator had to
 * hold a second copy of the same secret in a browser store, and the modal still
 * demanded a paste for a server that was already configured.
 *
 * Because `api/mcp-proxy.ts` ALREADY performs every MCP request server-side
 * (the browser never talks to the upstream MCP server directly), the fix needs
 * no new transport: the proxy can read the key from its own environment and
 * attach it on the way out. The key therefore never enters the browser, never
 * enters the bundle, and never enters localStorage.
 *
 * TWO RULES THIS MODULE MUST NEVER BREAK:
 *   1. It exports HOSTS and BOOLEANS to callers that answer the browser —
 *      never a key value. `listConfiguredPresetHosts` is the only thing the
 *      client-facing capability probe may serve.
 *   2. A client-supplied header always WINS over the environment. Pasting a key
 *      in the modal is an explicit override, and silently preferring a stale
 *      `.env` value over what the operator just typed would be maddening.
 *
 * KEEPING THIS IN SYNC. `host` values mirror `MCP_PRESETS[].serverUrl` in
 * `src/services/mcp-store.ts`, and `template` mirrors its `apiKeyHeader`.
 * Nothing at runtime couples them, so `tests/mcp-preset-auth-parity.test.mjs`
 * asserts every preset is represented and that the header templates match.
 * A preset with no auth is listed with `headers: []` — present and deliberate,
 * rather than absent and ambiguous.
 */

export interface McpPresetHeaderSpec {
  /** "Authorization: Bearer {key}" — the same template shape the modal uses. */
  template: string;
  /** Env var names tried in order; the first non-empty one wins. */
  envVars: string[];
}

export interface McpPresetAuthEntry {
  presetName: string;
  /** Hostname of the preset's serverUrl — no scheme, no path. */
  host: string;
  /** Empty array = this preset needs no credential. */
  headers: McpPresetHeaderSpec[];
}

const BEARER = 'Authorization: Bearer {key}';

export const MCP_PRESET_AUTH: readonly McpPresetAuthEntry[] = Object.freeze([
  // ── Intelligence / search ────────────────────────────────────────────────
  {
    presetName: 'Exa Search',
    host: 'mcp.exa.ai',
    // EXA_API_KEYS (plural) is the name this repo's existing server-side Exa
    // consumer uses; EXA_API_KEY (singular) is the more obvious spelling and is
    // what the host machine sets. Accept both rather than re-litigate it.
    headers: [{ template: BEARER, envVars: ['EXA_API_KEY', 'EXA_API_KEYS'] }],
  },
  {
    presetName: 'Tavily Search',
    host: 'mcp.tavily.com',
    headers: [{ template: BEARER, envVars: ['TAVILY_API_KEY'] }],
  },
  {
    presetName: 'Perigon News',
    host: 'mcp.perigon.io',
    headers: [{ template: BEARER, envVars: ['PERIGON_API_KEY'] }],
  },
  { presetName: 'Robtex', host: 'mcp.robtex.com', headers: [] },
  { presetName: 'Pyth Price Feeds', host: 'mcp.pyth.network', headers: [] },
  {
    presetName: 'LunarCrush',
    host: 'lunarcrush.ai',
    headers: [{ template: BEARER, envVars: ['LUNARCRUSH_API_KEY'] }],
  },
  { presetName: 'Weather Forensics', host: 'weatherforensics.dev', headers: [] },
  {
    presetName: 'Alpha Vantage',
    host: 'mcp.alphavantage.co',
    headers: [{ template: BEARER, envVars: ['ALPHA_VANTAGE_API_KEY', 'ALPHAVANTAGE_API_KEY'] }],
  },
  {
    presetName: 'Data Commons',
    host: 'api.datacommons.org',
    headers: [{ template: 'x-api-key: {key}', envVars: ['DATA_COMMONS_API_KEY', 'DATACOMMONS_API_KEY'] }],
  },
  {
    presetName: 'Google Maps',
    host: 'mapstools.googleapis.com',
    headers: [{ template: 'X-Goog-Api-Key: {key}', envVars: ['GOOGLE_MAPS_API_KEY'] }],
  },

  // ── Cloudflare (ONE token drives BOTH of these presets) ──────────────────
  {
    presetName: 'Cloudflare Radar',
    host: 'radar.mcp.cloudflare.com',
    headers: [{ template: BEARER, envVars: ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN'] }],
  },
  {
    presetName: 'Browser Fetch',
    host: 'browser.mcp.cloudflare.com',
    headers: [{ template: BEARER, envVars: ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN'] }],
  },

  // ── Write-capable / account-scoped ───────────────────────────────────────
  // These expose MUTATING tools. Auto-injection here is an explicit owner
  // decision (session 12): a token in `.env` becomes callable by panels that a
  // model can drive. Prefer least-privilege tokens — a restricted read-only
  // Stripe key, a fine-grained GitHub PAT, a read-scoped Notion integration.
  {
    presetName: 'GitHub',
    host: 'api.githubcopilot.com',
    headers: [{ template: BEARER, envVars: ['GITHUB_TOKEN', 'GITHUB_PAT', 'GH_TOKEN'] }],
  },
  {
    presetName: 'Linear',
    host: 'mcp.linear.app',
    headers: [{ template: BEARER, envVars: ['LINEAR_API_KEY'] }],
  },
  {
    presetName: 'Sentry',
    host: 'mcp.sentry.dev',
    headers: [{ template: BEARER, envVars: ['SENTRY_AUTH_TOKEN'] }],
  },
  {
    presetName: 'Datadog',
    host: 'mcp.datadoghq.com',
    // The only two-header preset — which is why it has no single `apiKeyHeader`
    // in mcp-store.ts and why the modal routes it to custom-headers mode.
    headers: [
      { template: 'DD-API-KEY: {key}', envVars: ['DATADOG_API_KEY', 'DD_API_KEY'] },
      { template: 'DD-APPLICATION-KEY: {key}', envVars: ['DATADOG_APP_KEY', 'DD_APPLICATION_KEY'] },
    ],
  },
  {
    presetName: 'Stripe',
    host: 'mcp.stripe.com',
    headers: [{ template: BEARER, envVars: ['STRIPE_SECRET_KEY', 'STRIPE_API_KEY'] }],
  },
  {
    presetName: 'Notion',
    host: 'mcp.notion.com',
    headers: [{ template: BEARER, envVars: ['NOTION_API_KEY', 'NOTION_INTEGRATION_TOKEN'] }],
  },
]);

const BY_HOST = new Map(MCP_PRESET_AUTH.map((entry) => [entry.host.toLowerCase(), entry]));

/** Split "Authorization: Bearer {key}" into its header name and value. */
function applyTemplate(template: string, key: string): [string, string] | null {
  const colon = template.indexOf(':');
  if (colon === -1) return null;
  const name = template.slice(0, colon).trim();
  const value = template.slice(colon + 1).trim().replace('{key}', key);
  if (!name || !value) return null;
  return [name, value];
}

function firstSetEnv(envVars: string[], env: Record<string, string | undefined>): string | null {
  for (const name of envVars) {
    const raw = env[name];
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  }
  return null;
}

/**
 * Headers this server can supply for `hostname` from its own environment.
 * Returns `{}` when the host is unknown, keyless, or has no key configured.
 *
 * A preset is only considered configured when EVERY header it declares
 * resolves. Datadog needs two; supplying one would produce a request that
 * fails upstream with a confusing 403 rather than an honest "not configured".
 */
export function resolvePresetAuthHeaders(
  hostname: string,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const entry = BY_HOST.get(String(hostname || '').toLowerCase());
  if (!entry || entry.headers.length === 0) return {};

  const resolved: Record<string, string> = {};
  for (const spec of entry.headers) {
    const key = firstSetEnv(spec.envVars, env);
    if (!key) return {};
    const pair = applyTemplate(spec.template, key);
    if (!pair) return {};
    resolved[pair[0]] = pair[1];
  }
  return resolved;
}

/**
 * Hosts this server holds a complete credential for.
 *
 * This is the ONLY thing safe to serve to a browser: hostnames the operator
 * already configured, never the values. The Connect-MCP modal uses it to render
 * a preset as "configured via .env" instead of demanding a paste.
 */
export function listConfiguredPresetHosts(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return MCP_PRESET_AUTH
    .filter((entry) => entry.headers.length > 0 && Object.keys(resolvePresetAuthHeaders(entry.host, env)).length > 0)
    .map((entry) => entry.host);
}

/**
 * Merge server-side preset auth UNDER caller-supplied headers.
 * Caller headers win — an explicit paste is an intentional override.
 */
export function withPresetAuth(
  hostname: string,
  customHeaders: Record<string, unknown> | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const injected = resolvePresetAuthHeaders(hostname, env);
  if (Object.keys(injected).length === 0) return customHeaders || {};

  const supplied = new Set(
    Object.keys(customHeaders || {}).map((k) => k.toLowerCase()),
  );
  const merged: Record<string, unknown> = { ...(customHeaders || {}) };
  for (const [name, value] of Object.entries(injected)) {
    if (!supplied.has(name.toLowerCase())) merged[name] = value;
  }
  return merged;
}
