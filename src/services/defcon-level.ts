import type { DefconLevelEstimate, DefconCommandStatus, DefconEstimateLevel } from '@/types';
import { getHydratedData } from '@/services/bootstrap';

/**
 * DEFCON readiness estimate — defconlevel.com.
 *
 * NOT an official level. The United States publishes no DEFCON status; the real
 * one is classified. This is a private OSINT organization's estimate and every
 * consumer of this module must present it as such.
 *
 * There is deliberately NO RPC fallback here. The seed key rides the slow
 * bootstrap tier and nothing else serves it — if hydration has no value we
 * return null and the indicator hides. That is the intended behaviour: an
 * absent estimate must never be rendered as DEFCON 5, because "5" is a real
 * reading in this scale and inventing one would put a fabricated readiness
 * number in front of a human. Compare the `available: false` /
 * `winRate: 0` defect in backtest-stock.
 */

function isLevel(v: unknown): v is DefconEstimateLevel {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}

function toCommand(raw: Record<string, unknown>): DefconCommandStatus | null {
  const level = raw.level;
  if (!isLevel(level)) return null;
  return {
    id: String(raw.id ?? ''),
    abbr: String(raw.abbr ?? ''),
    name: String(raw.name ?? ''),
    level,
    // Default FALSE, not true: an unlabelled entry is treated as non-DoD rather
    // than promoted into the combatant-command group it may not belong to.
    isCombatantCommand: raw.isCombatantCommand === true,
    sourceUrl: String(raw.sourceUrl ?? ''),
  };
}

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * The seeder publishes in "contract" mode, so Redis holds `{_seed, data}`.
 * Older/bare payloads are accepted too — unwrap defensively rather than
 * assuming one shape survives an upstream change.
 */
function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const inner = obj.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return obj;
}

export function parseDefconEstimate(raw: unknown): DefconLevelEstimate | null {
  const data = unwrap(raw);
  if (!data) return null;

  const level = data.level;
  if (!isLevel(level)) return null;

  const commands = Array.isArray(data.commands)
    ? (data.commands as Record<string, unknown>[]).map(toCommand).filter((c): c is DefconCommandStatus => c !== null)
    : [];

  return {
    level,
    estimateType: 'osint-estimate',
    officialStatus: 'classified-not-published',
    sourceName: String(data.sourceName ?? 'defconlevel.com'),
    sourceUrl: String(data.sourceUrl ?? 'https://www.defconlevel.com/'),
    sourceOperator: String(data.sourceOperator ?? 'Private OSINT organization; not affiliated with the U.S. Government'),
    sourceUpdatedAt: toDate(data.sourceUpdatedAt),
    fetchedAt: toDate(data.fetchedAt) ?? new Date(),
    commands,
    combatantCommandCount: commands.filter((c) => c.isCombatantCommand).length,
    syntheticCommandCount: commands.filter((c) => !c.isCombatantCommand).length,
  };
}

/**
 * Returns null when no estimate is available. Callers hide the indicator.
 */
export async function fetchDefconEstimate(): Promise<DefconLevelEstimate | null> {
  return parseDefconEstimate(getHydratedData('defconLevel'));
}

/**
 * Commands whose estimate sits BELOW (i.e. more severe than) the global level.
 * Rendered as the "diverging" group in the pop-out — the part of the source's
 * output a single headline number throws away.
 */
export function divergingCommands(est: DefconLevelEstimate): DefconCommandStatus[] {
  return est.commands.filter((c) => c.level < est.level);
}

/**
 * Whether the indicator should visually escalate (pulse / accent) rather than
 * sit quiet in the header.
 *
 * TODO(chris): this is a product judgement, not a mechanical one — see the
 * trade-offs in the session notes. Three defensible readings:
 *
 *   a) Level alone.        `return est.level <= 2;`
 *      Simple and predictable, but the global level moves rarely, so the badge
 *      would sit inert for months at a time.
 *
 *   b) Divergence breadth. e.g. escalate when >= 3 combatant commands sit below
 *      the global level. Right now 5 of 11 do while the headline reads 3 — that
 *      spread is arguably the real signal and (a) shows none of it.
 *
 *   c) Change-since-last-seen. Escalate when the level moved since the operator
 *      last opened the pop-out. Highest signal-to-noise, but needs a persisted
 *      "last seen" value and will read as silent on first load.
 *
 * (b) is implemented below as a working default so the feature ships; swap in
 * whichever you want. Keep it a pure function of the estimate — the component
 * calls it on every render.
 */
export function shouldEscalate(est: DefconLevelEstimate): boolean {
  const diverging = divergingCommands(est).filter((c) => c.isCombatantCommand);
  return est.level <= 2 || diverging.length >= 3;
}
