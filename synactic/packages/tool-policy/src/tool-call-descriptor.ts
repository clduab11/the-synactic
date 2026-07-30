import { ToolClassificationSchema } from "@the-synactic/contracts";
import { z } from "zod";

/**
 * Description of a single mediated tool call, as seen by the policy
 * evaluator.
 *
 * Deliberately carries NO tool arguments: the evaluator never sees
 * argument payloads, so decision reason codes/messages can never echo
 * arguments or secret material (docs/TOOL-POLICY.md principle c —
 * enforced structurally, not by convention).
 */
export const ToolCallDescriptorSchema = z.strictObject({
  /** Name of the tool being invoked (e.g. "fs.read"). */
  toolName: z.string().min(1),
  /**
   * Declared classification of this specific call. When absent, the
   * matched policy's classification applies ("defaults per policy match").
   */
  classification: ToolClassificationSchema.optional(),
  /**
   * External side effects the call would trigger. Every entry must be
   * covered by the matched policy's `allowedSideEffects` (principle d).
   */
  requestedSideEffects: z.array(z.string().min(1)).default([]),
  /** Correlation back to the triggering event (uuid), when known. */
  correlationId: z.uuid().optional(),
});

export type ToolCallDescriptor = z.infer<typeof ToolCallDescriptorSchema>;

export type ToolCallDescriptorInput = z.input<typeof ToolCallDescriptorSchema>;
