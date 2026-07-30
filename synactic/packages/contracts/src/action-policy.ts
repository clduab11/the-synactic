import { z } from "zod";

import { IsoTimestampSchema } from "./timestamp.js";

/** Policy effect. Default-deny posture (principle a). */
export const PolicyEffectSchema = z.enum(["allow", "deny"]);

export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

/** Tool classification. Default read-only posture (principle a). */
export const ToolClassificationSchema = z.enum(["read", "write"]);

export type ToolClassification = z.infer<typeof ToolClassificationSchema>;

/**
 * Human approval grant for a write operation (principle b).
 * Expiry is REQUIRED; single-use grants are consumed via `usedAt`.
 */
export const ApprovalGrantSchema = z
  .strictObject({
    grantedBy: z.string().min(1),
    grantedAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
    singleUse: z.boolean().default(true),
    /** Consumption marker for single-use grants; null while unused. */
    usedAt: IsoTimestampSchema.nullable(),
  })
  .refine((grant) => Date.parse(grant.expiresAt) > Date.parse(grant.grantedAt), {
    message: "expiresAt must be after grantedAt",
  });

export type ApprovalGrant = z.infer<typeof ApprovalGrantSchema>;

export type ApprovalGrantInput = z.input<typeof ApprovalGrantSchema>;

/**
 * Explicit, auditable tool policy (docs/ABUSE-THREAT-MODEL.md:
 * policy enforcement is a defensive priority). Secure-by-default:
 * effect "deny", classification "read", no side effects allowed —
 * each relaxation must be opted into explicitly.
 */
export const ActionPolicySchema = z.strictObject({
  policyId: z.string().min(1),
  /**
   * Tool name or pattern this policy applies to
   * (e.g. "fs.read", "fs.*", "*").
   */
  toolPattern: z.string().min(1),
  effect: PolicyEffectSchema.default("deny"),
  classification: ToolClassificationSchema.default("read"),
  /** Approval grant for writes; null while no grant is active. */
  approval: ApprovalGrantSchema.nullable(),
  /** External side effects explicitly allowed (principle d). Default: none. */
  allowedSideEffects: z.array(z.string().min(1)).default([]),
});

export type ActionPolicy = z.infer<typeof ActionPolicySchema>;

export type ActionPolicyInput = z.input<typeof ActionPolicySchema>;
