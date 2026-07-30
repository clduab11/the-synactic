import { randomUUID } from "node:crypto";

import { ENVELOPE_VERSION } from "@the-synactic/contracts";
import type { SourceProvenance, SynacticEvent } from "@the-synactic/contracts";

import type { EnvelopeOptions } from "./options.js";
import { resolveEnvelopeOptions } from "./options.js";
import type { EventValidationResult } from "./result.js";
import { validateEvent } from "./validate.js";

/** Caller-supplied fields for {@link createEvent}. */
export interface CreateEventInput {
  /** Event type discriminator, e.g. "tool.invoked". */
  readonly type: string;
  /** Required source provenance (docs/ABUSE-THREAT-MODEL.md). */
  readonly provenance: SourceProvenance;
  /** Secret-safe structured payload (guarded at validation time). */
  readonly payload: Record<string, unknown>;
}

/**
 * Builds a SynacticEvent: fills id (node:crypto randomUUID) and timestamp
 * (options.now(), ISO 8601), pins version to ENVELOPE_VERSION, then runs
 * full validation (schema + secret guard + size + skew) before returning.
 * Never throws for validation failures.
 */
export function createEvent(input: CreateEventInput, options?: EnvelopeOptions): EventValidationResult {
  const opts = resolveEnvelopeOptions(options);
  const candidate: SynacticEvent = {
    version: ENVELOPE_VERSION,
    id: randomUUID(),
    type: input.type,
    timestamp: opts.now().toISOString(),
    provenance: input.provenance,
    payload: input.payload,
  };
  return validateEvent(candidate, opts);
}
