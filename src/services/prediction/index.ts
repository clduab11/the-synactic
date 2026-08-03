
import { getRpcBaseUrl } from '@/services/rpc-client';
import { createCircuitBreaker } from '@/utils';
import { SITE_VARIANT } from '@/config';
import { getHydratedData } from '@/services/bootstrap';

export interface PredictionMarket {
  title: string;
  yesPrice: number;     // 0-100 scale (legacy compat)
  volume?: number;
  url?: string;
  endDate?: string;
  source?: 'polymarket' | 'kalshi';
  regions?: string[];
  /** Seeder-published topic tags. Polymarket records carry these; Kalshi records
   *  publish an empty array, so any tag-driven filter must declare that gap. */
  tags?: string[];
  /** Best bid/ask AT THE TOUCH, normalized to the same 0-100 scale as yesPrice. */
  bestBid?: number;
  bestAsk?: number;
  /** Quoted spread as a percent of mid. A COST-TO-CROSS measure, NOT order-book
   *  depth — neither venue publishes a book through the seeded endpoints. */
  spreadPct?: number;
  /** Kalshi ONLY: contracts resting at the best bid/ask ($1 notional). Real book
   *  quantity, but only AT the touch — silent about one tick away. */
  topOfBookBidSize?: number;
  topOfBookAskSize?: number;
  /** Polymarket ONLY: venue-computed CLOB scalar. Named "venue…Score" because it
   *  is not a measured quantity and is NOT comparable to Kalshi contract counts. */
  venueLiquidityScore?: number;
}

export type PredictionPoolKey = 'geopolitical' | 'tech' | 'finance';

/**
 * The compact panel renders 15 records from ONE pool, but bootstrap delivers all
 * three pools (~75 records). The surplus is discarded at the slice, not at the
 * network boundary, so it costs nothing to retain a reference for the focus view.
 *
 * Pool membership is NOT recoverable from a record — it is implied purely by which
 * array the record arrived in — so the pools are kept keyed rather than flattened.
 */
export interface PredictionPoolSnapshot {
  pools: Array<{ key: PredictionPoolKey; markets: PredictionMarket[] }>;
  /** Upstream seed time from the bootstrap payload. */
  fetchedAt: number;
  /** When this snapshot was taken client-side. */
  capturedAt: number;
  /** The pool the compact panel actually rendered from, given SITE_VARIANT. */
  renderedPool: PredictionPoolKey;
}

let poolSnapshot: PredictionPoolSnapshot | null = null;
let poolFetchAttempted = false;

/**
 * True once fetchPredictions has been ENTERED at least once this session.
 * Lets a consumer tell "no snapshot yet" from "no snapshot, ever" — without it,
 * a pre-load reader cannot distinguish loading from genuinely-nothing.
 */
export function hasAttemptedPredictionFetch(): boolean {
  return poolFetchAttempted;
}

/**
 * Returns the last captured bootstrap pools, or null when the panel never took the
 * bootstrap path (e.g. it fell through to RPC, which returns one flat list with no
 * pool structure). Callers MUST treat null as "no richer view available" and say so,
 * rather than silently rendering the compact data twice.
 */
export function getPredictionPoolSnapshot(): PredictionPoolSnapshot | null {
  return poolSnapshot;
}

function isExpired(endDate?: string): boolean {
  if (!endDate) return false;
  const ms = Date.parse(endDate);
  return Number.isFinite(ms) && ms < Date.now();
}

const breaker = createCircuitBreaker<PredictionMarket[]>({ name: 'Polymarket', cacheTtlMs: 10 * 60 * 1000, persistCache: true });

const client = new PredictionServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) });

import predictionTags from '../../../scripts/data/prediction-tags.json';
import { PredictionServiceClient } from '@/services/generated-rpc-clients';

const GEOPOLITICAL_TAGS = predictionTags.geopolitical;
const TECH_TAGS = predictionTags.tech;
const FINANCE_TAGS = predictionTags.finance;

interface BootstrapPredictionData {
  geopolitical: PredictionMarket[];
  tech: PredictionMarket[];
  finance?: PredictionMarket[];
  fetchedAt: number;
}

const REGION_PATTERNS: Record<string, RegExp> = {
  america: /\b(us|u\.s\.|united states|america|trump|biden|congress|federal reserve|canada|mexico|brazil)\b/i,
  eu: /\b(europe|european|eu|nato|germany|france|uk|britain|macron|ecb)\b/i,
  mena: /\b(middle east|iran|iraq|syria|israel|palestine|gaza|saudi|yemen|houthi|lebanon)\b/i,
  asia: /\b(china|japan|korea|india|taiwan|xi jinping|asean)\b/i,
  latam: /\b(latin america|brazil|argentina|venezuela|colombia|chile)\b/i,
  africa: /\b(africa|nigeria|south africa|ethiopia|sahel|kenya)\b/i,
  oceania: /\b(australia|new zealand)\b/i,
};

function tagRegions(title: string): string[] {
  return Object.entries(REGION_PATTERNS)
    .filter(([, re]) => re.test(title))
    .map(([region]) => region);
}

function protoToMarket(m: { title: string; yesPrice: number; volume: number; url: string; closesAt: number; category: string; source?: string }): PredictionMarket {
  return {
    title: m.title,
    yesPrice: m.yesPrice * 100,
    volume: m.volume,
    url: m.url || undefined,
    endDate: m.closesAt ? new Date(m.closesAt).toISOString() : undefined,
    source: m.source === 'MARKET_SOURCE_KALSHI' ? 'kalshi' : 'polymarket',
    regions: tagRegions(m.title),
  };
}

function capturePoolSnapshot(hydrated: BootstrapPredictionData): void {
  const renderedPool: PredictionPoolKey = SITE_VARIANT === 'tech' ? 'tech'
    : SITE_VARIANT === 'finance' ? (hydrated.finance ? 'finance' : 'geopolitical')
    : 'geopolitical';

  const pools: PredictionPoolSnapshot['pools'] = [];
  for (const key of ['geopolitical', 'tech', 'finance'] as const) {
    const markets = hydrated[key];
    if (Array.isArray(markets) && markets.length > 0) pools.push({ key, markets });
  }

  poolSnapshot = {
    pools,
    fetchedAt: hydrated.fetchedAt,
    capturedAt: Date.now(),
    renderedPool,
  };
}

export async function fetchPredictions(opts?: { region?: string }): Promise<PredictionMarket[]> {
  // Set BEFORE breaker.execute, not inside its callback: the breaker resolves from
  // cache on several paths without ever invoking the callback, and with
  // persistCache a warm reload takes one of them — which would leave this false
  // forever and pin the focus view on "loading".
  poolFetchAttempted = true;

  const markets = await breaker.execute(async () => {
    const hydrated = getHydratedData('predictions') as BootstrapPredictionData | undefined;
    if (hydrated?.fetchedAt && Date.now() - hydrated.fetchedAt < 40 * 60 * 1000) {
      const variant = SITE_VARIANT === 'tech' ? hydrated.tech
        : SITE_VARIANT === 'finance' ? (hydrated.finance ?? hydrated.geopolitical)
        : hydrated.geopolitical;
      capturePoolSnapshot(hydrated);
      if (variant && variant.length > 0) {
        return variant
          .filter(m => !isExpired(m.endDate))
          .slice(0, 25)
          .map(m => m.source ? m : { ...m, source: 'polymarket' as const });
      }
    }

    const tags = SITE_VARIANT === 'tech' ? TECH_TAGS
      : SITE_VARIANT === 'finance' ? FINANCE_TAGS
      : GEOPOLITICAL_TAGS;
    const rpcResults = await client.listPredictionMarkets({
      category: tags[0] ?? '',
      query: '',
      pageSize: 50,
      cursor: '',
    });
    if (rpcResults.markets && rpcResults.markets.length > 0) {
      return rpcResults.markets
        .map(protoToMarket)
        .filter(m => !isExpired(m.endDate))
        .filter(m => m.yesPrice >= 10 && m.yesPrice <= 90)
        .sort((a, b) => {
          const aUncertainty = 1 - (2 * Math.abs(a.yesPrice - 50) / 100);
          const bUncertainty = 1 - (2 * Math.abs(b.yesPrice - 50) / 100);
          return bUncertainty - aUncertainty;
        })
        .slice(0, 25);
    }

    throw new Error('No markets returned — upstream may be down');
  }, []);

  if (opts?.region && opts.region !== 'global' && markets.length > 0) {
    const sorted = [...markets];
    sorted.sort((a, b) => {
      const aMatch = a.regions?.includes(opts.region!) ? 1 : 0;
      const bMatch = b.regions?.includes(opts.region!) ? 1 : 0;
      return bMatch - aMatch;
    });
    return sorted.slice(0, 15);
  }
  return markets.slice(0, 15);
}

const COUNTRY_SEARCH_ALIASES: Record<string, string[]> = {
  'United States': ['US', 'America', 'American', 'Trump', 'Biden', 'Fed', 'tariff'],
  'United Kingdom': ['UK', 'Britain', 'British'],
  'South Korea': ['Korea'],
  'United Arab Emirates': ['UAE', 'Dubai', 'Abu Dhabi'],
  'Saudi Arabia': ['Saudi', 'MBS'],
  'North Korea': ['DPRK', 'Pyongyang', 'Kim Jong'],
};

function countrySearchTerms(country: string): string[] {
  const terms = [country];
  const aliases = COUNTRY_SEARCH_ALIASES[country];
  if (aliases) terms.push(...aliases);
  return terms;
}

function matchesCountryTerms(title: string, terms: string[]): boolean {
  return terms.some(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title));
}

export async function fetchCountryMarkets(country: string): Promise<PredictionMarket[]> {
  const terms = countrySearchTerms(country);
  const allMarkets: PredictionMarket[] = [];

  // Try RPC across geopolitics + finance + tech (parallel; together they cover
  // every pool). `tech` is not optional here: since #5733 made the producer's
  // pools a disjoint partition, a tech-classified country market (a Chinese AI
  // model line, say) lives ONLY in the tech pool, and the early return below
  // fires as soon as any geopolitics/economy match is found — so without this
  // category the bootstrap fallback that also unions tech would never be reached
  // for any country that has a single geo or finance market.
  const rpcResults = await Promise.allSettled(
    (['geopolitics', 'economy', 'tech'] as const).map(category =>
      client.listPredictionMarkets({ category, query: country, pageSize: 30, cursor: '' })
    )
  );
  for (const result of rpcResults) {
    if (result.status === 'fulfilled' && result.value.markets?.length) {
      allMarkets.push(...result.value.markets.map(protoToMarket).filter(m => !isExpired(m.endDate)));
    }
  }

  if (allMarkets.length > 0) {
    // Filter by any matching term, deduplicate by URL, sort by volume
    const matched = allMarkets
      .filter(m => matchesCountryTerms(m.title, terms))
      .filter((m, i, arr) => arr.findIndex(x => x.url === m.url) === i)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 5);
    if (matched.length > 0) return matched;
  }

  // Fallback: search bootstrap data across all buckets. `tech` must be included
  // explicitly — until #5733 the geopolitical bucket was an unfiltered copy of
  // every market, so omitting tech here was invisible; now the buckets are a
  // disjoint partition and a tech-classified country market (e.g. a Chinese AI
  // model line) would be unreachable without it.
  const hydrated = getHydratedData('predictions') as BootstrapPredictionData | undefined;
  if (hydrated) {
    const buckets = [...(hydrated.geopolitical ?? []), ...(hydrated.tech ?? []), ...(hydrated.finance ?? [])];
    const filtered = buckets
      .filter(m => !isExpired(m.endDate) && matchesCountryTerms(m.title, terms))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 5);
    if (filtered.length > 0) return filtered;
  }

  return [];
}
