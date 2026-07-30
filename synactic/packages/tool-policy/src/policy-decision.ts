import { ReasonCodeSchema, ToolDecisionSchema } from "@the-synactic/contracts";
import { z } from "zod";

/**
 * Machine-readable reason codes emitted by the evaluator.
 * Kebab-case per contracts' ReasonCodeSchema.
 */
export const ReasonCodes = {
  NoMatchingPolicy: "no-matching-policy",
  SideEffectNotAllowed: "side-effect-not-allowed",
  PolicyDenied: "policy-denied",
  ReadAllowed: "read-allowed",
  WriteRequiresApproval: "write-requires-approval",
  ApprovalExpired: "approval-expired",
  ApprovalAlreadyUsed: "approval-already-used",
  WriteApproved: "write-approved",
} as const;

export type PolicyReasonCode = (typeof ReasonCodes)[keyof typeof ReasonCodes];

/**
 * Human-readable message per reason code. These are compile-time
 * constants: they NEVER interpolate tool names, patterns, side-effect
 * names, arguments, or grant material, so secrets can never leak
 * through a decision message (docs/TOOL-POLICY.md principle c).
 */
export const REASON_MESSAGES: Readonly<Record<PolicyReasonCode, string>> = {
  "no-matching-policy": "No policy matches this tool; the default-deny posture applies.",
  "side-effect-not-allowed":
    "A requested side effect is not covered by the matched policy's allowlist.",
  "policy-denied": "The matched policy denies this call.",
  "read-allowed": "The read-classified call is allowed by the matched policy.",
  "write-requires-approval": "The write-classified call requires explicit human approval.",
  "approval-expired": "The approval grant expired before evaluation time; renewed approval is required.",
  "approval-already-used":
    "The single-use approval grant was already consumed; renewed approval is required.",
  "write-approved": "The write-classified call is allowed by a valid approval grant.",
};

/**
 * Outcome of one policy evaluation. `decision` and `reasonCode` reuse
 * the contracts ToolDecision/ReasonCode types; `policyId` is null when
 * no policy matched (default-deny).
 */
export const PolicyDecisionSchema = z.strictObject({
  decision: ToolDecisionSchema,
  reasonCode: ReasonCodeSchema,
  policyId: z.string().min(1).nullable(),
  message: z.string().min(1),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
