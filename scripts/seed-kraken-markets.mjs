#!/usr/bin/env node
/**
 * Kraken spot market seed — first-class Kraken surface (panel + MCP).
 *
 * AUTHORIZATION, read before touching this file:
 *
 * Kraken market-data ingestion and re-serving (including to downstream MCP
 * consumers) was authorized by the owner on 2026-08-03 — CONTEXT.md boundary 1,
 * v4 amendment. Kraken ONLY: Binance, Coinbase and OANDA remain not-to-be-wired.
 * The permission came through Kraken's named channel (marketdata@kraken.com).
 *
 * BINDING CONDITION (owner-imposed, carried from the amendment): the
 * integration must not run up API credits or trip rate limits. Both hold here:
 *   - Kraken's market-data endpoints are PUBLIC — no key, no account, no
 *     credit pool. Limits are IP-based; Kraken documents >= 1s between calls.
 *   - This seeder makes 2 calls per pair (Ticker + daily OHLC), paced at
 *     1.1 s, once per seed-loop cycle (45 min). Four pairs = 8 calls / 45 min,
 *     ~340x gentler than the documented floor.
 *   - Do NOT "fix" a future rate-limit problem by spreading calls across IPs
 *     (boundary 2: no identity-cycling around a published quota), and do NOT
 *     shorten the cycle without re-doing this arithmetic.
 *
 * KRAKEN API SHAPE TRAPS (verified session 07, kept working session 09):
 *   - every numeric is a JSON STRING;
 *   - failure is reported INSIDE a 200 body (`error[]`), not a status code;
 *   - the result key is the INTERNAL pair name (XXBTZUSD, not XBTUSD) — this
 *     seeder calls one pair per request and takes the sole non-"last" key
 *     rather than hardcoding the internal-name mapping.
 *
 * HONEST FIELD NAMES: `changeSincePrevClosePct` is measured against the
 * previous DAILY close (equity convention), not a rolling 24h window, and
 * `changeSinceOpenPct` against today's open. Neither is called "24h" because
 * neither is a rolling 24h measurement.
 *
 * FAILS LOUDLY. If no pair parses, this throws rather than publishing an
 * empty snapshot — health shows STALE_SEED, never a silently empty panel.
 */

import { loadEnvFile, HONEST_UA, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'market:kraken:v1';
const API_BASE = 'https://api.kraken.com/0/public';
const CACHE_TTL = 10800; // 3h — strictly exceeds health maxStaleMin (135 min)
const FETCH_TIMEOUT_MS = 15_000;
const CALL_SPACING_MS = 1100; // Kraken documents >= 1s between public calls

/**
 * Requested with the PUBLIC pair alias; Kraken answers under its internal
 * name, which we discover from the response rather than hardcode.
 */
const PAIRS = [
  { pair: 'XBTUSD', base: 'BTC', quote: 'USD', display: 'BTC/USD' },
  { pair: 'ETHUSD', base: 'ETH', quote: 'USD', display: 'ETH/USD' },
  { pair: 'SOLUSD', base: 'SOL', quote: 'USD', display: 'SOL/USD' },
  { pair: 'XRPUSD', base: 'XRP', quote: 'USD', display: 'XRP/USD' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kraken numerics are strings; parse defensively, null on anything unfinite. */
function num(v) {
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctChange(current, reference) {
  if (current === null || reference === null || reference === 0) return null;
  return ((current - reference) / reference) * 100;
}

async function krakenGet(path) {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': HONEST_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`kraken HTTP ${resp.status} for ${path}`);
  const body = await resp.json();
  // Kraken reports failure in a 200 body, not a status code.
  if (Array.isArray(body?.error) && body.error.length > 0) {
    throw new Error(`kraken error for ${path}: ${body.error.join('; ')}`);
  }
  return body?.result ?? {};
}

/** The sole non-"last" entry is the requested pair under its internal name. */
function soleSeries(result) {
  const entry = Object.entries(result).find(([k]) => k !== 'last');
  return entry ? { internalPair: entry[0], value: entry[1] } : null;
}

async function fetchPair({ pair, base, quote, display }) {
  const ticker = soleSeries(await krakenGet(`/Ticker?pair=${encodeURIComponent(pair)}`));
  await sleep(CALL_SPACING_MS);
  const ohlc = soleSeries(await krakenGet(`/OHLC?pair=${encodeURIComponent(pair)}&interval=1440`));

  if (!ticker) return null;
  const t = ticker.value;
  const last = num(t?.c?.[0]);
  if (last === null) return null;

  // Daily rows: [time, open, high, low, close, vwap, volume, count] — strings.
  // The final row is the current (partial) day; the one before it closed.
  const rows = Array.isArray(ohlc?.value) ? ohlc.value : [];
  const closes = rows.map((r) => num(r?.[4])).filter((v) => v !== null && v > 0);
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : null;
  const close7d = closes.length >= 8 ? closes[closes.length - 8] : null;
  const close30d = closes.length >= 31 ? closes[closes.length - 31] : null;

  return {
    pair,
    internalPair: ticker.internalPair,
    base,
    quote,
    display,
    last,
    bid: num(t?.b?.[0]),
    ask: num(t?.a?.[0]),
    openToday: num(t?.o),
    high24h: num(t?.h?.[1]),
    low24h: num(t?.l?.[1]),
    vwap24h: num(t?.p?.[1]),
    volume24hBase: num(t?.v?.[1]),
    trades24h: num(t?.t?.[1]),
    prevDailyClose: prevClose,
    changeSinceOpenPct: pctChange(last, num(t?.o)),
    changeSincePrevClosePct: pctChange(last, prevClose),
    change7dPct: pctChange(last, close7d),
    change30dPct: pctChange(last, close30d),
    dailyBarCount: closes.length,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchKrakenMarkets() {
  const quotes = [];
  const failedPairs = [];
  for (const p of PAIRS) {
    try {
      const q = await fetchPair(p);
      if (q) quotes.push(q);
      else failedPairs.push(p.pair);
    } catch (err) {
      // Per-pair failure degrades honestly (failedPairs travels with the data);
      // total failure throws below.
      console.warn(`[seed-kraken] ${p.pair}: ${err.message}`);
      failedPairs.push(p.pair);
    }
    await sleep(CALL_SPACING_MS);
  }

  if (quotes.length === 0) {
    // Publishing an empty snapshot would render an empty panel with a fresh
    // timestamp — a silent failure. Fail loudly; health shows STALE_SEED.
    throw new Error(`kraken: all ${PAIRS.length} pairs failed (${failedPairs.join(', ')})`);
  }

  return {
    sourceVenue: 'kraken',
    sourceName: 'Kraken (public market-data API)',
    sourceUrl: 'https://api.kraken.com/0/public',
    // Boundary-1 v4: owner obtained Kraken's permission to ingest and re-serve,
    // including downstream over MCP. Carried in-band so a machine consumer
    // receives the scope with the data. See CONTEXT.md boundary 1.
    redistributionScope: 'kraken-authorized-2026-08-03',
    attribution: 'Market data from Kraken',
    quotes,
    failedPairs,
    requestedPairCount: PAIRS.length,
    fetchedAt: new Date().toISOString(),
  };
}

function validate(data) {
  return Array.isArray(data?.quotes)
    && data.quotes.length > 0
    && data.quotes.every((q) => Number.isFinite(q.last) && q.last > 0);
}

export function declareRecords(data) {
  return Array.isArray(data?.quotes) ? data.quotes.length : 0;
}

runSeed('market', 'kraken', CANONICAL_KEY, fetchKrakenMarkets, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'kraken-public-ticker-ohlc-v1',
  recordCount: (data) => (Array.isArray(data?.quotes) ? data.quotes.length : 0),
  declareRecords,
  schemaVersion: 1,
  maxStaleMin: 135,
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
