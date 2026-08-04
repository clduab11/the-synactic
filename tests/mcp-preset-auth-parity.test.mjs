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
    assert.ok(presets.length >= 20, `expected >=20 presets, parsed ${presets.length}`);
    assert.ok(entries.length >= 20, `expected >=20 registry entries, parsed ${entries.length}`);
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

  it('Datadog is the two-header case and declares both', () => {
    // It has no single apiKeyHeader in the store, which is exactly why the
    // modal routes it to custom-headers mode. The registry must still be able
    // to satisfy it from env, and only when BOTH halves are present.
    assert.match(registrySrc, /DD-API-KEY: \{key\}/);
    assert.match(registrySrc, /DD-APPLICATION-KEY: \{key\}/);
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
