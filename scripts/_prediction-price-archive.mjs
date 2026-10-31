// Pure core for the prediction-market price archiver (backtest lane, build
// step 1). No I/O, no clock reads — the seeder shell injects both, so every
// path in here is hermetically testable.
//
// Contract highlights, each one a deliberate decision:
//   - UNCLIPPED universe. The bootstrap seeder publishes a curated pool
//     (yesPrice clipped to [10,90], volume floors, one market per event);
//     this archive keeps every market the venue returned, because the
//     0.90-0.99 tail is exactly where the calibration and sizing analysis
//     needs history the curated pool structurally cannot supply.
//   - VENUE-NATIVE units, per record. Kalshi prices are 0-1 dollar strings,
//     volume is lifetime contracts; Polymarket prices are 0-1 numbers,
//     volume is lifetime USD. Nothing here rescales or blends — a reader
//     that wants 0-100 does its own presentation math.
//   - Null over guess. An unreadable numeric is null, never 0 and never a
//     default; whole-string parsing rejects malformed prefixes ('0.12oops').
//   - Raw payloads ride inside every archive object. A parser bug found in
//     month three is recoverable from raw JSON and unrecoverable from
//     parsed columns.
//   - Observation vs ingestion time both recorded (look-ahead hygiene: the
//     backtester must filter on what was KNOWN, not what was true).
//   - Deterministic per-(venue, 30-min-window) object keys: a re-run of the
//     same window overwrites its own object — upsert, never duplicate.

export const ARCHIVE_SCHEMA_VERSION = 1;
export const ARCHIVE_WINDOW_MS = 30 * 60 * 1000;
export const ARCHIVE_KEY_PREFIX = 'seed-data/prediction-price-archive/v1';

// Redis companion keys. The coverage index is a plain JSON STRING (not a
// list/zset) on purpose: api/health.js probes standalone keys with STRLEN,
// and a non-string type would pin the key at REDIS_PARTIAL forever. The
// durable archive itself lives in the object store; this index is the
// bounded, health-probeable map of what recent windows exist, and the input
// to the backtester's archive-gap refusal gate.
export const PRICE_ARCHIVE_COVERAGE_KEY = 'prediction:price-archive:coverage:v1';
export const PRICE_ARCHIVE_META_KEY = 'seed-meta:prediction:price-archive';
// Durable (no TTL) marker the archiver SETs after its first cycle that archived
// at least one window and wrote its companions. api/health.js keeps the probe
// softened until this exists, then strict forever (activation-marker cutover).
export const PRICE_ARCHIVE_ACTIVATION_KEY = 'seed-activated:prediction:price-archive';
export const PRICE_ARCHIVE_COVERAGE_TTL_SECONDS = 45 * 24 * 60 * 60;

// ~8.3 days of 30-minute windows across two venues. Old windows leaving the
// index does NOT delete their objects — object keys are derivable from any
// (venue, window) pair, so deep history stays reachable without the index.
export const MAX_COVERAGE_WINDOWS = 400;

/**
 * Whole-string numeric parse: '' / null / '0.12oops' / 'n/a' are null, never
 * 0. Mirrors parseKalshiYesPrice's discipline in _prediction-scoring.mjs.
 */
function finiteOrNull(raw) {
  if (raw == null) return null;
  const str = typeof raw === 'number' ? raw : String(raw).trim();
  if (str === '') return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(raw) {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

export function archiveWindowStart(observedAtMs) {
  return Math.floor(observedAtMs / ARCHIVE_WINDOW_MS) * ARCHIVE_WINDOW_MS;
}

export function archiveObjectKey(venue, windowStartMs) {
  const d = new Date(windowStartMs);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
  // Gzipped: an uncompressed full-universe window measured 8-70 MB; the
  // raw-payload retention contract survives compression, disk budgets don't
  // survive its absence.
  return `${ARCHIVE_KEY_PREFIX}/${venue}/${yyyy}/${mm}/${dd}/${hhmm}.json.gz`;
}

/**
 * Kalshi trade-api/v2 events?with_nested_markets payload -> archive rows.
 * Field names verified against the live API 2026-08-28: prices are
 * `*_dollars` decimal strings, counts are `*_fp` fixed-point strings; the
 * legacy bare names (yes_bid, last_price, volume) no longer exist.
 * `liquidity_dollars` is deliberately not read: it is 0.0000 on every
 * market, an unpopulated field, not a measurement.
 */
export function parseKalshiArchiveRows(payload, { observedAt, ingestedAt }) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const rows = [];
  for (const event of events) {
    const markets = Array.isArray(event?.markets) ? event.markets : [];
    for (const market of markets) {
      const marketId = stringOrNull(market?.ticker);
      // No ticker means no stable identity to upsert or resolve against
      // later; an unaddressable row would poison joins, so skip it (the raw
      // payload still carries whatever it was).
      if (!marketId) continue;
      rows.push({
        venue: 'kalshi',
        marketId,
        eventId: stringOrNull(market?.event_ticker) ?? stringOrNull(event?.event_ticker),
        title: stringOrNull(market?.title) ?? stringOrNull(event?.title),
        subTitle: stringOrNull(market?.yes_sub_title),
        marketType: stringOrNull(market?.market_type),
        status: stringOrNull(market?.status),
        yesBid: finiteOrNull(market?.yes_bid_dollars),
        yesAsk: finiteOrNull(market?.yes_ask_dollars),
        last: finiteOrNull(market?.last_price_dollars),
        volume: finiteOrNull(market?.volume_fp),
        volume24h: finiteOrNull(market?.volume_24h_fp),
        openInterest: finiteOrNull(market?.open_interest_fp),
        yesBidSize: finiteOrNull(market?.yes_bid_size_fp),
        yesAskSize: finiteOrNull(market?.yes_ask_size_fp),
        closeTime: stringOrNull(market?.close_time),
        observedAt,
        ingestedAt,
      });
    }
  }
  return rows;
}

/**
 * Polymarket Gamma /events payload -> archive rows. `outcomes` and
 * `outcomePrices` arrive as JSON-ENCODED STRINGS (indexing the raw value
 * yields characters); bestBid/bestAsk are numbers but nullable. `markYes`
 * is the venue's outcomePrices mark for the Yes outcome — distinct from
 * `last` (lastTradePrice) — and is null for any market without a literal
 * Yes outcome, never a guess at which outcome "counts as" yes. Gamma
 * exposes no open interest; that field is null on every Polymarket row.
 */
export function parseGammaArchiveRows(payload, { observedAt, ingestedAt }) {
  const events = Array.isArray(payload) ? payload : [];
  const rows = [];
  for (const event of events) {
    const markets = Array.isArray(event?.markets) ? event.markets : [];
    for (const market of markets) {
      const marketId = stringOrNull(market?.id) ?? stringOrNull(market?.conditionId);
      if (!marketId) continue;
      rows.push({
        venue: 'polymarket',
        marketId,
        conditionId: stringOrNull(market?.conditionId),
        slug: stringOrNull(market?.slug),
        eventId: stringOrNull(event?.slug) ?? stringOrNull(event?.id),
        title: stringOrNull(market?.question) ?? stringOrNull(event?.title),
        marketType: null,
        status: market?.closed === true ? 'closed' : (market?.active === true ? 'active' : null),
        yesBid: finiteOrNull(market?.bestBid),
        yesAsk: finiteOrNull(market?.bestAsk),
        last: finiteOrNull(market?.lastTradePrice),
        markYes: extractYesMark(market),
        volume: roundVolume(finiteOrNull(market?.volumeNum)),
        volume24h: null,
        openInterest: null,
        closeTime: stringOrNull(market?.endDate),
        observedAt,
        ingestedAt,
      });
    }
  }
  return rows;
}

// Gamma volumes are USD floats with sub-cent noise; two decimals is the
// venue's own display precision. Prices are never rounded.
function roundVolume(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function extractYesMark(market) {
  const outcomes = parseJsonArray(market?.outcomes);
  const prices = parseJsonArray(market?.outcomePrices);
  if (!outcomes.length || outcomes.length !== prices.length) return null;
  const yesIndex = outcomes.findIndex((o) => String(o).trim().toLowerCase() === 'yes');
  if (yesIndex < 0) return null;
  return finiteOrNull(prices[yesIndex]);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The stored unit: one object per (venue, window) holding parsed rows AND
 * the raw payloads they came from. `suspectEmpty` marks a venue answering
 * with zero rows — archived (absence at time T is data the survivorship
 * analysis needs) but flagged, because an empty open-markets universe is
 * far more likely an upstream fault than a fact about the world.
 */
export function buildArchiveObject({
  venue, windowStart, observedAt, ingestedAt, requestSpec, rawPayloads, rows,
}) {
  const object = {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    venue,
    windowStart,
    observedAt,
    ingestedAt,
    requestSpec: requestSpec ?? {},
    rowCount: rows.length,
    rows,
    raw: rawPayloads,
  };
  if (rows.length === 0) object.suspectEmpty = true;
  return object;
}

/**
 * Bounded coverage index (see PRICE_ARCHIVE_COVERAGE_KEY above). Upserts on
 * (venue, windowStart); a malformed prior value is rebuilt from this run's
 * entries and flagged, never trusted and never fatal — the index is
 * derivable state, the objects are the truth.
 */
export function updateCoverage(prior, entries, nowMs) {
  const priorWindows = Array.isArray(prior?.windows) ? prior.windows : null;
  const byKey = new Map();
  for (const w of priorWindows ?? []) {
    if (w && typeof w === 'object' && Number.isFinite(Number(w.windowStart)) && typeof w.venue === 'string') {
      byKey.set(`${w.venue}@${w.windowStart}`, w);
    }
  }
  for (const entry of entries) {
    byKey.set(`${entry.venue}@${entry.windowStart}`, {
      venue: entry.venue,
      windowStart: entry.windowStart,
      objectKey: entry.objectKey,
      rowCount: entry.rowCount,
      ...(entry.suspectEmpty ? { suspectEmpty: true } : {}),
    });
  }
  const windows = [...byKey.values()]
    .sort((a, b) => a.windowStart - b.windowStart || a.venue.localeCompare(b.venue))
    .slice(-MAX_COVERAGE_WINDOWS);
  const coverage = {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    updatedAt: nowMs,
    windows,
  };
  if (prior != null && priorWindows === null) coverage.rebuilt = true;
  return coverage;
}

/**
 * The backtest refusal input: every expected window in [fromMs, toMs) that
 * the coverage index cannot vouch for, per venue. An empty coverage index
 * makes the whole range gaps — absence of the index is never evidence of
 * coverage. (Brief §build-order 5: "archive gap across the decision window
 * -> do not backtest that window.")
 */
export function detectCoverageGaps(coverage, venue, fromMs, toMs) {
  const have = new Set(
    (Array.isArray(coverage?.windows) ? coverage.windows : [])
      .filter((w) => w?.venue === venue)
      .map((w) => Number(w.windowStart)),
  );
  const gaps = [];
  for (let t = archiveWindowStart(fromMs); t < toMs; t += ARCHIVE_WINDOW_MS) {
    if (!have.has(t)) gaps.push(t);
  }
  return gaps;
}
