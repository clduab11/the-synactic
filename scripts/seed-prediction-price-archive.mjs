#!/usr/bin/env node

// Prediction-market price archiver (backtest lane, build step 1).
//
// Appends a raw+parsed snapshot of BOTH venues' full open universes to
// durable object storage every run, keyed per (venue, 30-min window) so a
// re-run upserts rather than duplicates. This is deliberately NOT part of
// seed-prediction-markets: the bootstrap publishes a curated, price-clipped
// pool for the dashboard, while backtesting needs the unclipped universe
// with raw payloads retained — and an archiver outage must be loud on its
// own, not smothered inside another seeder's success.
//
// Storage sink: Cloudflare R2 when configured (hosted / creds present),
// else the local filesystem under data/prediction-price-archive/ (the
// self-host stack — durable on the operator's own disk, gitignored). No
// sink at all is a hard failure: this seeder's entire job is durability,
// and per the lane's charter every silent 30 minutes is market history
// permanently destroyed.
//
// Follows the append-seeder shell pattern (seed-forecast-bets.mjs): bypasses
// runSeed (SET-with-TTL pipeline, wrong shape for an archive) but still
// writes the bare seed-meta:<key> companion every run per AGENTS.md, plus a
// bounded coverage index string the health sweep and the backtester's
// archive-gap refusal gate both read. Exit codes: 0 OK, 75 degraded (one
// venue or the Redis companions failed), 1 fatal (nothing preserved, or a
// storage sink refused a write).

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { HONEST_UA, loadEnvFile, sleep } from './_seed-utils.mjs';
import { getR2StorageClient, resolveR2StorageConfig, withSettleTimeout } from './_r2-storage.mjs';
import {
  PRICE_ARCHIVE_COVERAGE_KEY,
  PRICE_ARCHIVE_COVERAGE_TTL_SECONDS,
  PRICE_ARCHIVE_META_KEY,
  archiveObjectKey,
  archiveWindowStart,
  buildArchiveObject,
  parseGammaArchiveRows,
  parseKalshiArchiveRows,
  updateCoverage,
} from './_prediction-price-archive.mjs';
import predictionTags from './data/prediction-tags.json' with { type: 'json' };

const DIRECT_RUN = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (DIRECT_RUN) loadEnvFile(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const FETCH_TIMEOUT = 15_000;
const TAG_DELAY_MS = 300;
// Kalshi pagination bound — a deliberate budget, not an assumption. Live
// probe 2026-08-28: the open-events universe exceeds 4,000 events (40 pages
// without exhausting the cursor), dominated by high-churn sports/daily
// series. 20 pages ≈ 2,000 events ≈ 13k markets per window, gzipped to
// low-single-digit MB. The dashboard seeder itself reads only page 1, so
// everything past it is already beyond the lane's minimum; the bound and
// the truncation flag both ride in requestSpec so narrowed coverage is
// visible in the archive, never silent.
const KALSHI_MAX_PAGES = 20;
const SOURCE_VERSION = 'prediction-price-archive-v1';
const DEGRADED_EXIT_CODE = 75;

// The union of every tag pool the bootstrap seeder requests — the archive
// must cover at least everything the dashboard pipeline touches.
const GAMMA_TAGS = [...new Set([
  ...predictionTags.geopolitical,
  ...predictionTags.tech,
  ...predictionTags.finance,
])];

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': HONEST_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

async function fetchKalshiLive() {
  const observedAt = Date.now();
  const payloads = [];
  let cursor = null;
  let pages = 0;
  while (pages < KALSHI_MAX_PAGES) {
    const params = new URLSearchParams({ status: 'open', with_nested_markets: 'true', limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await fetchJson(`${KALSHI_BASE}/events?${params}`);
    payloads.push(page);
    pages += 1;
    cursor = typeof page?.cursor === 'string' && page.cursor !== '' ? page.cursor : null;
    if (!cursor || !Array.isArray(page?.events) || page.events.length === 0) break;
  }
  return {
    payloads,
    observedAt,
    requestSpec: {
      endpoint: `${KALSHI_BASE}/events`,
      params: { status: 'open', with_nested_markets: true, limit: 100 },
      pages,
      maxPages: KALSHI_MAX_PAGES,
      truncated: pages === KALSHI_MAX_PAGES && cursor != null,
    },
  };
}

async function fetchGammaLive() {
  const observedAt = Date.now();
  const payloads = [];
  const failedTags = [];
  for (const tag of GAMMA_TAGS) {
    const params = new URLSearchParams({
      tag_slug: tag,
      closed: 'false',
      active: 'true',
      archived: 'false',
      end_date_min: new Date(observedAt).toISOString(),
      order: 'volume',
      ascending: 'false',
      limit: '100',
    });
    try {
      payloads.push(await fetchJson(`${GAMMA_BASE}/events?${params}`));
    } catch (err) {
      // A single tag failing narrows coverage; ALL tags failing is a venue
      // failure. Either way the truth is recorded in requestSpec.
      failedTags.push(tag);
      console.warn(`  [price-archive] gamma tag ${tag} failed: ${err?.message || err}`);
    }
    await sleep(TAG_DELAY_MS);
  }
  if (payloads.length === 0) {
    throw new Error(`gamma: all ${GAMMA_TAGS.length} tag fetches failed`);
  }
  return {
    payloads,
    observedAt,
    requestSpec: {
      endpoint: `${GAMMA_BASE}/events`,
      tags: GAMMA_TAGS,
      limitPerTag: 100,
      ...(failedTags.length ? { failedTags } : {}),
    },
  };
}

/** Filesystem sink: gzipped, atomic-per-object via tmp+rename; same key overwrites. */
export async function storeArchiveObjectToFs(rootDir, objectKey, object) {
  const target = join(rootDir, objectKey);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.part`;
  writeFileSync(tmp, gzipSync(JSON.stringify(object)));
  renameSync(tmp, target);
}

/**
 * R2 sink for gzipped archive objects. _r2-storage's putR2JsonObject is
 * plain-JSON only, so this mirrors its two modes (S3 SDK / Cloudflare API)
 * with a bytes body; keys end .json.gz and Content-Type says so.
 */
async function storeArchiveObjectToR2(config, objectKey, object) {
  const body = gzipSync(JSON.stringify(object));
  if (config.mode === 'api') {
    const encodedKey = objectKey.split('/').map((part) => encodeURIComponent(part)).join('/');
    const resp = await fetch(
      `${config.apiBaseUrl}/accounts/${config.accountId}/r2/buckets/${config.bucket}/objects/${encodedKey}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/gzip' },
        body,
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`R2 API archive upload failed: HTTP ${resp.status} — ${text.slice(0, 200)}`);
    }
    return;
  }
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await getR2StorageClient(config);
  await withSettleTimeout(
    client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: body,
      ContentType: 'application/gzip',
      CacheControl: 'no-store',
    }), { abortSignal: AbortSignal.timeout(60_000) }),
    60_000,
    `R2 s3 archive put ${objectKey}`,
  );
}

function resolveFsRoot() {
  return process.env.WM_PRICE_ARCHIVE_DIR
    || join(__dirname, '..', 'data', 'prediction-price-archive');
}

function makeDefaultStoreObject() {
  const r2Config = resolveR2StorageConfig();
  if (r2Config) {
    console.log('  [price-archive] sink: R2');
    return (key, object) => storeArchiveObjectToR2(r2Config, key, object);
  }
  const root = resolveFsRoot();
  console.log(`  [price-archive] sink: filesystem (${root}) — R2 not configured`);
  return (key, object) => storeArchiveObjectToFs(root, key, object);
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': HONEST_UA },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Redis ${command[0]} failed: HTTP ${resp.status}`);
  return (await resp.json())?.result ?? null;
}

async function readCoverageLive() {
  const raw = await redisCommand(['GET', PRICE_ARCHIVE_COVERAGE_KEY]);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function writeRedisJsonLive(key, value, ttlSeconds) {
  await redisCommand(['SET', key, JSON.stringify(value), 'EX', ttlSeconds]);
}

/**
 * One archive cycle over injected I/O. Every dependency is a plain async
 * function so the tests exercise fetch failures, sink failures, and Redis
 * blips without any network or clock.
 */
export async function runArchiveCycle({
  fetchKalshi = fetchKalshiLive,
  fetchGamma = fetchGammaLive,
  storeObject,
  readCoverage = readCoverageLive,
  writeRedisJson = writeRedisJsonLive,
  now = Date.now,
} = {}) {
  const store = storeObject ?? makeDefaultStoreObject();
  const failures = [];
  const venueResults = [];
  let storeFailed = false;

  const venues = [
    { venue: 'kalshi', fetcher: fetchKalshi, parse: parseKalshiArchiveRows },
    { venue: 'polymarket', fetcher: fetchGamma, parse: parseGammaArchiveRows },
  ];

  for (const { venue, fetcher, parse } of venues) {
    let fetched;
    try {
      fetched = await fetcher();
    } catch (err) {
      failures.push(`${venue} fetch: ${err?.message || err}`);
      continue;
    }
    const { payloads, observedAt, requestSpec } = fetched;
    const ingestedAt = now();
    // Overlapping Gamma tag payloads surface the same market many times
    // (33 tags -> 14.5k raw rows on the first live run). Parsed rows dedupe
    // on (venue, marketId) — same observation instant, so first wins; the
    // raw payloads keep every duplicate verbatim.
    const seenIds = new Set();
    const rows = payloads
      .flatMap((payload) => parse(payload, { observedAt, ingestedAt }))
      .filter((row) => {
        if (seenIds.has(row.marketId)) return false;
        seenIds.add(row.marketId);
        return true;
      });
    const windowStart = archiveWindowStart(observedAt);
    const objectKey = archiveObjectKey(venue, windowStart);
    const object = buildArchiveObject({
      venue, windowStart, observedAt, ingestedAt, requestSpec, rawPayloads: payloads, rows,
    });
    try {
      await store(objectKey, object);
    } catch (err) {
      // Nothing durable happened for this venue — that is THE failure mode
      // this seeder exists to prevent, so it is fatal, never a warn-and-move-on.
      failures.push(`${venue} store: ${err?.message || err}`);
      storeFailed = true;
      continue;
    }
    venueResults.push({
      venue,
      windowStart,
      objectKey,
      rowCount: rows.length,
      ...(rows.length === 0 ? { suspectEmpty: true } : {}),
    });
    console.log(`  [price-archive] ${venue}: ${rows.length} row(s) -> ${objectKey}`);
  }

  const rowCount = venueResults.reduce((sum, r) => sum + r.rowCount, 0);
  let redisFailed = false;

  // Companion writes run even on a fully failed cycle so health tracks the
  // WRITER's liveness (the settlements-loader pattern): a dead venue and a
  // dead archiver must be distinguishable.
  try {
    const prior = await readCoverage();
    const coverage = updateCoverage(prior, venueResults, now());
    await writeRedisJson(PRICE_ARCHIVE_COVERAGE_KEY, coverage, PRICE_ARCHIVE_COVERAGE_TTL_SECONDS);
    await writeRedisJson(PRICE_ARCHIVE_META_KEY, {
      fetchedAt: now(),
      recordCount: rowCount,
      sourceVersion: SOURCE_VERSION,
      windowsArchived: venueResults.length,
      ...(failures.length ? { failures } : {}),
    }, PRICE_ARCHIVE_COVERAGE_TTL_SECONDS);
  } catch (err) {
    redisFailed = true;
    failures.push(`redis companions: ${err?.message || err}`);
    console.warn(`  [price-archive] coverage/seed-meta write failed: ${err?.message || err}`);
  }

  const exitCode = venueResults.length === 0 || storeFailed
    ? 1
    : (failures.length > 0 || redisFailed ? DEGRADED_EXIT_CODE : 0);
  return { exitCode, rowCount, venueResults, failures };
}

if (DIRECT_RUN) {
  const runStartedAt = Date.now();
  runArchiveCycle().then((result) => {
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(1);
    if (result.exitCode === 0) {
      console.log(`[seed] prediction/price-archive OK — ${result.rowCount} rows across ${result.venueResults.length} venue window(s) in ${elapsed}s`);
    } else {
      console.error(`[seed] prediction/price-archive ${result.exitCode === 1 ? 'FAILED' : 'DEGRADED'} (exit ${result.exitCode}) — ${result.failures.join('; ')}`);
    }
    process.exit(result.exitCode);
  }).catch((err) => {
    console.error(`FATAL: ${err?.message || err}`);
    process.exit(1);
  });
}
