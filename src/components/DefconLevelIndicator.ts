import type { DefconLevelEstimate, DefconCommandStatus } from '@/types';
import { t } from '@/services/i18n';
import { h, replaceChildren } from '@/utils/dom-utils';
import { divergingCommands, shouldEscalate } from '@/services/defcon-level';

/**
 * DEFCON readiness-estimate indicator.
 *
 * Sits beside PizzIntIndicator in `.header-left` and is deliberately a SEPARATE
 * control: the two disagree by construction (PizzINT reads pizza-shop activity,
 * this reads a third party's OSINT assessment) and merging them into one badge
 * would imply a corroboration that does not exist.
 *
 * NOT an official DEFCON level — the US publishes none. The disclaimer row is
 * load-bearing, not decoration; do not make it dismissible or move it below the
 * fold of the pop-out.
 */

// Same hues as PizzIntIndicator so the two badges read on one scale.
// Black text clears WCAG AA 4.5:1 on every one of these; white fails on 4-5.
const DEFCON_COLORS: Record<number, string> = {
  1: '#ff0040',
  2: '#ff4400',
  3: '#ffaa00',
  4: '#00aaff',
  5: '#2d8a6e',
};

export class DefconLevelIndicator {
  private element: HTMLElement;
  private isExpanded = false;
  private estimate: DefconLevelEstimate | null = null;

  constructor() {
    const panel = h('div', { className: 'defcon-panel hidden' },
      h('div', { className: 'defcon-header' },
        h('span', { className: 'defcon-title' }, t('components.defcon.title')),
        h('button', {
          className: 'defcon-close',
          'aria-label': t('components.defcon.close'),
          onClick: () => { this.isExpanded = false; panel.classList.add('hidden'); },
        }, '×'),
      ),

      // Load-bearing. Every viewer sees this before any number.
      h('div', { className: 'defcon-disclaimer' },
        h('span', { className: 'defcon-disclaimer-icon' }, '⚠'),
        h('span', { className: 'defcon-disclaimer-text' }, t('components.defcon.disclaimer')),
      ),

      h('div', { className: 'defcon-status-bar' },
        h('div', { className: 'defcon-level-label' }),
        h('div', { className: 'defcon-level-desc' }),
      ),

      h('div', { className: 'defcon-diverging' }),

      h('div', { className: 'defcon-commands' },
        h('div', { className: 'defcon-commands-title' }, t('components.defcon.commandsTitle')),
        h('div', { className: 'defcon-commands-list' }),
      ),

      h('div', { className: 'defcon-synthetic' },
        h('div', { className: 'defcon-synthetic-title' }, t('components.defcon.syntheticTitle')),
        h('div', { className: 'defcon-synthetic-note' }, t('components.defcon.syntheticNote')),
        h('div', { className: 'defcon-synthetic-list' }),
      ),

      h('div', { className: 'defcon-footer' },
        h('span', { className: 'defcon-source' },
          t('components.defcon.source'), ' ',
          h('a', { href: 'https://www.defconlevel.com/', target: '_blank', rel: 'noopener noreferrer' }, 'defconlevel.com'),
        ),
        h('span', { className: 'defcon-operator' }),
        h('span', { className: 'defcon-updated' }),
      ),
    );

    this.element = h('div', { className: 'defcon-indicator' },
      h('button', {
        className: 'defcon-toggle',
        title: t('components.defcon.title'),
        'aria-expanded': 'false',
        onClick: () => {
          this.isExpanded = !this.isExpanded;
          panel.classList.toggle('hidden', !this.isExpanded);
          const btn = this.element.querySelector('.defcon-toggle');
          btn?.setAttribute('aria-expanded', String(this.isExpanded));
        },
      },
        h('span', { className: 'defcon-icon' }, '🛡'),
        h('span', { className: 'defcon-badge' }, '--'),
        // Permanent "estimate" marker on the collapsed badge, so the caveat
        // survives even when nobody opens the pop-out.
        h('span', { className: 'defcon-est-marker' }, t('components.defcon.estMarker')),
      ),
      panel,
    );
  }

  public updateEstimate(estimate: DefconLevelEstimate): void {
    this.estimate = estimate;
    this.render();
  }

  private render(): void {
    const est = this.estimate;
    if (!est) return;

    const color = DEFCON_COLORS[est.level] || '#888';

    const badgeEl = this.element.querySelector('.defcon-badge') as HTMLElement;
    badgeEl.textContent = t('components.defcon.badge', { level: String(est.level) });
    badgeEl.style.background = color;
    badgeEl.style.color = '#000';

    this.element.classList.toggle('escalated', shouldEscalate(est));

    const labelEl = this.element.querySelector('.defcon-level-label') as HTMLElement;
    labelEl.textContent = t(`components.defcon.levelNames.${est.level}`);
    labelEl.style.color = color;

    const descEl = this.element.querySelector('.defcon-level-desc') as HTMLElement;
    descEl.textContent = t(`components.defcon.levelDescs.${est.level}`);

    // Commands reading MORE severe than the headline — the detail a single
    // number discards.
    const divergingEl = this.element.querySelector('.defcon-diverging') as HTMLElement;
    const diverging = divergingCommands(est).filter((c) => c.isCombatantCommand);
    if (diverging.length > 0) {
      replaceChildren(divergingEl,
        h('span', { className: 'defcon-diverging-text' },
          t('components.defcon.diverging', {
            count: String(diverging.length),
            total: String(est.combatantCommandCount),
          }),
        ),
      );
      divergingEl.classList.remove('hidden');
    } else {
      replaceChildren(divergingEl);
      divergingEl.classList.add('hidden');
    }

    const listEl = this.element.querySelector('.defcon-commands-list') as HTMLElement;
    replaceChildren(listEl, ...est.commands.filter((c) => c.isCombatantCommand).map((c) => this.renderCommand(c, est)));

    const synthWrap = this.element.querySelector('.defcon-synthetic') as HTMLElement;
    const synthetic = est.commands.filter((c) => !c.isCombatantCommand);
    if (synthetic.length > 0) {
      const synthListEl = this.element.querySelector('.defcon-synthetic-list') as HTMLElement;
      replaceChildren(synthListEl, ...synthetic.map((c) => this.renderCommand(c, est)));
      synthWrap.classList.remove('hidden');
    } else {
      synthWrap.classList.add('hidden');
    }

    const operatorEl = this.element.querySelector('.defcon-operator') as HTMLElement;
    operatorEl.textContent = est.sourceOperator;

    // Two distinct timestamps. Showing only one would let a stale source look
    // fresh because WE polled recently.
    const updatedEl = this.element.querySelector('.defcon-updated') as HTMLElement;
    updatedEl.textContent = t('components.defcon.updated', {
      source: est.sourceUpdatedAt ? this.formatTimeAgo(est.sourceUpdatedAt) : t('components.defcon.unknownTime'),
      fetched: this.formatTimeAgo(est.fetchedAt),
    });
  }

  private renderCommand(c: DefconCommandStatus, est: DefconLevelEstimate): HTMLElement {
    const color = DEFCON_COLORS[c.level] || '#888';
    const isDiverging = c.level < est.level;
    return h('div', { className: `defcon-command${isDiverging ? ' diverging' : ''}` },
      h('span', { className: 'defcon-command-abbr' }, c.abbr),
      h('span', { className: 'defcon-command-name' }, c.name),
      h('span', {
        className: 'defcon-command-level',
        style: `background:${color};color:#000`,
      }, String(c.level)),
    );
  }

  private formatTimeAgo(date: Date): string {
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return t('components.defcon.justNow');
    if (diff < 3600000) return t('components.defcon.minutesAgo', { m: String(Math.floor(diff / 60000)) });
    if (diff < 86400000) return t('components.defcon.hoursAgo', { h: String(Math.floor(diff / 3600000)) });
    return t('components.defcon.daysAgo', { d: String(Math.floor(diff / 86400000)) });
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public hide(): void {
    this.element.style.display = 'none';
  }

  public show(): void {
    this.element.style.display = '';
  }
}
