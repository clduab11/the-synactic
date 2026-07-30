import { z } from "zod";

import { IsoTimestampSchema } from "./timestamp.js";

/**
 * Verifiable source metadata. REQUIRED on every event and tool-call
 * record (docs/ABUSE-THREAT-MODEL.md: provenance integrity is the
 * first defensive priority; provenance spoofing is a named threat).
 */
export const SourceProvenanceSchema = z.strictObject({
  /** Stable identifier of the originating source. */
  sourceId: z.string().min(1),
  /** Resolvable location of the source. */
  sourceUri: z.url(),
  /** When the data was retrieved from the source. */
  retrievedAt: IsoTimestampSchema,
  /**
   * Content integrity hash slot — present by design, nullable until
   * a hashing pipeline fills it. Required key, explicit null allowed.
   */
  integrityHash: z.string().min(1).nullable(),
});

export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;
