import {
  ToolCallRecordSchema,
  type IsoTimestamp,
  type SecretSafeRecord,
  type SourceProvenance,
  type ToolCallRecord,
} from "@the-synactic/contracts";

import type { PolicyDecision } from "./policy-decision.js";

/**
 * policyId written to records whose decision has no matching policy
 * (ToolCallRecordSchema requires a non-empty policyId; a default-deny
 * decision carries null).
 */
export const UNMATCHED_POLICY_ID = "unmatched";

export interface BuildToolCallRecordInput {
  /** Record id (uuid) — supplied by the caller; no RNG here (purity). */
  id: string;
  toolName: string;
  /**
   * Call arguments. Validated by contracts' secret guard during
   * ToolCallRecordSchema.parse — secret-shaped keys/values are
   * rejected (principle c).
   */
  arguments: SecretSafeRecord;
  decision: PolicyDecision;
  /** Decision timestamp (ISO 8601 with offset) — caller-supplied; no clock read here. */
  timestamp: IsoTimestamp;
  provenance: SourceProvenance;
  /** Correlation back to the triggering SynacticEvent.id (uuid). */
  correlationId: string;
  /** Tool output snapshot; defaults to null (e.g. denied calls). */
  results?: SecretSafeRecord | null;
}

/**
 * Minimal helper building a contracts ToolCallRecord from a policy
 * decision. Pure: id and timestamp are injected, never generated.
 * Validation (uuid shapes, kebab-case reason code, secret-guarded
 * arguments/results) is delegated to ToolCallRecordSchema.parse.
 */
export function buildToolCallRecord(input: BuildToolCallRecordInput): ToolCallRecord {
  return ToolCallRecordSchema.parse({
    id: input.id,
    toolName: input.toolName,
    arguments: input.arguments,
    decision: input.decision.decision,
    reasonCode: input.decision.reasonCode,
    policyId: input.decision.policyId ?? UNMATCHED_POLICY_ID,
    timestamp: input.timestamp,
    provenance: input.provenance,
    correlationId: input.correlationId,
    results: input.results ?? null,
  });
}
