/**
 * Local Chroma transport for the historical intelligence memory.
 *
 * Self-host counterpart to the Convex transport in ./intel-history-client.ts:
 * that module routes here when INTEL_HISTORY_BACKEND=chroma, so a deployment
 * with no Convex project (deliberately unset CONVEX_SITE_URL) can serve the
 * three history RPCs from a docker-compose `chroma` service instead of
 * answering `upstreamUnavailable: true` forever. The wire contract is owned by
 * the caller — this module reproduces exactly the
 * `{records, partial} | null` shape and the IntelHistoryRecordView field
 * semantics (absent metadata → '' / 0), so the handlers and the MCP registry
 * schemas stay byte-identical across backends.
 *
 * Chroma REST v2, default tenant/database, one collection (`intel-history-v1`)
 * created on demand in COSINE space. The writer is
 * scripts/_seed-history.mjs's chroma branch; both sides record the embedding
 * model and dimensions in the collection metadata because stored and query
 * vectors are only comparable under the same model+dims — a silent model swap
 * would rank in a mismatched vector space with nothing to point at.
 *
 * SCORE MAPPING (documented per the handler contract): the collection is
 * created with cosine space, where Chroma returns DISTANCE d = 1 − cos(q, v),
 * d ∈ [0, 2]. We emit `score = 1 − d = cos(q, v) ∈ [−1, 1]` — the exact
 * quantity the proto and the MCP outputSchema document ("Cosine similarity
 * against the query vector, in [-1, 1]; higher is closer"), and the same
 * scale GetSimilarEvents' PRECEDENT_MIN_SCORE (0.55) filters on. Real text
 * embeddings land in [0, 1]; a negative similarity is passed through honestly
 * rather than clamped.
 *
 * Every function returns `null` rather than throwing, mirroring the Convex
 * transport: a Chroma outage surfaces as `upstreamUnavailable: true` on a 200,
 * never a 5xx. Edge-safe by construction (fetch + Web APIs only, no node:*)
 * because intel-history-client.ts imports this statically and that module is
 * bundled for the Vercel Edge runtime on hosted deploys.
 */

// @ts-expect-error — JS module, no declaration file
import { captureSilentError } from '../../api/_sentry-edge.js';
import type { IntelHistoryRecordView, IntelHistoryScope } from './intel-history-client';

/** One collection, versioned in the name so a schema break is a new store. */
export const CHROMA_COLLECTION_NAME = 'intel-history-v1';

const DEFAULT_TENANT = 'default_tenant';
const DEFAULT_DATABASE = 'default_database';

/**
 * Read budget per Chroma round-trip. Matches the Convex transport's posture
 * (CONVEX_TIMEOUT_MS = 5s): the store is on the same docker network, so 5s is
 * generous, and the MCP tool budgets (8s timeline / 12s semantic) still hold
 * with the local-embed leg in front.
 */
const CHROMA_TIMEOUT_MS = 5_000;

/**
 * Timeline scan bounds. Chroma's `get` has no ORDER BY — it pages in internal
 * insertion order — so a chronological read must fetch the scoped candidate
 * set and sort by occurredAt here. Pages keep individual responses small; the
 * hard cap bounds the worst case. When the cap is hit the result is flagged
 * `partial: true` because rows beyond the scanned window may belong in the
 * requested slice — the honest report is "may omit matches", not a silent
 * truncation. At the current write rate (three seeders, ≤150 records/run,
 * dedupe-keyed upserts) the corpus stays far below the cap for a long time.
 */
const TIMELINE_PAGE_SIZE = 500;
const TIMELINE_SCAN_CAP = 5_000;

let _didWarnMissingChromaUrl = false;

/**
 * Warn once per process rather than per request — same pattern as the Convex
 * transport's missing-config warnings: a deploy that selected the chroma
 * backend but forgot CHROMA_URL would otherwise disable history with no
 * signal in the logs.
 */
function getChromaUrl(): string {
  const raw = process.env.CHROMA_URL ?? '';
  if (!raw && !_didWarnMissingChromaUrl) {
    _didWarnMissingChromaUrl = true;
    console.warn('[intel-history] INTEL_HISTORY_BACKEND=chroma but CHROMA_URL not set; history reads disabled');
  }
  return raw.replace(/\/+$/, '');
}

function collectionsBasePath(): string {
  const tenant = process.env.INTEL_CHROMA_TENANT || DEFAULT_TENANT;
  const database = process.env.INTEL_CHROMA_DATABASE || DEFAULT_DATABASE;
  return `/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(database)}/collections`;
}

/**
 * Collection-id cache, keyed by the full resolution context so tests (and a
 * runtime env flip) can never serve an id resolved against a different store.
 * A failed resolution is NOT cached — the next read retries, which is what
 * lets the reader come back on its own once the chroma container returns.
 */
const _collectionIdCache = new Map<string, string>();

async function chromaFetch(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'worldmonitor-gateway/1.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CHROMA_TIMEOUT_MS),
  });
}

/**
 * Resolve (create on first use) the history collection and return its id.
 *
 * COSINE space is declared BOTH ways Chroma has accepted it — the v2
 * `configuration.hnsw.space` field (1.x) and the legacy `hnsw:space` metadata
 * key (0.x, still honored by 1.x for compatibility) — because the distance
 * function is not a tunable here: the score contract above is only true in
 * cosine space. The embedding model+dims ride along in metadata as the
 * durable record of which vector space the collection holds.
 */
async function resolveCollectionId(baseUrl: string): Promise<string | null> {
  const cacheKey = `${baseUrl}${collectionsBasePath()}`;
  const cached = _collectionIdCache.get(cacheKey);
  if (cached) return cached;

  const embedModel = process.env.INTEL_EMBED_MODEL ?? '';
  const embedDims = process.env.INTEL_EMBED_DIMS ?? '';
  const resp = await chromaFetch(`${baseUrl}${collectionsBasePath()}`, {
    name: CHROMA_COLLECTION_NAME,
    get_or_create: true,
    configuration: { hnsw: { space: 'cosine' } },
    metadata: {
      'hnsw:space': 'cosine',
      ...(embedModel ? { embedModel } : {}),
      ...(embedDims ? { embedDims: Number(embedDims) || embedDims } : {}),
    },
  });
  if (!resp.ok) {
    console.warn(`[intel-history] chroma collection resolve returned HTTP ${resp.status}`);
    return null;
  }
  const body = (await resp.json()) as { id?: unknown };
  const id = typeof body?.id === 'string' && body.id ? body.id : null;
  if (!id) {
    console.warn('[intel-history] chroma collection resolve returned no id');
    return null;
  }
  _collectionIdCache.set(cacheKey, id);
  return id;
}

/**
 * Mirrors the Convex transport's str()/num() adapters (intel-history-client.ts)
 * so a record read from Chroma metadata is field-for-field identical to one
 * read from Convex: absent or mistyped fields become '' / 0, never undefined.
 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toRecordView(id: unknown, metadata: unknown, score: number): IntelHistoryRecordView {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  return {
    id: str(id),
    domain: str(meta.domain),
    resource: str(meta.resource),
    country: str(meta.country),
    category: str(meta.category),
    title: str(meta.title),
    summary: str(meta.summary),
    sourceUrl: str(meta.sourceUrl),
    occurredAt: num(meta.occurredAt),
    ingestedAt: num(meta.ingestedAt),
    score,
  };
}

/**
 * Build Chroma's metadata `where` filter from the shared scope. Scope values
 * arrive already normalized (country UPPER, domain lower — the client owns
 * that contract) and the writer stores them in the same normal form, so `$eq`
 * comparisons behave like Convex's `eq` did. `0` bounds mean "no bound" per
 * the published contract and are omitted, matching scopeBody() on the Convex
 * path.
 */
function buildWhere(scope: IntelHistoryScope): Record<string, unknown> | undefined {
  const clauses: Record<string, unknown>[] = [];
  if (scope.domain) clauses.push({ domain: { $eq: scope.domain } });
  if (scope.country) clauses.push({ country: { $eq: scope.country } });
  if (typeof scope.from === 'number' && Number.isFinite(scope.from) && scope.from !== 0) {
    clauses.push({ occurredAt: { $gte: scope.from } });
  }
  if (typeof scope.to === 'number' && Number.isFinite(scope.to) && scope.to !== 0) {
    clauses.push({ occurredAt: { $lte: scope.to } });
  }
  const [first] = clauses;
  if (!first) return undefined;
  return clauses.length === 1 ? first : { $and: clauses };
}

/**
 * Wrap one full read (collection resolve + query) in the transport's
 * null-on-failure contract, with the same Sentry visibility the Convex path
 * has: the caller reports a 200 with `upstreamUnavailable`, so the log/Sentry
 * trail is the only way to distinguish an outage from an empty store.
 */
async function guardedRead<T>(stage: string, read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[intel-history] chroma ${stage} failed: ${msg}`);
    captureSilentError(err, {
      tags: { surface: 'server', component: 'intel-history', stage: 'chroma-read' },
      fingerprint: ['intel-history', 'chroma-read-error', stage],
    });
    return null;
  }
}

/**
 * Semantic read: rank the stored vectors against the caller's query vector.
 * Same signature and semantics as the Convex transport's intelHistorySearch.
 *
 * `partial` is true when the result filled the requested limit — by
 * construction further (weaker) matches may exist beyond the cut, which is
 * exactly the "bounded candidate window may omit further matches" the
 * declared outputSchema describes. A shorter-than-limit result saw every
 * scoped candidate and is exhaustive under the filter.
 */
export function localIntelHistorySearch(
  params: IntelHistoryScope & { embedding: number[]; minScore?: number },
): Promise<{ records: IntelHistoryRecordView[]; partial: boolean } | null> {
  return guardedRead('search', async () => {
    const baseUrl = getChromaUrl();
    if (!baseUrl) return null;
    const collectionId = await resolveCollectionId(baseUrl);
    if (!collectionId) return null;

    const { embedding, minScore, ...scope } = params;
    const where = buildWhere(scope);
    const resp = await chromaFetch(
      `${baseUrl}${collectionsBasePath()}/${collectionId}/query`,
      {
        query_embeddings: [embedding],
        n_results: scope.limit,
        ...(where ? { where } : {}),
        include: ['metadatas', 'distances'],
      },
    );
    if (!resp.ok) {
      console.warn(`[intel-history] chroma query returned HTTP ${resp.status}`);
      return null;
    }
    const body = (await resp.json()) as {
      ids?: unknown[][];
      metadatas?: unknown[][];
      distances?: unknown[][];
    };
    const idsRow = Array.isArray(body?.ids) ? body.ids[0] : undefined;
    const ids = Array.isArray(idsRow) ? idsRow : null;
    if (!ids) {
      console.warn('[intel-history] chroma query returned no ids array');
      return null;
    }
    const metadatasRow = Array.isArray(body?.metadatas) ? body.metadatas[0] : undefined;
    const metadatas = Array.isArray(metadatasRow) ? metadatasRow : [];
    const distancesRow = Array.isArray(body?.distances) ? body.distances[0] : undefined;
    const distances = Array.isArray(distancesRow) ? distancesRow : [];

    const records: IntelHistoryRecordView[] = [];
    for (let i = 0; i < ids.length; i++) {
      const distance = distances[i];
      // Cosine space: similarity = 1 − distance (see module header). A
      // missing/non-finite distance scores 0 rather than inventing a rank.
      const score = typeof distance === 'number' && Number.isFinite(distance) ? 1 - distance : 0;
      if (typeof minScore === 'number' && score < minScore) continue;
      records.push(toRecordView(ids[i], metadatas[i], score));
    }
    return { records, partial: ids.length >= scope.limit && scope.limit > 0 };
  });
}

/**
 * Chronological read. Pages the scoped candidate set (Chroma `get` has no
 * sort — see TIMELINE_SCAN_CAP above), orders by occurredAt descending with
 * an id tiebreak for stable output, and returns the newest `limit` rows.
 */
export function localIntelHistoryTimeline(
  scope: IntelHistoryScope,
): Promise<{ records: IntelHistoryRecordView[]; partial: boolean } | null> {
  return guardedRead('timeline', async () => {
    const baseUrl = getChromaUrl();
    if (!baseUrl) return null;
    const collectionId = await resolveCollectionId(baseUrl);
    if (!collectionId) return null;

    const where = buildWhere(scope);
    const rows: Array<{ id: unknown; metadata: unknown }> = [];
    let cappedScan = false;
    for (let offset = 0; offset < TIMELINE_SCAN_CAP; offset += TIMELINE_PAGE_SIZE) {
      const resp = await chromaFetch(
        `${baseUrl}${collectionsBasePath()}/${collectionId}/get`,
        {
          ...(where ? { where } : {}),
          limit: TIMELINE_PAGE_SIZE,
          offset,
          include: ['metadatas'],
        },
      );
      if (!resp.ok) {
        console.warn(`[intel-history] chroma get returned HTTP ${resp.status}`);
        return null;
      }
      const body = (await resp.json()) as { ids?: unknown[]; metadatas?: unknown[] };
      const ids = Array.isArray(body?.ids) ? body.ids : null;
      if (!ids) {
        console.warn('[intel-history] chroma get returned no ids array');
        return null;
      }
      const metadatas = Array.isArray(body?.metadatas) ? body.metadatas : [];
      for (let i = 0; i < ids.length; i++) rows.push({ id: ids[i], metadata: metadatas[i] });
      if (ids.length < TIMELINE_PAGE_SIZE) break;
      if (offset + TIMELINE_PAGE_SIZE >= TIMELINE_SCAN_CAP) cappedScan = true;
    }

    const records = rows
      .map((row) => toRecordView(row.id, row.metadata, 0))
      .sort((a, b) => b.occurredAt - a.occurredAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sliced = records.slice(0, scope.limit);
    // Partial when the scan cap truncated the candidate set OR the post-sort
    // slice dropped older matching rows — both mean "older matches exist that
    // this bounded read did not return".
    return { records: sliced, partial: cappedScan || records.length > sliced.length };
  });
}
