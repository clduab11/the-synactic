// Replaces tests/open-meteo-proxy-fallback.test.mjs, which locked a Decodo
// two-leg proxy cascade whose own source comment stated its purpose: "Decodo
// gateway gets a different egress IP that is not (yet) on Open-Meteo's per-IP
// throttle." That is per-IP quota evasion, forbidden by CONTEXT.md boundary 2
// v9, so the behavior and the tests that pinned it are both gone.
//
// What this file locks instead:
//   1. The request carries an HONEST declared bot UA, never a browser UA.
//   2. There is NO proxy fallback — no _PROXY_DEFAULTS export, and the old
//      injection seams are inert if a caller still passes them.
//   3. Exhausted retries FAIL LOUDLY, carrying the upstream HTTP status.
//   4. The retry/parse behavior that was never in question still works.
//
// All HTTP is mocked — no real fetch, no real upstream.

import { test, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

const HELPER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/_open-meteo-archive.mjs');

const ZONES = [
  { name: 'Tropical', lat: 0,  lon: 0 },
  { name: 'Polar',    lat: 80, lon: 0 },
];

const VALID_PAYLOAD = ZONES.map((z) => ({
  latitude: z.lat,
  longitude: z.lon,
  daily: { time: ['2020-01-01'], temperature_2m_mean: [10] },
}));

const ARCHIVE_OPTS = {
  startDate: '2020-01-01',
  endDate: '2020-01-02',
  daily: ['temperature_2m_mean'],
  maxRetries: 1,
  retryBaseMs: 10,
  timeoutMs: 1000,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function loadHelper() {
  return import(`../scripts/_open-meteo-archive.mjs?t=${Date.now()}-${Math.random()}`);
}

/**
 * Reduce a source file to executable CODE for token scanning.
 *
 * The forbidden tokens below are also named in this repo's explanatory
 * comments (the whole point of those comments is to record what was removed
 * and why), so scanning raw source would fire on prose. Strip block comments
 * and FULL-LINE `//` comments only — deliberately NOT trailing `//`, because
 * a naive strip-from-`//` also truncates string literals at `https://`, which
 * would blind the scan to exactly the kind of proxy hostname it exists to
 * catch (e.g. 'https://gate.decodo.com').
 *
 * CRLF working tree: normalize line endings FIRST or the line split and every
 * regex below can match nothing and pass vacuously.
 */
function codeOnly(path) {
  return readFileSync(path, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// ─── 1. Honest UA ───────────────────────────────────────────────────────────

test('sends the honest declared bot UA, never a browser-impersonation UA', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  let seenUa = null;
  globalThis.fetch = async (_url, init) => {
    seenUa = init?.headers?.['User-Agent'];
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => VALID_PAYLOAD };
  };

  await fetchOpenMeteoArchiveBatch(ZONES, ARCHIVE_OPTS);

  assert.equal(seenUa, 'the-synactic/2.10 (+https://github.com/clduab11/the-synactic)');
  assert.doesNotMatch(seenUa, /Mozilla|Chrome|Safari|AppleWebKit|Gecko/i,
    'a browser-impersonation UA is forbidden by boundary 2 v9');
});

// ─── 2. No proxy fallback ───────────────────────────────────────────────────

test('_PROXY_DEFAULTS is no longer exported', async () => {
  const mod = await import('../scripts/_open-meteo-archive.mjs');
  assert.equal('_PROXY_DEFAULTS' in mod, false,
    'the proxy cascade and its exported wiring must be gone, not merely unused');
});

test('legacy proxy injection seams are inert: a 429 never reaches any proxy fetcher', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  globalThis.fetch = async () => ({
    ok: false, status: 429, headers: { get: () => null }, json: async () => ({}),
  });

  let proxyTouches = 0;
  const bump = () => { proxyTouches += 1; throw new Error('proxy path must not exist'); };

  await assert.rejects(
    () => fetchOpenMeteoArchiveBatch(ZONES, {
      ...ARCHIVE_OPTS,
      // Exactly the options the deleted cascade consumed. They must now be
      // ignored dead weight — if any of these fires, the cascade is back.
      _connectProxyResolver: bump,
      _curlProxyResolver: bump,
      _proxyFetcher: bump,
      _proxyCurlFetcher: bump,
    }),
    /Open-Meteo retries exhausted/,
  );

  assert.equal(proxyTouches, 0, 'no proxy resolver or fetcher may be consulted on a 429');
});

test('helper CODE contains no proxy / Decodo wiring', () => {
  const src = codeOnly(HELPER_PATH);

  // Positive controls FIRST. A silent read failure, a bad path, or an
  // over-aggressive comment strip would make every "does not match" assertion
  // below trivially true, so prove real code survived and the regex sees it.
  assert.ok(src.length > 500, 'helper source failed to load — negative assertions would be vacuous');
  assert.match(src, /export async function fetchOpenMeteoArchiveBatch/,
    'positive control: the function under test must be visible to these regexes');
  assert.match(src, /archive-api\.open-meteo\.com/,
    'positive control: a URL literal must survive the comment strip, or hostname scanning is blind');

  for (const forbidden of [
    /decodo/i,
    /resolveProxyForConnect/,
    /httpsProxyFetchRaw/,
    /curlFetch/,
    /_PROXY_DEFAULTS/,
    /CHROME_UA/,
  ]) {
    assert.doesNotMatch(src, forbidden, `forbidden proxy/impersonation token present: ${forbidden}`);
  }
});

// ─── 3. Loud failure carrying the upstream status ───────────────────────────

test('429 exhausted: throws and names the upstream status', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
  };

  await assert.rejects(
    () => fetchOpenMeteoArchiveBatch(ZONES, ARCHIVE_OPTS),
    (err) => {
      assert.match(err.message, /Open-Meteo retries exhausted/);
      assert.match(err.message, /HTTP 429/, 'the upstream status must be IN the thrown message');
      return true;
    },
  );
  assert.equal(calls, 2, '1 initial + 1 retry (maxRetries=1)');
});

test('non-retryable 500: throws immediately, still names the status', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) };
  };

  await assert.rejects(
    () => fetchOpenMeteoArchiveBatch(ZONES, ARCHIVE_OPTS),
    /HTTP 500/,
  );
  assert.equal(calls, 1, 'non-retryable status must not burn the retry budget');
});

test('transport error with no HTTP status: says so explicitly instead of inventing one', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  globalThis.fetch = async () => {
    throw Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
  };

  await assert.rejects(
    () => fetchOpenMeteoArchiveBatch(ZONES, ARCHIVE_OPTS),
    (err) => {
      assert.match(err.message, /last upstream status: none/);
      assert.match(err.message, /Connect Timeout Error/);
      assert.equal(err.cause?.code, 'UND_ERR_CONNECT_TIMEOUT', 'the transport error stays in the cause chain');
      return true;
    },
  );
});

test('a 429 seen before a later timeout is still reported (status is not cleared by a transport error)', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
    throw new Error('socket hang up');
  };

  await assert.rejects(
    () => fetchOpenMeteoArchiveBatch(ZONES, ARCHIVE_OPTS),
    (err) => {
      assert.match(err.message, /HTTP 429/, 'the quota refusal is the operationally important signal');
      return true;
    },
  );
});

// ─── 4. Untouched behavior ──────────────────────────────────────────────────

test('200 OK: returns the parsed batch', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => null }, json: async () => VALID_PAYLOAD,
  });

  const result = await fetchOpenMeteoArchiveBatch(ZONES, ARCHIVE_OPTS);
  assert.equal(result.length, 2);
  assert.equal(result[0].latitude, 0);
  assert.equal(result[1].latitude, 80);
});

test('batch size mismatch: throws even on 200', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => null }, json: async () => [VALID_PAYLOAD[0]],
  });

  await assert.rejects(
    () => fetchOpenMeteoArchiveBatch(ZONES, ARCHIVE_OPTS),
    /batch size mismatch/,
  );
});

test('retryable 503 then 200: recovers without a proxy', async () => {
  const { fetchOpenMeteoArchiveBatch } = await loadHelper();

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => VALID_PAYLOAD };
  };

  const result = await fetchOpenMeteoArchiveBatch(ZONES, ARCHIVE_OPTS);
  assert.equal(calls, 2);
  assert.equal(result.length, 2);
});

test('parseRetryAfterMs caps oversized Retry-After values', async () => {
  const { parseRetryAfterMs } = await loadHelper();
  assert.equal(parseRetryAfterMs('86400'), 60_000);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs('not-a-date'), null);
});

test('chunkItems splits evenly and keeps the remainder', async () => {
  const { chunkItems } = await loadHelper();
  assert.deepEqual(chunkItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
