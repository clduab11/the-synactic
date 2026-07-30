import { z } from "zod";

import { SourceProvenanceSchema } from "./provenance.js";
import { SecretSafeRecordSchema } from "./secret-guard.js";
import { IsoTimestampSchema } from "./timestamp.js";

/** Policy decision over a tool call. */
export const ToolDecisionSchema = z.enum(["allow", "deny", "require-approval"]);

export type ToolDecision = z.infer<typeof ToolDecisionSchema>;

/**
 * Machine-readable reason code accompanying every decision
 * (kebab-case, e.g. "default-deny", "approval-expired").
 */
export const ReasonCodeSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "reason codes are kebab-case");

export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

/**
 * Auditable record of one mediated tool call and its policy decision
 * (Phase 1 contract per docs/TOOL-POLICY.md principle 5; the logging
 * transport/sink is deferred). Arguments and results are secret-guarded:
 * records carrying secret-shaped fields are rejected (principle c).
 */
export const ToolCallRecordSchema = z.strictObject({
  id: z.uuid(),
  toolName: z.string().min(1),
  arguments: SecretSafeRecordSchema,
  decision: ToolDecisionSchema,
  reasonCode: ReasonCodeSchema,
  policyId: z.string().min(1),
  timestamp: IsoTimestampSchema,
  provenance: SourceProvenanceSchema,
  /** Correlation back to the triggering SynacticEvent.id. */
  correlationId: z.uuid(),
  /** Tool output snapshot; null when the call produced none (e.g. denied). */
  results: SecretSafeRecordSchema.nullable(),
});

export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
