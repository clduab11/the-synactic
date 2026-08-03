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
 * Last successfully parsed estimate.
 *
 * REQUIRED, not an optimisation. `getHydratedData` is a ONE-SHOT consume — it
 * deletes the key from the hydration cache on read (bootstrap.ts:68-72). This
 * loader runs more than once (the initial task list in data-loader.ts and the
 * periodic refresh registered in App.ts), so every call after the first sees
 * `undefined`. Without this the indicator renders on first paint and then
 * erases itself moments later.
 *
 * PizzINT does not hit this because it falls through to an RPC client; this
 * key has no RPC endpoint by design (dashboard-only, see the seeder header).
 *
 * Retaining the last good value is honest here: it is still real collected
 * data, and the pop-out already renders `fetchedAt` as a relative age, so a
 * value that stops refreshing visibly ages in the UI rather than silently
 * passing itself off as current.
 */
let lastGood: DefconLevelEstimate | null = null;

/**
 * Returns null only when no estimate has EVER been available this session.
 * Callers hide the indicator in that case.
 */
export async function fetchDefconEstimate(): Promise<DefconLevelEstimate | null> {
  const fresh = parseDefconEstimate(getHydratedData('defconLevel'));
  if (fresh) lastGood = fresh;
  return lastGood;
}

/** Test seam — lets a test drive the one-shot-hydration path deterministically. */
export function __resetDefconCache(): void {
  lastGood = null;
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
 * SETTLED 2026-08-03 (session 09): divergence breadth, retained deliberately
 * rather than by default. Two alternatives were on the table and both lose on
 * their merits, not on effort:
 *
 *   a) Level alone (`est.level <= 2`). The global estimate moves rarely, so the
 *      badge would sit inert for months and then jump — no gradient, and it
 *      discards the per-command detail the source actually publishes.
 *
 *   c) Change-since-last-seen. Best signal-to-noise in principle, but it makes
 *      the badge a function of THIS BROWSER'S history rather than of the world.
 *      Two operators would see different escalation states from identical data,
 *      it reads silent on first load (exactly when a new viewer needs it most),
 *      and it needs persisted state, which makes it impure — the component
 *      calls this on every render.
 *
 * Breadth wins because it is a pure function of the estimate, degrades
 * gracefully (an empty command list simply falls back to the level test), and
 * surfaces the spread a single headline number throws away — the same reason
 * the pop-out renders diverging commands as their own group.
 *
 * The threshold is 3 of the 11 real combatant commands. Synthetic trackers are
 * excluded on purpose: they are the publisher's own thematic products, not DoD
 * structure, and letting them trip a readiness badge would import their
 * editorial choices into ours.
 */
const DIVERGING_COMMANDS_TO_ESCALATE = 3;

export function shouldEscalate(est: DefconLevelEstimate): boolean {
  const diverging = divergingCommands(est).filter((c) => c.isCombatantCommand);
  return est.level <= 2 || diverging.length >= DIVERGING_COMMANDS_TO_ESCALATE;
}
