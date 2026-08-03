import type { KrakenMarketSnapshot, KrakenQuote } from '@/types';
import { getHydratedData } from '@/services/bootstrap';

/**
 * Kraken spot markets — public API, seeded on the slow bootstrap tier.
 *
 * Kraken is the ONE venue authorized for ingest + re-serve (CONTEXT.md
 * boundary 1, v4 amendment). There is deliberately NO RPC fallback and no
 * client-side Kraken fetch: the owner-imposed condition on that permission is
 * a gentle, centralized cadence, and one seeder on the 45-min loop is the
 * whole request budget. A browser calling Kraken per-visitor would multiply
 * it uncontrollably.
 */

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Contract-mode seeds arrive as `{_seed, data}`; unwrap defensively. */
function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const inner = obj.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return obj;
}

function toQuote(raw: Record<string, unknown>): KrakenQuote | null {
  const last = num(raw.last);
  if (last === null || last <= 0) return null;
  return {
    pair: String(raw.pair ?? ''),
    internalPair: String(raw.internalPair ?? ''),
    base: String(raw.base ?? ''),
    quote: String(raw.quote ?? 'USD'),
    display: String(raw.display ?? raw.pair ?? ''),
    last,
    bid: num(raw.bid),
    ask: num(raw.ask),
    openToday: num(raw.openToday),
    high24h: num(raw.high24h),
    low24h: num(raw.low24h),
    vwap24h: num(raw.vwap24h),
    volume24hBase: num(raw.volume24hBase),
    trades24h: num(raw.trades24h),
    prevDailyClose: num(raw.prevDailyClose),
    changeSinceOpenPct: num(raw.changeSinceOpenPct),
    changeSincePrevClosePct: num(raw.changeSincePrevClosePct),
    change7dPct: num(raw.change7dPct),
    change30dPct: num(raw.change30dPct),
    fetchedAt: toDate(raw.fetchedAt) ?? new Date(),
  };
}

export function parseKrakenSnapshot(raw: unknown): KrakenMarketSnapshot | null {
  const data = unwrap(raw);
  if (!data || data.sourceVenue !== 'kraken') return null;

  const quotes = Array.isArray(data.quotes)
    ? (data.quotes as Record<string, unknown>[]).map(toQuote).filter((q): q is KrakenQuote => q !== null)
    : [];
  if (quotes.length === 0) return null;

  return {
    sourceVenue: 'kraken',
    attribution: String(data.attribution ?? 'Market data from Kraken'),
    quotes,
    failedPairs: Array.isArray(data.failedPairs) ? (data.failedPairs as unknown[]).map(String) : [],
    requestedPairCount: typeof data.requestedPairCount === 'number' ? data.requestedPairCount : quotes.length,
    fetchedAt: toDate(data.fetchedAt) ?? new Date(),
  };
}

/**
 * Last successfully parsed snapshot.
 *
 * REQUIRED, not an optimisation — `getHydratedData` is a ONE-SHOT consume
 * (bootstrap.ts:68-72 deletes on read) and this loader runs repeatedly.
 * Same trap that erased the DEFCON badge in session 08; the panel renders
 * `fetchedAt` as an age, so a value that stops refreshing visibly ages
 * instead of passing itself off as current.
 */
let lastGood: KrakenMarketSnapshot | null = null;

/** Returns null only when no snapshot has EVER been available this session. */
export async function fetchKrakenMarkets(): Promise<KrakenMarketSnapshot | null> {
  const fresh = parseKrakenSnapshot(getHydratedData('krakenMarkets'));
  if (fresh) lastGood = fresh;
  return lastGood;
}

/** Test seam — drives the one-shot-hydration path deterministically. */
export function __resetKrakenCache(): void {
  lastGood = null;
}
