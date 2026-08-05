/**
 * Parity + safety guard for the Connect-MCP server-side auth registry.
 *
 * `api/_mcp-preset-auth.ts` mirrors `src/services/mcp-store.ts`: one entry per
 * quick-connect preset, keyed by the preset's serverUrl hostname, with header
 * templates that must match the preset's `apiKeyHeader`. Nothing couples them
 * at runtime, so a new preset added to the store would silently never resolve
 * its `.env` key — the panel would keep demanding a paste for a server that is
 * already configured, with no error anywhere. This suite is what makes that
 * drift fail loudly.
 *
 * It also pins the two rules the feature rests on:
 *   - the capability surface exposes HOSTNAMES ONLY, never key values;
 *   - a caller-supplied header always beats the environment.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Parse MCP_PRESETS out of the store without importing the browser module. */
function readPresets() {
  const src = readFileSync(resolve(ROOT, 'src/services/mcp-store.ts'), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('export const MCP_PRESETS');
  const end = src.indexOf('\n];', start);
  assert.ok(start !== -1 && end !== -1, 'MCP_PRESETS block not found in mcp-store.ts');
  return src.slice(start, end).split(/\n {2}\{\n/).slice(1).map((chunk) => {
    const name = chunk.match(/name: '([^']+)'/)?.[1] ?? '';
    const serverUrl = chunk.match(/serverUrl: '([^']*)'/)?.[1] ?? '';
    const apiKeyHeader = chunk.match(/apiKeyHeader: '([^']*)'/)?.[1] ?? '';
    let host = '';
    try { host = new URL(serverUrl).hostname.toLowerCase(); } catch { /* not a URL */ }
    return { name, serverUrl, apiKeyHeader, host };
  });
}

/** Parse the registry's entries without needing a TS loader. */
function readRegistry() {
  const src = readFileSync(resolve(ROOT, 'api/_mcp-preset-auth.ts'), 'utf8').replace(/\r\n/g, '\n');
  const entries = [];
  const re = /presetName: '([^']+)',\s*\n\s*host: '([^']+)',\s*\n\s*(?:\/\/[^\n]*\n\s*)*headers: (\[\]|\[)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    entries.push({ presetName: m[1], host: m[2].toLowerCase(), keyless: m[3] === '[]' });
  }
  // Single-line form: `{ presetName: 'X', host: 'y', headers: [] },`
  const inline = /\{ presetName: '([^']+)', host: '([^']+)', headers: \[\] \}/g;
  while ((m = inline.exec(src)) !== null) {
    if (!entries.some((e) => e.host === m[2].toLowerCase())) {
      entries.push({ presetName: m[1], host: m[2].toLowerCase(), keyless: true });
    }
  }
  return { src, entries };
}

describe('MCP preset auth registry parity', () => {
  const presets = readPresets();
  const { src: registrySrc, entries } = readRegistry();

  it('parses a plausible number of presets and registry entries', () => {
    // Guards the parsers themselves: a regex that silently matches nothing
    // would make every assertion below vacuously true.
    // The bound is deliberately loose because the preset list is CURATED and
    // shrinks — PostgreSQL, Slack and Airtable were dropped in session 12. What
    // must hold is that both sides parsed real data AND agree on size.
    assert.ok(presets.length >= 10, `expected >=10 presets, parsed ${presets.length}`);
    assert.ok(entries.length >= 10, `expected >=10 registry entries, parsed ${entries.length}`);
    assert.equal(entries.length, presets.length,
      'registry and preset list must hold exactly one entry each');
  });

  it('every preset host has a registry entry', () => {
    const known = new Set(entries.map((e) => e.host));
    const missing = presets.filter((p) => p.host && !known.has(p.host));
    assert.deepEqual(
      missing.map((p) => `${p.name} (${p.host})`),
      [],
      'presets missing from api/_mcp-preset-auth.ts — their .env key would never resolve',
    );
  });

  it('every registry entry corresponds to a real preset', () => {
    const known = new Set(presets.map((p) => p.host).filter(Boolean));
    const orphans = entries.filter((e) => !known.has(e.host));
    assert.deepEqual(orphans.map((e) => e.presetName), [], 'registry entries with no matching preset');
  });

  it('a preset with an apiKeyHeader is NOT registered as keyless', () => {
    const keylessHosts = new Set(entries.filter((e) => e.keyless).map((e) => e.host));
    const wrong = presets.filter((p) => p.apiKeyHeader && keylessHosts.has(p.host));
    assert.deepEqual(
      wrong.map((p) => p.name),
      [],
      'these presets take a key but the registry says they need none',
    );
  });

  it('carries the preset header template verbatim where one exists', () => {
    for (const p of presets) {
      if (!p.apiKeyHeader) continue;
      assert.ok(
        registrySrc.includes(`'${p.apiKeyHeader}'`) || p.apiKeyHeader === 'Authorization: Bearer {key}',
        `header template for ${p.name} (${p.apiKeyHeader}) not present in the registry`,
      );
    }
  });

  it('still supports MULTI-header presets even with none currently configured', () => {
    // Datadog was the only two-header preset and was replaced by PostHog
    // (single Bearer) in session 12. That left the multi-header code path with
    // no live exercise, so pin the CAPABILITY at the source instead: the
    // resolver must iterate every declared header and refuse to return a
    // partial set. Half a credential produces a confusing upstream 403 rather
    // than an honest "not configured".
    const registryImpl = readFileSync(resolve(ROOT, 'api/_mcp-preset-auth.ts'), 'utf8');
    assert.match(registryImpl, /for \(const spec of entry\.headers\)/,
      'resolver must loop over ALL declared headers');
    assert.match(registryImpl, /if \(!key\) return \{\};/,
      'a preset with any unresolved header must resolve to nothing at all');
  });

  it('the one Cloudflare token serves both Cloudflare presets', () => {
    const cf = registrySrc.match(/CLOUDFLARE_API_TOKEN/g) ?? [];
    assert.ok(cf.length >= 2, 'radar + browser presets should both accept CLOUDFLARE_API_TOKEN');
  });

  it('accepts BOTH Exa spellings — the plural name is the one already in .env', () => {
    assert.match(registrySrc, /'EXA_API_KEY', 'EXA_API_KEYS'/);
  });

  it('the capability surface returns hostnames, never key values', () => {
    // listConfiguredPresetHosts maps to `entry.host`. If it ever mapped to a
    // resolved header value it would leak secrets to the browser.
    assert.match(registrySrc, /listConfiguredPresetHosts[\s\S]*\.map\(\(entry\) => entry\.host\)/);
  });

  it('caller-supplied headers win over the environment', () => {
    assert.match(registrySrc, /if \(!supplied\.has\(name\.toLowerCase\(\)\)\) merged\[name\] = value;/);
  });
});

describe('MCP preset auth reaches the container', () => {
  // THE BUG THIS EXISTS FOR (session 12, hit live): the registry accepts several
  // spellings per preset, but docker-compose forwards only the names it LISTS.
  // Rename a key in .env to another accepted alias and the container receives an
  // EMPTY value — while the registry and .env each look correct in isolation and
  // nothing reports a mismatch. Registry alias tolerance is worthless without
  // matching compose coverage, so assert the two actually meet.
  it('compose forwards EVERY accepted alias for every key-taking preset', () => {
    const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8').replace(/\r\n/g, '\n');
    // Scope to the app service — it is the one api/mcp-proxy.ts runs in.
    const start = compose.indexOf('\n  the-synactic:');
    const end = compose.indexOf('\n  cii-warmer:', start);
    assert.ok(start !== -1 && end !== -1, 'could not locate the the-synactic service block');
    const appBlock = compose.slice(start, end);

    const registry = readFileSync(resolve(ROOT, 'api/_mcp-preset-auth.ts'), 'utf8').replace(/\r\n/g, '\n');
    const blocks = registry.split(/presetName: '/).slice(1);
    assert.ok(blocks.length >= 10, `parsed only ${blocks.length} registry blocks — parser likely broke`);

    const uncovered = [];
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf("'"));
      const envVars = [...block.slice(0, block.indexOf('},')).matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
      if (envVars.length === 0) continue; // keyless preset
      // EVERY alias, not just one. Requiring one leaves the exact bug this
      // was written for: a key renamed in .env to another ACCEPTED spelling
      // that compose does not forward arrives as an empty string, with both
      // files looking correct in isolation.
      for (const v of envVars) {
        if (!appBlock.includes(`      ${v}:`)) uncovered.push(`${name}: ${v}`);
      }
    }

    assert.deepEqual(
      uncovered,
      [],
      'the registry accepts these env names but the app service forwards none of them — '
      + 'a key set under one would silently arrive EMPTY in the container',
    );
  });
});

describe('MCP preset auth stays server-side', () => {
  it('the registry is never imported by browser code', () => {
    // api/ runs server-side. A src/ import would pull env-reading code into the
    // Vite bundle and put the key names — and potentially values — in reach of
    // the browser. tests/browser-bundle-secret-guard covers built output; this
    // catches the mistake at the source level, where it is cheaper to fix.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSyncSafe(dir)) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8');
          if (text.includes('_mcp-preset-auth')) offenders.push(full);
        }
      }
    };
    walk(resolve(ROOT, 'src'));
    assert.deepEqual(offenders, [], 'src/ must not import the server-side preset auth registry');
  });
});

function readdirSyncSafe(dir) {
  try {
    // eslint-disable-next-line node/no-sync
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

import { readdirSync } from 'node:fs';
