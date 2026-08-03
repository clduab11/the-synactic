/**
 * Panel focus view (pop-out) — the generic overlay half.
 *
 * A panel opts in with `focusable: true` and overrides `buildFocusView()`; this
 * module owns everything that is not panel-specific: the surface, the freshness
 * header, focus management, and teardown.
 *
 * Deliberately NOT named `*Panel.ts` — `panelKeyForComponentId` in vite.config.ts
 * matches that basename suffix and the build throws for any such file missing from
 * PANEL_CLUSTER.
 *
 * Portalled to `document.body` rather than reusing the `.live-news-fullscreen`
 * panel-takeover, for two reasons that are properties of the existing CSS, not
 * preferences: `.panel` sets `contain: content`, which makes it a containing block
 * for `position: fixed` descendants (an overlay appended inside a panel is clipped);
 * and `body.live-news-fullscreen-active` hides every non-fullscreen grid child, which
 * would blank this overlay whenever one of those modes is already open.
 */
import { createMarketChartFocusController } from '@/components/market-chart-interactions';
import type { PanelFocusView } from '@/components/Panel';
import { t } from '@/services/i18n';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { overlayHistory, type OverlayCloseOrigin } from '@/utils/overlay-history';
import { escapeHtml, safeHtmlToString } from '@/utils/sanitize';

type FocusController = ReturnType<typeof createMarketChartFocusController>;

let activeOverlay: HTMLElement | null = null;
let activeController: FocusController | null = null;
// Tracks whether WE pushed a history entry, so a close driven BY history
// ('history') or by the mobile tab bar ('replacement') does not try to pop again.
let historyRegistered = false;

/** Whether the focus view is currently on screen. */
export function isPanelFocusViewOpen(): boolean {
  return activeOverlay !== null;
}

/**
 * Render the data's age honestly. Returns null when the caller supplied no
 * timestamp — the header then says so rather than implying freshness we cannot
 * substantiate.
 */
function describeAge(fetchedAt: number | undefined): string | null {
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
  const ageMs = Date.now() - fetchedAt;
  if (ageMs < 0) return null;

  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return t('components.panelFocus.ageJustNow') ?? 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

function buildFreshnessHtml(fetchedAt: number | undefined): string {
  const age = describeAge(fetchedAt);
  if (age === null) {
    return `<span class="panel-focus-freshness panel-focus-freshness-unknown">${escapeHtml(
      t('components.panelFocus.ageUnknown') ?? 'Data age not published',
    )}</span>`;
  }
  const absolute = new Date(fetchedAt as number).toLocaleString();
  return `<span class="panel-focus-freshness" title="${escapeHtml(absolute)}">${escapeHtml(
    t('components.panelFocus.updated') ?? 'Updated',
  )} ${escapeHtml(age)}</span>`;
}

/** Close the focus view if open. Safe to call when nothing is open. */
export function closePanelFocusView(
  options: { restoreFocus?: boolean; origin?: OverlayCloseOrigin } = {},
): void {
  const { restoreFocus = true, origin = 'control' } = options;
  if (!activeOverlay) return;

  // Only unwind history when the user closed us directly. On origin "history" the
  // pop already happened; on 'replacement' (mobile tab tap) the manager owns it.
  if (origin === 'control' && historyRegistered) overlayHistory.close('panel-focus');
  historyRegistered = false;

  activeController?.deactivate({ restoreFocus });
  activeController = null;
  activeOverlay.remove();
  activeOverlay = null;
  document.body.classList.remove('panel-focus-open');
}

/**
 * Open the focus view for a panel. Single-instance: opening while one is already
 * on screen replaces it, so a stray second click cannot stack overlays.
 */
export function openPanelFocusView(opts: {
  panelId: string;
  title: string;
  /** Null is a legitimate runtime answer (no data yet) — the overlay then renders
   *  an honest empty state rather than the button appearing dead. */
  view: PanelFocusView | null;
  returnFocus?: HTMLElement | null;
}): void {
  const { panelId, title, view, returnFocus = null } = opts;

  // Replace rather than stack, and do not bounce focus back to the old trigger on
  // the way through — the new overlay is about to take it. Closed as "control" so
  // the prior history entry unwinds before a fresh one is pushed.
  closePanelFocusView({ restoreFocus: false });

  const overlay = document.createElement('div');
  overlay.className = 'panel-focus-overlay';
  overlay.dataset.panelFocus = panelId;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'panel-focus-title');

  const closeLabel = t('components.panel.closePanel') ?? 'Close';
  const subtitleHtml = view?.subtitle
    ? `<p class="panel-focus-subtitle">${escapeHtml(view.subtitle)}</p>`
    : '';

  const bodyHtml = view
    ? safeHtmlToString(view.body)
    : `<p class="panel-focus-empty">${escapeHtml(
        t('components.panelFocus.noDetail') ?? 'No additional detail is available for this panel yet.',
      )}</p>`;

  setTrustedHtml(
    overlay,
    trustedHtml(
      `<div class="panel-focus-surface">
        <header class="panel-focus-header">
          <div class="panel-focus-heading">
            <h2 id="panel-focus-title" class="panel-focus-title">${escapeHtml(title)}</h2>
            ${subtitleHtml}
          </div>
          <div class="panel-focus-header-meta">
            ${buildFreshnessHtml(view?.fetchedAt)}
            <button type="button" class="icon-btn panel-focus-close" aria-label="${escapeHtml(closeLabel)}" title="${escapeHtml(closeLabel)}">✕</button>
          </div>
        </header>
        <div class="panel-focus-body">${bodyHtml}</div>
      </div>`,
      'panel focus shell; title/subtitle escaped, body is a SafeHtml built by the panel',
    ),
  );

  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    // Backdrop click closes; clicks inside the surface do not.
    if (target === overlay || target?.closest('.panel-focus-close')) {
      closePanelFocusView();
    }
  });

  document.body.appendChild(overlay);
  document.body.classList.add('panel-focus-open');
  activeOverlay = overlay;

  // Reuse the existing capture-phase Escape + Tab-wrap controller rather than
  // adding a sixth hand-rolled focus trap to this codebase.
  activeController = createMarketChartFocusController(
    overlay,
    () => closePanelFocusView(),
    returnFocus,
  );
  activeController.activate(overlay.querySelector<HTMLElement>('.panel-focus-close'));

  // Registered on every viewport, not just mobile: browser Back should close a
  // modal surface everywhere. The callback receives the origin so we do not
  // double-pop when history itself drove the close.
  historyRegistered = true;
  overlayHistory.open('panel-focus', (origin) => closePanelFocusView({ origin }));
}
