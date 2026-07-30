import type { SynacticEvent } from "@the-synactic/contracts";

/** A single validation failure, normalized away from zod internals. */
export interface EnvelopeIssue {
  /** Machine-readable code (zod issue code or an envelope-specific code). */
  readonly code: string;
  /** Human-readable description. Never contains secret values. */
  readonly message: string;
  /** Path (object keys / array indices) to the offending location. */
  readonly path: readonly (string | number)[];
}

/**
 * Discriminated validation result. Validation failures NEVER throw —
 * they are reported as { ok: false, issues }.
 */
export type EventValidationResult =
  | { readonly ok: true; readonly event: SynacticEvent }
  | { readonly ok: false; readonly issues: readonly EnvelopeIssue[] };
