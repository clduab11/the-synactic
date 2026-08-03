/**
 * Deterministic focus-view body for the stock-backtest panel. No LLM.
 *
 * The compact panel is a per-symbol summary table. Everything genuinely
 * interesting about a backtest — the individual simulated trades — is on the wire
 * already and thrown away, so this view renders the per-trade ledger plus the
 * seven response fields nothing displays.
 *
 * It also states four things the numbers do not say for themselves, all verified
 * against the engine rather than inferred:
 *
 *  1. Win rate and direction accuracy are THE SAME computation. They are equal on
 *     every symbol; showing both side by side implies two independent measures.
 *  2. Aggregates are computed over ALL evaluations, then the array is truncated to
 *     8 for the wire. "66 run, 8 shown" is the normal case, not an error.
 *  3. latestSignal is at least one full forward window old by construction — an
 *     evaluation only exists once its window has completed. It is NOT today's call.
 *  4. The engine is technical-only, and returns are gross: no slippage, no
 *     commission, no dividends, no position sizing. Cumulative return is a SUM of
 *     percentages, not a compounded equity curve.
 */
import type { PanelFocusView } from '@/components/Panel';
import type { StockBacktestResult } from '@/services/stock-backtest';
import { t } from '@/services/i18n';
import { joinSafeHtml, safeHtml, type SafeHtml } from '@/utils/sanitize';

function pct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function toneClass(value: number): string {
  if (value > 0) return 'sbx-up';
  if (value < 0) return 'sbx-down';
  return '';
}

function money(value: number, currency: string): string {
  if (!Number.isFinite(value)) return '—';
  const symbol = currency === 'USD' ? '$' : '';
  return `${symbol}${value.toFixed(2)}`;
}

function shortDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
    : '—';
}

/** One simulated trade. This is the row the compact panel has no room for. */
function renderEvaluation(
  e: StockBacktestResult['evaluations'][number],
  currency: string,
): SafeHtml {
  // outcome is the engine's own exit reason: stop_loss | take_profit | window_close.
  const outcomeKey = `components.stockBacktestFocus.outcome_${e.outcome}`;
  const outcomeLabel = t(outcomeKey);
  return safeHtml`<tr class="sbx-eval">
    <td class="sbx-date">${shortDate(e.analysisAt)}</td>
    <td class="sbx-signal">${e.signal}<span class="sbx-score">${e.signalScore}</span></td>
    <td class="sbx-num">${money(e.entryPrice, currency)}</td>
    <td class="sbx-num">${money(e.exitPrice, currency)}</td>
    <td class="sbx-num sbx-dim">${money(e.stopLoss, currency)}</td>
    <td class="sbx-num sbx-dim">${money(e.takeProfit, currency)}</td>
    <td class="sbx-num ${toneClass(e.simulatedReturnPct)}">${pct(e.simulatedReturnPct)}</td>
    <td class="sbx-outcome sbx-outcome-${e.outcome}">${
      outcomeLabel === outcomeKey ? e.outcome : outcomeLabel
    }</td>
    <td class="sbx-dir">${e.directionCorrect ? '✓' : '✕'}</td>
  </tr>`;
}

function renderSymbol(item: StockBacktestResult): SafeHtml {
  const currency = item.currency || 'USD';
  const evals = item.evaluations ?? [];

  if (!item.available) {
    // Never render the aggregates here: the engine ships them as 0 when a symbol
    // is unavailable, and a 0% win rate reads as a measurement rather than an
    // absence.
    return safeHtml`<section class="sbx-symbol sbx-unavailable">
      <h3 class="sbx-symbol-title">${item.display || item.symbol}</h3>
      <p class="sbx-missing">${item.summary || t('components.stockBacktestFocus.unavailable')}</p>
    </section>`;
  }

  const truncated = item.evaluationsRun > evals.length;

  return safeHtml`<section class="sbx-symbol">
    <h3 class="sbx-symbol-title">
      ${item.display || item.symbol}
      <span class="sbx-name">${item.name}</span>
    </h3>

    <div class="sbx-stats">
      <span class="sbx-stat"><b>${item.winRate.toFixed(2)}%</b>${t('components.stockBacktestFocus.winRate')}</span>
      <span class="sbx-stat"><b class="${toneClass(item.avgSimulatedReturnPct)}">${pct(item.avgSimulatedReturnPct)}</b>${t('components.stockBacktestFocus.avgReturn')}</span>
      <span class="sbx-stat"><b class="${toneClass(item.cumulativeSimulatedReturnPct)}">${pct(item.cumulativeSimulatedReturnPct)}</b>${t('components.stockBacktestFocus.sumReturn')}</span>
      <span class="sbx-stat"><b>${item.actionableEvaluations}/${item.evaluationsRun}</b>${t('components.stockBacktestFocus.actionable')}</span>
      <span class="sbx-stat"><b>${item.evalWindowDays}${t('components.stockBacktestFocus.barsSuffix')}</b>${t('components.stockBacktestFocus.window')}</span>
      <span class="sbx-stat"><b>${item.latestSignal || '—'}${
        item.latestSignalScore ? safeHtml`<span class="sbx-score">${item.latestSignalScore}</span>` : ''
      }</b>${t('components.stockBacktestFocus.latestSignal')}</span>
    </div>

    <p class="sbx-note">${t('components.stockBacktestFocus.staleSignalNote')}</p>

    ${evals.length > 0
      ? safeHtml`<table class="sbx-table">
          <thead><tr>
            <th>${t('components.stockBacktestFocus.colDate')}</th>
            <th>${t('components.stockBacktestFocus.colSignal')}</th>
            <th>${t('components.stockBacktestFocus.colEntry')}</th>
            <th>${t('components.stockBacktestFocus.colExit')}</th>
            <th>${t('components.stockBacktestFocus.colStop')}</th>
            <th>${t('components.stockBacktestFocus.colTarget')}</th>
            <th>${t('components.stockBacktestFocus.colReturn')}</th>
            <th>${t('components.stockBacktestFocus.colOutcome')}</th>
            <th>${t('components.stockBacktestFocus.colDir')}</th>
          </tr></thead>
          <tbody>${joinSafeHtml(evals.map((e) => renderEvaluation(e, currency)))}</tbody>
        </table>`
      : safeHtml`<p class="sbx-missing">${t('components.stockBacktestFocus.noTrades')}</p>`}

    ${truncated
      ? safeHtml`<p class="sbx-note sbx-truncation">${t('components.stockBacktestFocus.truncationNote')} ${evals.length}/${item.evaluationsRun}.</p>`
      : ''}

    <p class="sbx-provenance">${item.engineVersion} · ${item.ratingBasis} · ${currency}</p>
  </section>`;
}

/**
 * Build the backtest focus body. Returns null when there is nothing rendered yet,
 * so the overlay shows its own honest empty state rather than an empty shell.
 */
export function buildStockBacktestFocusView(
  items: StockBacktestResult[],
  fetchedAt: number | undefined,
): PanelFocusView | null {
  if (!items || items.length === 0) return null;

  const available = items.filter((i) => i.available).length;

  const disclosure = safeHtml`<p class="sbx-disclosure">
    ${t('components.stockBacktestFocus.engineNote')} ${t('components.stockBacktestFocus.sameMetricNote')}
  </p>`;

  return {
    subtitle: `${available}/${items.length} ${t('components.stockBacktestFocus.symbolsAvailable')}`,
    fetchedAt,
    body: safeHtml`<div class="sbx">${disclosure}${joinSafeHtml(items.map(renderSymbol))}</div>`,
  };
}
