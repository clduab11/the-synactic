import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as rawReadFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CRLF-normalize before ANY regex: this checkout has a CRLF working tree, and a
// pattern that silently matches nothing would make every assertion below pass
// VACUOUSLY — a guard that cannot fail is worse than no guard.
function readFileSync(path) {
  return rawReadFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarSource = readFileSync(resolve(__dirname, '../src-tauri/sidecar/local-api-server.mjs'));
const corsSource = readFileSync(resolve(__dirname, '../api/_cors.js'));

/**
 * Extract a JS string-array literal assigned to `name`, as its string items.
 * Accepts both a bare literal and one immediately `.join(...)`-ed — api/_cors.js
 * uses the latter, the sidecar the former.
 */
function parseStringArray(source, name) {
  const block = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\](?:\\.join\\([^)]*\\))?;`));
  assert.ok(block, `could not locate the ${name} array literal`);
  const items = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(items.length > 0, `${name} parsed to an EMPTY list — the regex matched nothing, so every downstream assertion would pass vacuously`);
  return items;
}

describe('sidecar CORS preflight parity with api/_cors.js (session 11)', () => {
  // WHY THIS EXISTS. Two handlers serve one API and only one of them answers
  // OPTIONS. dispatch() in the sidecar short-circuits OPTIONS *before* the
  // auth gate, so the preflight contract comes from makeCorsHeaders() while
  // every real response is built by api/_cors.js getCorsHeaders(). When the
  // preflight advertised the NARROWER contract, browsers rejected it and the
  // real request was never sent — net::ERR_FAILED with no server-side trace,
  // because a request that fails preflight never reaches the server at all.

  it('preflight allows credentials, matching what real responses send', () => {
    // api/_cors.js sets this on actual responses...
    assert.match(corsSource, /'Access-Control-Allow-Credentials': 'true'/);
    // ...so the preflight MUST too, or credentialed cross-origin calls
    // (premium-fetch.ts forces credentials:'include') fail before being sent.
    const makeCors = sidecarSource.match(/function makeCorsHeaders\(req\) \{[\s\S]*?\n\}/);
    assert.ok(makeCors, 'could not locate makeCorsHeaders in the sidecar');
    assert.match(
      makeCors[0],
      /'Access-Control-Allow-Credentials': 'true'/,
      'sidecar preflight omits Allow-Credentials — every credentialed cross-origin request will fail at preflight',
    );
  });

  it('sidecar preflight allow-headers is a superset of the API allow-headers', () => {
    const apiHeaders = parseStringArray(corsSource, 'ALLOWED_HEADERS');
    const sidecarHeaders = parseStringArray(sidecarSource, 'SIDECAR_ALLOWED_HEADERS');
    const lower = new Set(sidecarHeaders.map((h) => h.toLowerCase()));
    const missing = apiHeaders.filter((h) => !lower.has(h.toLowerCase()));
    assert.deepEqual(
      missing,
      [],
      `sidecar preflight omits header(s) the API accepts: ${missing.join(', ')} — requests carrying them die at preflight`,
    );
  });

  it('preflight never pairs credentials with a wildcard origin', () => {
    // Allow-Credentials: true and Allow-Origin: * are mutually exclusive per
    // the Fetch spec, and browsers reject the pair. The sidecar echoes an
    // allowlisted origin instead, so assert no wildcard leaked in.
    const makeCors = sidecarSource.match(/function makeCorsHeaders\(req\) \{[\s\S]*?\n\}/);
    assert.ok(makeCors);
    assert.doesNotMatch(makeCors[0], /'Access-Control-Allow-Origin': ['"]\*['"]/);
    assert.match(makeCors[0], /'Access-Control-Allow-Origin': getSidecarCorsOrigin\(req\)/);
  });

  it('OPTIONS is still answered before the auth gate', () => {
    // The parity above only matters because OPTIONS short-circuits early — a
    // preflight cannot carry the sidecar token, so routing it through the auth
    // gate would 401 every preflight instead. Locks that ordering in.
    const dispatchIdx = sidecarSource.indexOf('async function dispatch(');
    assert.ok(dispatchIdx > -1, 'could not locate dispatch()');
    const optionsIdx = sidecarSource.indexOf("req.method === 'OPTIONS'", dispatchIdx);
    const authGateIdx = sidecarSource.indexOf('const expectedToken = process.env.LOCAL_API_TOKEN', dispatchIdx);
    assert.ok(optionsIdx > -1, 'dispatch() no longer short-circuits OPTIONS');
    assert.ok(authGateIdx > -1, 'could not locate the sidecar auth gate');
    assert.ok(
      optionsIdx < authGateIdx,
      'OPTIONS must be answered BEFORE the LOCAL_API_TOKEN gate or every preflight 401s',
    );
  });
});
