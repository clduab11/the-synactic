/**
 * Deterministic focus-view body for the prediction-markets panel. No LLM.
 *
 * The compact panel renders 15 records from ONE pool; bootstrap delivers all
 * three pools (~75 records) and three fields the panel never shows. This module
 * renders that surplus, which is the whole point of the focus view.
 *
 * Three honesty constraints drive the layout, all properties of the seeder:
 *
 *  1. Volume is NOT comparable across venues. Polymarket's is the EVENT-level
 *     total while the displayed price belongs to one child market; Kalshi's is
 *     the selected contract's own. Both are labelled with their basis.
 *  2. Price is not the same measurement either. Polymarket is outcomePrices[0],
 *     a live quote; Kalshi is last_price_dollars, the last trade, which on a
 *     thin market can be hours stale.
 *  3. True liquidity/depth is not published at all. We state that rather than
 *     drawing a depth bar we would be inventing.
 */
import type { PanelFocusView } from '@/components/Panel';
import type { PredictionMarket, PredictionPoolKey, PredictionPoolSnapshot } from '@/services/prediction';
import { t } from '@/services/i18n';
import { joinSafeHtml, safeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';

const MS_PER_DAY = 86_400_000;
/** Beyond this a probability says far more about the horizon than the event. */
const LONG_HORIZON_DAYS = 1825; // 5 years

/** Shared with the compact panel so both surfaces format a figure identically. */
export function formatVolume(volume?: number): string {
  if (!volume) return '';
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

/**
 * Reimplementation of scoreMarket from scripts/_prediction-scoring.mjs. It is
 * pure over {yesPrice, volume}, so the rank is exactly recomputable client-side.
 * Deliberately NOT imported: src/ imports only JSON from scripts/, and reaching
 * into a scripts/*.mjs would be new precedent outside the boundary-lint layers.
 */
export function scoreMarket(m: Pick<PredictionMarket, 'yesPrice' | 'volume'>): number {
  const conviction = (2 * Math.abs(m.yesPrice - 50)) / 100;
  const vol = Math.log10(Math.max(m.volume ?? 0, 1)) / Math.log10(10_000_000);
  return conviction * 0.5 + Math.min(vol, 1) * 0.5;
}

function poolLabel(key: PredictionPoolKey): string {
  if (key === 'tech') return t('components.predictionFocus.poolTech');
  if (key === 'finance') return t('components.predictionFocus.poolFinance');
  return t('components.predictionFocus.poolGeopolitical');
}

/**
 * Days until resolution, or null when unparseable. Multi-decade values are REAL
 * (Kalshi lists contracts out to 2099) — never clamp them; the horizon is the
 * signal.
 */
function daysToResolution(endDate: string | undefined, now: number): number | null {
  if (!endDate) return null;
  const ms = Date.parse(endDate);
  if (!Number.isFinite(ms)) return null;
  return Math.round((ms - now) / MS_PER_DAY);
}

function formatHorizon(days: number): string {
  if (days < 0) return t('components.predictionFocus.closed');
  if (days < 90) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function renderMarket(m: PredictionMarket, rank: number, now: number): SafeHtml {
  const isKalshi = m.source === 'kalshi';
  const yesPercent = Math.round(m.yesPrice);

  const priceBasis = isKalshi
    ? t('components.predictionFocus.basisLastTrade')
    : t('components.predictionFocus.basisQuote');
  const volumeBasis = isKalshi
    ? t('components.predictionFocus.basisContract')
    : t('components.predictionFocus.basisEventTotal');

  const volumeStr = formatVolume(m.volume);
  const volumeCell = volumeStr
    ? safeHtml`<span class="pfx-vol">${volumeStr}<span class="pfx-basis">${volumeBasis}</span></span>`
    : safeHtml`<span class="pfx-vol pfx-missing">${t('components.predictionFocus.volumeMissing')}</span>`;

  const days = daysToResolution(m.endDate, now);
  const horizonCell = days === null
    ? safeHtml`<span class="pfx-horizon pfx-missing">${t('components.predictionFocus.horizonUnknown')}</span>`
    : safeHtml`<span class="pfx-horizon${days >= LONG_HORIZON_DAYS ? ' pfx-long-horizon' : ''}"
        title="${m.endDate ?? ''}">${formatHorizon(days)}${
        days >= LONG_HORIZON_DAYS
          ? safeHtml`<span class="pfx-basis">${t('components.predictionFocus.longHorizon')}</span>`
          : ''
      }</span>`;

  const url = m.url ? safeUrlAttr(m.url) : null;
  const title = url
    ? safeHtml`<a class="pfx-title" href="${url}" target="_blank" rel="noopener">${m.title}</a>`
    : safeHtml`<span class="pfx-title">${m.title}</span>`;

  // Kalshi records publish NO tags at all — say so rather than rendering a blank
  // cell that reads as "we looked and there were none".
  const tags = m.tags ?? [];
  const regions = m.regions ?? [];
  const chips = [...tags.slice(0, 6), ...regions];
  const chipsCell = chips.length
    ? joinSafeHtml(chips.map((c) => safeHtml`<span class="pfx-chip">${c}</span>`), ' ')
    : safeHtml`<span class="pfx-missing">${t('components.predictionFocus.noTags')}</span>`;

  return safeHtml`<li class="pfx-row">
    <span class="pfx-rank">${rank}</span>
    <div class="pfx-main">
      <div class="pfx-head">
        <span class="pfx-source pfx-source-${isKalshi ? 'kalshi' : 'polymarket'}">${isKalshi ? 'Kalshi' : 'Polymarket'}</span>
        ${title}
      </div>
      <div class="pfx-meta">
        <span class="pfx-price">${yesPercent}%<span class="pfx-basis">${priceBasis}</span></span>
        ${volumeCell}
        ${horizonCell}
      </div>
      <div class="pfx-chips">${chipsCell}</div>
    </div>
  </li>`;
}

function renderPool(key: PredictionPoolKey, markets: PredictionMarket[], isRendered: boolean, now: number): SafeHtml {
  const ranked = [...markets].sort((a, b) => scoreMarket(b) - scoreMarket(a));
  const rows = joinSafeHtml(ranked.map((m, i) => renderMarket(m, i + 1, now)));
  const badge = isRendered
    ? safeHtml`<span class="pfx-pool-badge">${t('components.predictionFocus.shownInPanel')}</span>`
    : '';

  return safeHtml`<section class="pfx-pool">
    <h3 class="pfx-pool-title">${poolLabel(key)}<span class="pfx-pool-count">${markets.length}</span>${badge}</h3>
    <ol class="pfx-list">${rows}</ol>
  </section>`;
}

/**
 * Build the focus body from the captured pools. Returns null when no snapshot
 * exists — the panel took the RPC path, which returns one flat list with no pool
 * structure, so there is genuinely nothing richer to show and the overlay should
 * say so rather than repeat the compact view.
 */
export function buildPredictionFocusView(snapshot: PredictionPoolSnapshot | null): PanelFocusView | null {
  if (!snapshot || snapshot.pools.length === 0) return null;

  const now = Date.now();
  const total = snapshot.pools.reduce((n, p) => n + p.markets.length, 0);

  const disclosure = safeHtml`<p class="pfx-disclosure">
    ${t('components.predictionFocus.basisNote')} ${t('components.predictionFocus.liquidityNote')}
  </p>`;

  const pools = joinSafeHtml(
    snapshot.pools.map((p) => renderPool(p.key, p.markets, p.key === snapshot.renderedPool, now)),
  );

  return {
    subtitle: `${total} ${t('components.predictionFocus.marketsAcross')} ${snapshot.pools.length} ${t('components.predictionFocus.pools')}`,
    fetchedAt: snapshot.fetchedAt,
    body: safeHtml`<div class="pfx">${disclosure}${pools}</div>`,
  };
}
