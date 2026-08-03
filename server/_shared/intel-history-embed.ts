/**
 * Query-side embedding for the historical intelligence memory (#5694).
 *
 * Split out of intel-history-client.ts: turning free text into a vector is a
 * different upstream (a paid embeddings provider), a different failure mode,
 * and a different budget than reading the Convex store — and it is the half
 * that grows when the embedding model is versioned (#5742).
 *
 * EDGE-RUNTIME CONSTRAINT — the embedding call is reimplemented here rather
 * than reusing `embedBatch` from scripts/lib/brief-embedding.mjs. That module
 * imports `node:crypto` for its cache keys, and the intelligence gateway
 * (api/intelligence/v1/[rpc].ts) runs on the Vercel Edge runtime, which
 * rejects node: built-ins at runtime. Only the pure, dependency-free modules
 * are imported: the tunables that must not drift from the seed writer's, and
 * the outlet-suffix stripper that is half the normalization contract. The
 * other half (`normalizeQueryText`) is re-derived, and
 * tests/intel-history-endpoints.test.mts asserts it against the real
 * `normalizeForEmbedding` so the copy cannot drift silently.
 */

import {
  EMBED_DIMS,
  EMBED_MODEL,
  OPENROUTER_EMBEDDINGS_URL,
} from '../../scripts/lib/brief-dedup-consts.mjs';
import { stripSourceSuffix } from '../../scripts/lib/brief-dedup-jaccard.mjs';
import { getCachedJson, setCachedJson } from './redis';
// @ts-expect-error — JS module, no declaration file
import { captureSilentError } from '../../api/_sentry-edge.js';

/**
 * One embeddings call on a user-facing read path. Shorter than the seed
 * writer's 45s batch budget: this is a single input on an interactive
 * request, and a slow provider should degrade to `upstream_unavailable`
 * well inside the edge function's own limit.
 */
const EMBED_TIMEOUT_MS = 4_000;

/**
 * The local provider (LM Studio / any OpenAI-compatible box on the operator's
 * own hardware) gets a longer leash than the paid edge path: it may be busy
 * serving generation work when the query lands, and there is no per-call cost
 * pressure. Still inside the 12s MCP tool budget with the store read behind it.
 */
const LOCAL_EMBED_TIMEOUT_MS = 8_000;

/**
 * Query-vector cache. Every miss spends one paid OpenRouter call on an
 * interactive request, and repeat traffic here is real: agents re-issue the
 * same MCP query, and dashboard phrases repeat verbatim.
 *
 * The seed writer's 14-day TTL is sized for a corpus that never changes once
 * written; a query vector only has to outlive a burst of repeats, so hours
 * are enough and a shorter window bounds how long a model change could serve
 * mismatched vectors. The key carries the model and dimension for that
 * reason — a model swap lands on a cold namespace instead of silently mixing
 * vector spaces.
 *
 * The query itself is HASHED into the key, never embedded verbatim. What
 * users search for is their business: a raw-text key would expose every
 * analyst's query to anything that can list Redis keys (dashboards, key
 * dumps, support tooling) and would let an unbounded input become an
 * unbounded key.
 *
 * The prefix is derived from the ACTIVE provider's model+dims (not the
 * OpenRouter constants) so a self-host running the local branch lands on its
 * own cache namespace — the property the constant prefix existed to protect
 * (a model swap must never serve mismatched vectors) now has to survive two
 * providers coexisting across deploys of the same Redis.
 */
const EMBED_CACHE_TTL_SECONDS = 6 * 60 * 60;
const embedCachePrefix = (model: string, dims: number): string =>
  `intel-history:embed:v1:${model}:${dims}:`;

/**
 * SHA-256 via Web Crypto — available on the Edge runtime, unlike the
 * node:crypto hashing the seed-side cache uses.
 */
async function hashCacheInput(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let _didWarnMissingOpenRouterKey = false;
let _didWarnIncompleteLocalEmbedConfig = false;

/**
 * The active embeddings provider, resolved per call so env changes and tests
 * take effect without module reloads.
 *
 * INTEL_EMBED_BASE_URL selects the LOCAL branch (an OpenAI-compatible
 * endpoint such as LM Studio at http://host.docker.internal:1234/v1) and then
 * INTEL_EMBED_MODEL + INTEL_EMBED_DIMS are REQUIRED: stored and query vectors
 * are only comparable under one model+dims pair, and guessing either would
 * rank against a mismatched vector space — so an incomplete local config
 * warns once and disables semantic search (upstreamUnavailable) rather than
 * silently falling back to a paid provider that embeds in a different space.
 *
 * `dimensions` is only sent to OpenRouter: it is how text-embedding-3-small
 * is truncated to 512, whereas local servers commonly ignore or reject the
 * parameter and serve the model's native width — which is why the local
 * branch instead VALIDATES the returned length against INTEL_EMBED_DIMS.
 *
 * Absent a base URL the OpenRouter branch is byte-identical to the
 * pre-selector behavior, including its warn-once on a missing key.
 */
interface EmbedProvider {
  url: string;
  model: string;
  dims: number;
  headers: Record<string, string>;
  sendDimensions: boolean;
  timeoutMs: number;
}

function resolveEmbedProvider(): EmbedProvider | null {
  const baseUrl = (process.env.INTEL_EMBED_BASE_URL ?? '').replace(/\/+$/, '');
  if (baseUrl) {
    const model = process.env.INTEL_EMBED_MODEL ?? '';
    const dims = Number(process.env.INTEL_EMBED_DIMS ?? '');
    if (!model || !Number.isInteger(dims) || dims <= 0) {
      if (!_didWarnIncompleteLocalEmbedConfig) {
        _didWarnIncompleteLocalEmbedConfig = true;
        console.warn(
          '[intel-history] INTEL_EMBED_BASE_URL is set but INTEL_EMBED_MODEL/INTEL_EMBED_DIMS are missing or invalid; semantic history search disabled',
        );
      }
      return null;
    }
    return {
      url: `${baseUrl}/embeddings`,
      model,
      dims,
      headers: {},
      sendDimensions: false,
      timeoutMs: LOCAL_EMBED_TIMEOUT_MS,
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  if (!apiKey) {
    if (!_didWarnMissingOpenRouterKey) {
      _didWarnMissingOpenRouterKey = true;
      console.warn('[intel-history] OPENROUTER_API_KEY not set; semantic history search disabled');
    }
    return null;
  }
  return {
    url: OPENROUTER_EMBEDDINGS_URL,
    model: EMBED_MODEL,
    dims: EMBED_DIMS,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://worldmonitor.app',
      'X-Title': 'World Monitor',
    },
    sendDimensions: true,
    timeoutMs: EMBED_TIMEOUT_MS,
  };
}

/**
 * The query-side half of the normalization contract shared with
 * scripts/lib/brief-embedding.mjs:normalizeForEmbedding. The seed writer
 * embeds normalized text; a query normalized any differently ranks against a
 * subtly different vector space and degrades recall with nothing to point at.
 *
 * Kept byte-equivalent to that function — outlet-suffix strip (imported, so
 * the outlet list stays single-sourced), trim, whitespace collapse, lowercase.
 */
export function normalizeQueryText(text: string): string {
  if (typeof text !== 'string') return '';
  return stripSourceSuffix(text).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A vector is only usable at exactly the active provider's dimension, all
 * components finite. Applied to cache hits as well as provider responses: a
 * stale or corrupt entry must be re-embedded, never forwarded — the store
 * would reject it (or worse, rank against it) and the caller would report an
 * outage that isn't one. Parameterized per backend because the OpenRouter
 * branch runs at 512 and a local provider at its own native width.
 */
function isUsableVector(value: unknown, dims: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === dims &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/**
 * Embed one free-text query with the model and dimensions the stored vectors
 * were produced under. Returns null on any failure — missing key, provider
 * error, timeout, or a vector the store would reject anyway.
 *
 * A wrong-dimension or non-finite vector is treated as failure rather than
 * passed through: convex/intelHistory.ts would reject it, and a silently
 * substituted vector would return arbitrary rows presented as real matches.
 *
 * Results are cached on the normalized query text, so a repeated query costs
 * a Redis read instead of a paid provider call. Cache failures are never
 * fatal: a miss or a write error just means the provider is asked again.
 */
export async function embedQueryText(text: string): Promise<number[] | null> {
  const provider = resolveEmbedProvider();
  if (!provider) return null;

  const input = normalizeQueryText(text);
  if (!input) return null;

  const cacheKey = `${embedCachePrefix(provider.model, provider.dims)}${await hashCacheInput(input)}`;
  const cached = await getCachedJson(cacheKey);
  if (isUsableVector(cached, provider.dims)) return cached;

  try {
    const resp = await fetch(provider.url, {
      method: 'POST',
      headers: {
        ...provider.headers,
        'Content-Type': 'application/json',
        'User-Agent': 'worldmonitor-gateway/1.0',
      },
      body: JSON.stringify({
        model: provider.model,
        input: [input],
        ...(provider.sendDimensions ? { dimensions: provider.dims } : {}),
      }),
      signal: AbortSignal.timeout(provider.timeoutMs),
    });
    if (!resp.ok) {
      console.warn(`[intel-history] embeddings provider returned HTTP ${resp.status}`);
      return null;
    }
    const body = (await resp.json()) as { data?: Array<{ embedding?: unknown }> };
    const vector = body?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== provider.dims) {
      console.warn(
        `[intel-history] embeddings provider returned ${
          Array.isArray(vector) ? `${vector.length} dims` : 'no vector'
        }, expected ${provider.dims}`,
      );
      return null;
    }
    if (!vector.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      console.warn('[intel-history] embeddings provider returned a non-finite component');
      return null;
    }
    await setCachedJson(cacheKey, vector, EMBED_CACHE_TTL_SECONDS);
    return vector as number[];
  } catch (err) {
    // Degrades to upstreamUnavailable rather than a 5xx, so the caller sees a
    // 200 with no records — report it, or a provider outage is indistinguishable
    // from an empty history in every dashboard we have.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[intel-history] embeddings call failed: ${msg}`);
    captureSilentError(err, {
      tags: { surface: 'server', component: 'intel-history', stage: 'embed' },
      fingerprint: ['intel-history', 'embed-error'],
    });
    return null;
  }
}
