import type {
  ActionPolicy,
  ApprovalGrant,
  ToolDecision,
} from "@the-synactic/contracts";

import {
  REASON_MESSAGES,
  ReasonCodes,
  type PolicyDecision,
  type PolicyReasonCode,
} from "./policy-decision.js";
import {
  ToolCallDescriptorSchema,
  type ToolCallDescriptorInput,
} from "./tool-call-descriptor.js";

export interface EvaluatePolicyOptions {
  /**
   * Clock injection for determinism. Approval expiry is compared
   * against this instant (`expiresAt > now` required for validity).
   * Defaults to `new Date()` — the evaluator's ONLY non-injected clock
   * read. Pass `now` in tests/replays for fully deterministic
   * evaluation.
   */
  now?: Date;
}

/**
 * Tool-pattern matching. A single trailing "*" is the ONLY wildcard and
 * acts as a prefix match: "fs.*" matches "fs.read" (but not "fs"), and
 * "*" matches every tool name. Every other character (including "*" in
 * any other position) is literal. Exact string equality always matches.
 */
export function matchesToolPattern(toolPattern: string, toolName: string): boolean {
  if (toolPattern === toolName) return true;
  if (toolPattern.endsWith("*")) {
    return toolName.startsWith(toolPattern.slice(0, -1));
  }
  return false;
}

interface RankedPolicy {
  readonly policy: ActionPolicy;
  /** Length of the literal (non-wildcard) prefix — specificity metric. */
  readonly prefixLength: number;
  /** True when the pattern carries no trailing wildcard. */
  readonly exact: boolean;
}

/**
 * Deterministic tie-breaking when several policies match:
 *   1. most specific pattern wins (longer literal prefix first);
 *   2. an exact pattern beats a trailing-wildcard pattern of equal
 *      prefix length;
 *   3. deny-over-allow (a "deny" effect beats an "allow" effect);
 *   4. policyId ascending (lexicographic) as the final stable key.
 * Array.prototype.sort is stable, so fully identical entries keep
 * their input order — the outcome is always deterministic.
 */
function compareRanked(a: RankedPolicy, b: RankedPolicy): number {
  if (a.prefixLength !== b.prefixLength) return b.prefixLength - a.prefixLength;
  if (a.exact !== b.exact) return a.exact ? -1 : 1;
  if (a.policy.effect !== b.policy.effect) {
    return a.policy.effect === "deny" ? -1 : 1;
  }
  return a.policy.policyId.localeCompare(b.policy.policyId);
}

function makeDecision(
  decision: ToolDecision,
  reasonCode: PolicyReasonCode,
  policyId: string | null,
): PolicyDecision {
  return {
    decision,
    reasonCode,
    policyId,
    message: REASON_MESSAGES[reasonCode],
  };
}

/**
 * Returns the reason code that invalidates `grant` at `now`, or null
 * when the grant is valid. Expiry is checked before consumption.
 * Fail-closed: an unparseable `expiresAt` or an invalid injected `now`
 * yields "approval-expired" rather than ever allowing a write.
 */
function invalidGrantReason(grant: ApprovalGrant, now: Date): PolicyReasonCode | null {
  if (!(Date.parse(grant.expiresAt) > now.getTime())) {
    return ReasonCodes.ApprovalExpired;
  }
  if (grant.singleUse && grant.usedAt !== null) {
    return ReasonCodes.ApprovalAlreadyUsed;
  }
  return null;
}

/**
 * Pure, deterministic policy evaluator (docs/TOOL-POLICY.md).
 *
 * Purity contract:
 *   - zero I/O, zero side effects, zero network, zero logging;
 *   - the only clock access is `options.now`, defaulting to
 *     `new Date()`; inject `now` for fully deterministic evaluation;
 *   - inputs are never mutated: matching copies the policy list before
 *     sorting, and approval grants are read-only here. Marking a
 *     single-use grant consumed (`usedAt`) after a "write-approved"
 *     decision is the CALLER's responsibility — this function must not
 *     and does not mutate the grant.
 *
 * Input contract: `call` is validated with ToolCallDescriptorSchema
 * (invalid input throws ZodError — fail-fast). `policies` are trusted
 * as already-typed ActionPolicy values; validate them with
 * ActionPolicySchema at load time.
 *
 * Decision table (evaluated in this exact order):
 *   1. No matching policy                => deny             "no-matching-policy"     (policyId null)
 *   2. Any requestedSideEffects entry not in the matched policy's
 *      allowedSideEffects                => deny             "side-effect-not-allowed"
 *   3. Matched policy effect "deny"      => deny             "policy-denied"
 *   4. Effective classification "read"   => allow            "read-allowed"
 *   5. Effective classification "write", no grant
 *                                        => require-approval "write-requires-approval"
 *   6. Write, grant expired (expiresAt <= now)
 *                                        => require-approval "approval-expired"
 *   7. Write, single-use grant already consumed (usedAt set)
 *                                        => require-approval "approval-already-used"
 *   8. Write, valid grant                => allow            "write-approved"
 *
 * Effective classification = call.classification when declared, else
 * the matched policy's classification ("defaults per policy match").
 * Grants are scoped to the tool pattern structurally: an ApprovalGrant
 * lives on the policy, and only the single winning policy's grant is
 * considered — no cross-policy grant lookup.
 */
export function evaluatePolicy(
  policies: readonly ActionPolicy[],
  call: ToolCallDescriptorInput,
  options?: EvaluatePolicyOptions,
): PolicyDecision {
  const descriptor = ToolCallDescriptorSchema.parse(call);
  const now = options?.now ?? new Date();

  const ranked: RankedPolicy[] = [];
  for (const policy of policies) {
    if (!matchesToolPattern(policy.toolPattern, descriptor.toolName)) continue;
    const exact = !policy.toolPattern.endsWith("*");
    ranked.push({
      policy,
      prefixLength: exact ? policy.toolPattern.length : policy.toolPattern.length - 1,
      exact,
    });
  }
  // `ranked` is a freshly built array — sorting it mutates no input.
  ranked.sort(compareRanked);

  const winner = ranked.at(0);
  if (winner === undefined) {
    return makeDecision("deny", ReasonCodes.NoMatchingPolicy, null);
  }
  const policy = winner.policy;

  // Principle d first: the side-effect allowlist is never relaxed by an
  // allow effect or an approval grant. The offending value is
  // deliberately not captured so it cannot leak into any message.
  const allowedSideEffects = new Set(policy.allowedSideEffects);
  const hasForbiddenSideEffect = descriptor.requestedSideEffects.some(
    (sideEffect) => !allowedSideEffects.has(sideEffect),
  );
  if (hasForbiddenSideEffect) {
    return makeDecision("deny", ReasonCodes.SideEffectNotAllowed, policy.policyId);
  }

  if (policy.effect === "deny") {
    return makeDecision("deny", ReasonCodes.PolicyDenied, policy.policyId);
  }

  const classification = descriptor.classification ?? policy.classification;
  if (classification === "read") {
    return makeDecision("allow", ReasonCodes.ReadAllowed, policy.policyId);
  }

  // classification === "write" — explicit human approval required (principle b).
  const grant = policy.approval;
  if (grant === null) {
    return makeDecision("require-approval", ReasonCodes.WriteRequiresApproval, policy.policyId);
  }
  const invalidReason = invalidGrantReason(grant, now);
  if (invalidReason !== null) {
    return makeDecision("require-approval", invalidReason, policy.policyId);
  }
  return makeDecision("allow", ReasonCodes.WriteApproved, policy.policyId);
}
