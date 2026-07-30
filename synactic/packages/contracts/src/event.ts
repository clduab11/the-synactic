import { z } from "zod";

import { SourceProvenanceSchema } from "./provenance.js";
import { SecretSafeRecordSchema } from "./secret-guard.js";
import { IsoTimestampSchema } from "./timestamp.js";

/** Envelope format version carried by every SynacticEvent. */
export const ENVELOPE_VERSION = 1;

/**
 * Platform event envelope. Strict: unknown top-level fields are rejected.
 * No dedicated credential-carrying fields exist — and the payload is
 * secret-guarded, so secrets cannot ride the envelope (principle c).
 */
export const SynacticEventSchema = z.strictObject({
  version: z.literal(ENVELOPE_VERSION),
  id: z.uuid(),
  type: z.string().min(1),
  timestamp: IsoTimestampSchema,
  provenance: SourceProvenanceSchema,
  payload: SecretSafeRecordSchema,
});

export type SynacticEvent = z.infer<typeof SynacticEventSchema>;
