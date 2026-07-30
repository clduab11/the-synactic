// Pure, deterministic tool-policy evaluator (docs/TOOL-POLICY.md).
export { evaluatePolicy, matchesToolPattern } from "./evaluate.js";
export type { EvaluatePolicyOptions } from "./evaluate.js";
export { PolicyDecisionSchema, REASON_MESSAGES, ReasonCodes } from "./policy-decision.js";
export type { PolicyDecision, PolicyReasonCode } from "./policy-decision.js";
export { ToolCallDescriptorSchema } from "./tool-call-descriptor.js";
export type {
  ToolCallDescriptor,
  ToolCallDescriptorInput,
} from "./tool-call-descriptor.js";
export { buildToolCallRecord, UNMATCHED_POLICY_ID } from "./tool-call-record.js";
export type { BuildToolCallRecordInput } from "./tool-call-record.js";
