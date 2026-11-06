import { Panel } from './Panel';
import type { KrakenMarketSnapshot, KrakenQuote } from '@/types';
import { escapeHtml, unsafeRawHtml } from '@/utils/sanitize';

/**
 * Kraken spot markets — the fork's one authorized venue surface (CONTEXT.md
 * boundary 1, v4). Renders the seeded snapshot only; this component never
 * calls Kraken itself (the owner-imposed cadence condition is enforced by
 * keeping the entire request budget in one seeder).
 *
 * Change columns are labelled by what they actually measure: vs the previous
 * DAILY close and vs 7d/30d closes — no rolling-24h claim is made anywhere.
 */

function fmtPrice(value: number): string {
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (value >= 1) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/** Null renders as an em dash — absent means "not measured", never 0. */
function fmtPct(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function toneClass(value: number | null): string {
  if (value === null) return 'kraken-flat';
  if (value > 0) return 'kraken-up';
  if (value < 0) return 'kraken-down';
  return 'kraken-flat';
}

export class KrakenMarketsPanel extends Panel {
  constructor() {
    super({
      id: 'kraken-markets',
      title: 'Kraken Spot',
      infoTooltip: 'Spot quotes for major crypto pairs from Kraken’s public market-data API, refreshed on a 45-minute seed cycle. Change columns measure against the previous daily close and 7d/30d closes — this is a trend surface, not a live tick feed.',
    });
  }

  public renderSnapshot(snapshot: KrakenMarketSnapshot | null): void {
    if (!snapshot || snapshot.quotes.length === 0) {
      this.setDataBadge('unavailable');
      this.showRetrying('Waiting for the Kraken market seed.');
      return;
    }

    this.setDataBadge('live', `${snapshot.quotes.length} pairs`);

    const rows = snapshot.quotes.map((q: KrakenQuote) => `
      <tr>
        <td class="kraken-pair"><strong>${escapeHtml(q.display)}</strong></td>
        <td class="kraken-num">${escapeHtml(fmtPrice(q.last))}</td>
        <td class="kraken-num ${toneClass(q.changeSincePrevClosePct)}">${escapeHtml(fmtPct(q.changeSincePrevClosePct))}</td>
        <td class="kraken-num ${toneClass(q.change7dPct)}">${escapeHtml(fmtPct(q.change7dPct))}</td>
        <td class="kraken-num ${toneClass(q.change30dPct)}">${escapeHtml(fmtPct(q.change30dPct))}</td>
      </tr>`).join('');

    const failedNote = snapshot.failedPairs.length > 0
      ? `<div class="kraken-failed">Unavailable this cycle: ${escapeHtml(snapshot.failedPairs.join(', '))}</div>`
      : '';

    this.setSafeContent(unsafeRawHtml(`
      <div class="kraken-markets">
        <table class="wm-table kraken-table">
          <thead>
            <tr>
              <th>Pair</th>
              <th class="kraken-num">Last</th>
              <th class="kraken-num" title="vs previous daily close">Δ Close</th>
              <th class="kraken-num" title="vs close 7 days ago">Δ 7d</th>
              <th class="kraken-num" title="vs close 30 days ago">Δ 30d</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${failedNote}
        <div class="kraken-attribution">${escapeHtml(snapshot.attribution)} · seeded ${escapeHtml(this.relativeAge(snapshot.fetchedAt))}</div>
      </div>
    `, 'legacy Panel.setContent() migration'));
  }

  private relativeAge(fetchedAt: Date): string {
    const mins = Math.max(0, Math.round((Date.now() - fetchedAt.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m ago`;
  }
}
