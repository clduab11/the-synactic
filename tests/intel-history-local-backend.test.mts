// Tests for the local Chroma backend behind the three history RPCs
// (session-09 [2b]): the INTEL_HISTORY_BACKEND=chroma routing seam in
// server/_shared/intel-history-client.ts, the cosine distance→score mapping
// in server/_shared/intel-history-local.ts, and the INTEL_EMBED_BASE_URL
// local-provider branch in server/_shared/intel-history-embed.ts.
//
// Sibling of tests/intel-history-endpoints.test.mts (which pins the Convex +
// OpenRouter behavior); no network — every test stubs globalThis.fetch.
// Run via `npm run test:data`.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

// Same call-time-env convention as the sibling suite: the modules resolve
// every variable per call, so per-test assignment (with restoration below)
// is sufficient. Upstash points at a stub so the embed cache path is inert.
process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-upstash-token';

import { intelHistorySearch, intelHistoryTimeline } from '../server/_shared/intel-history-client';
import { embedQueryText } from '../server/_shared/intel-history-embed';

// Env vars this suite mutates; snapshot/restore so nothing leaks into the
// other suites running in the same tsx --test process.
const MUTATED_ENV = [
  'INTEL_HISTORY_BACKEND',
  'CHROMA_URL',
  'INTEL_EMBED_BASE_URL',
  'INTEL_EMBED_MODEL',
  'INTEL_EMBED_DIMS',
  'CONVEX_SITE_URL',
  'CONVEX_SERVER_SHARED_SECRET',
] as const;

const realFetch = globalThis.fetch;
let envSnapshot: Record<string, string | undefined> = {};
let calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> | null }> = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Route-by-prefix fetch stub; unmatched Upstash traffic is answered inert. */
function stubFetch(routes: Array<[prefix: string, respond: () => Response]>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, headers, body });
    for (const [prefix, respond] of routes) {
      if (url.startsWith(prefix)) return respond();
    }
    if (url.startsWith('https://fake-upstash.upstash.io/get/')) return jsonResponse({ result: null });
    if (url.startsWith('https://fake-upstash.upstash.io/')) return jsonResponse({ result: 'OK' });
    throw new Error(`unstubbed fetch: ${url}`);
  }) as typeof globalThis.fetch;
}

beforeEach(() => {
  calls = [];
  envSnapshot = {};
  for (const name of MUTATED_ENV) {
    envSnapshot[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const name of MUTATED_ENV) {
    if (envSnapshot[name] === undefined) delete process.env[name];
    else process.env[name] = envSnapshot[name];
  }
});

describe('INTEL_HISTORY_BACKEND routing', () => {
  it('routes the semantic read to Chroma and maps cosine distance to score', async () => {
    process.env.INTEL_HISTORY_BACKEND = 'chroma';
    // Unique host per test: the local transport memoizes collection ids per
    // base URL, so reusing a host would serve another test's id.
    process.env.CHROMA_URL = 'http://fake-chroma-search:8000';

    stubFetch([
      ['http://fake-chroma-search:8000/api/v2/tenants/default_tenant/databases/default_database/collections/col-1/query',
        () => jsonResponse({
          ids: [['a', 'b']],
          distances: [[0.25, 0.9]],
          metadatas: [[
            { domain: 'conflict', resource: 'acled-intel', country: 'UA', title: 'A', occurredAt: 111, ingestedAt: 222 },
            { title: 'B' },
          ]],
        })],
      ['http://fake-chroma-search:8000/api/v2/tenants/default_tenant/databases/default_database/collections',
        () => jsonResponse({ id: 'col-1' })],
    ]);

    const result = await intelHistorySearch({
      embedding: [0.1, 0.2],
      domain: 'conflict',
      country: '',
      limit: 2,
      minScore: 0.5,
    });

    assert.ok(result, 'chroma-backed search must not report an outage');
    // Cosine space: score = 1 − distance. 1 − 0.25 = 0.75 keeps record "a";
    // 1 − 0.9 = 0.1 falls under minScore 0.5 and is dropped, the same filter
    // Convex applied server-side for GetSimilarEvents' precedent floor.
    assert.equal(result.records.length, 1);
    assert.ok(Math.abs(result.records[0]!.score - 0.75) < 1e-12);
    // Absent metadata fields adapt to ''/0 exactly like the Convex adapter.
    assert.deepEqual(result.records[0], {
      id: 'a', domain: 'conflict', resource: 'acled-intel', country: 'UA', category: '',
      title: 'A', summary: '', sourceUrl: '', occurredAt: 111, ingestedAt: 222, score: result.records[0]!.score,
    });
    // A limit-filling result may omit further (weaker) matches.
    assert.equal(result.partial, true);

    const query = calls.find((c) => c.url.endsWith('/col-1/query'));
    assert.equal(query?.body?.n_results, 2);
    assert.deepEqual(query?.body?.where, { domain: { $eq: 'conflict' } });
    assert.ok(!calls.some((c) => c.url.includes('convex')), 'the Convex transport must not be touched');
  });

  it('sorts the timeline by occurredAt descending and flags the dropped tail as partial', async () => {
    process.env.INTEL_HISTORY_BACKEND = 'chroma';
    process.env.CHROMA_URL = 'http://fake-chroma-timeline:8000';

    stubFetch([
      ['http://fake-chroma-timeline:8000/api/v2/tenants/default_tenant/databases/default_database/collections/col-2/get',
        () => jsonResponse({
          ids: ['x', 'y', 'z'],
          metadatas: [
            { domain: 'energy', title: 'oldest', occurredAt: 100 },
            { domain: 'energy', title: 'newest', occurredAt: 300 },
            { domain: 'energy', title: 'middle', occurredAt: 200 },
          ],
        })],
      ['http://fake-chroma-timeline:8000/api/v2/tenants/default_tenant/databases/default_database/collections',
        () => jsonResponse({ id: 'col-2' })],
    ]);

    const result = await intelHistoryTimeline({ domain: 'energy', from: 50, to: 0, limit: 2 });

    assert.ok(result);
    assert.deepEqual(result.records.map((r) => r.occurredAt), [300, 200]);
    // Chronological reads carry no similarity — score stays 0 by contract.
    assert.equal(result.records[0]!.score, 0);
    assert.equal(result.partial, true, 'the dropped oldest row means older matches exist');

    const get = calls.find((c) => c.url.endsWith('/col-2/get'));
    assert.deepEqual(get?.body?.where, {
      $and: [{ domain: { $eq: 'energy' } }, { occurredAt: { $gte: 50 } }],
    });
  });

  it('degrades to null (upstreamUnavailable) when Chroma is unreachable, never throws', async () => {
    process.env.INTEL_HISTORY_BACKEND = 'chroma';
    process.env.CHROMA_URL = 'http://fake-chroma-down:8000';
    stubFetch([
      ['http://fake-chroma-down:8000/', () => { throw new TypeError('fetch failed'); }],
    ]);

    assert.equal(await intelHistoryTimeline({ domain: 'energy', limit: 5 }), null);
    assert.equal(await intelHistorySearch({ embedding: [1], limit: 5 }), null);
  });

  it('leaves the Convex path selected when the backend env is unset', async () => {
    // No backend, no Convex config → the Convex transport's own unconfigured
    // null, with zero network calls — proving the selector defaults to the
    // pre-existing path rather than the local one.
    stubFetch([]);
    assert.equal(await intelHistoryTimeline({ domain: 'energy', limit: 5 }), null);
    assert.equal(calls.length, 0);
  });
});

describe('INTEL_EMBED_BASE_URL local provider', () => {
  it('embeds via the local endpoint without auth and namespaces the cache by model+dims', async () => {
    process.env.INTEL_EMBED_BASE_URL = 'http://fake-lmstudio:1234/v1';
    process.env.INTEL_EMBED_MODEL = 'nomic-test';
    process.env.INTEL_EMBED_DIMS = '4';

    stubFetch([
      ['http://fake-lmstudio:1234/v1/embeddings',
        () => jsonResponse({ data: [{ index: 0, embedding: [1, 2, 3, 4] }] })],
    ]);

    const vector = await embedQueryText('Tanker seized near Hormuz');
    assert.deepEqual(vector, [1, 2, 3, 4]);

    const embedCall = calls.find((c) => c.url === 'http://fake-lmstudio:1234/v1/embeddings');
    assert.ok(embedCall, 'expected a local embeddings call');
    assert.equal(embedCall.headers['authorization'], undefined, 'no API key on the local branch');
    assert.equal(embedCall.body?.model, 'nomic-test');
    // `dimensions` is an OpenRouter-only truncation knob; local servers get
    // the model's native width and the DIMS env validates it instead.
    assert.equal('dimensions' in (embedCall.body ?? {}), false);

    const cacheWrite = calls.find(
      (c) => c.url === 'https://fake-upstash.upstash.io/' && Array.isArray(c.body),
    ) as unknown as { body: string[] } | undefined;
    const setKey = cacheWrite?.body?.[1] ?? '';
    assert.ok(
      setKey.startsWith('intel-history:embed:v1:nomic-test:4:'),
      `cache key must carry the ACTIVE model+dims namespace, got: ${setKey}`,
    );
  });

  it('rejects a native width that disagrees with INTEL_EMBED_DIMS', async () => {
    process.env.INTEL_EMBED_BASE_URL = 'http://fake-lmstudio:1234/v1';
    process.env.INTEL_EMBED_MODEL = 'nomic-test';
    process.env.INTEL_EMBED_DIMS = '5';

    stubFetch([
      ['http://fake-lmstudio:1234/v1/embeddings',
        () => jsonResponse({ data: [{ index: 0, embedding: [1, 2, 3, 4] }] })],
    ]);

    // A wrong-width vector would rank against a mismatched space — null
    // (upstreamUnavailable) is the honest outcome, never a substitute vector.
    assert.equal(await embedQueryText('Tanker seized near Hormuz'), null);
  });
});
