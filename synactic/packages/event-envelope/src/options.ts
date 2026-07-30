/**
 * Tunables for envelope creation/validation. All optional; sensible
 * defaults are applied by {@link resolveEnvelopeOptions}.
 */
export interface EnvelopeOptions {
  /** Max serialized payload size in bytes. Default: 64 KiB. */
  readonly maxPayloadBytes?: number;
  /** How far into the future an event timestamp may be. Default: 5 minutes. */
  readonly clockSkewToleranceMs?: number;
  /** Injectable clock for deterministic testing. Default: system clock. */
  readonly now?: () => Date;
}

/** Default maximum serialized payload size: 64 KiB. */
export const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;

/** Default tolerance for future-dated event timestamps: 5 minutes. */
export const DEFAULT_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** EnvelopeOptions with every field resolved to a concrete value. */
export interface ResolvedEnvelopeOptions {
  readonly maxPayloadBytes: number;
  readonly clockSkewToleranceMs: number;
  readonly now: () => Date;
}

const systemNow = (): Date => new Date();

/**
 * Resolves partial options to concrete values. Throws RangeError on
 * nonsensical numeric options (programmer error, not a validation failure).
 */
export function resolveEnvelopeOptions(options: EnvelopeOptions = {}): ResolvedEnvelopeOptions {
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const clockSkewToleranceMs = options.clockSkewToleranceMs ?? DEFAULT_CLOCK_SKEW_TOLERANCE_MS;
  const now = options.now ?? systemNow;
  if (!Number.isFinite(maxPayloadBytes) || maxPayloadBytes < 0) {
    throw new RangeError("maxPayloadBytes must be a non-negative finite number");
  }
  if (!Number.isFinite(clockSkewToleranceMs) || clockSkewToleranceMs < 0) {
    throw new RangeError("clockSkewToleranceMs must be a non-negative finite number");
  }
  return { maxPayloadBytes, clockSkewToleranceMs, now };
}
