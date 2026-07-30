import type { ActionPolicy, ApprovalGrant, SourceProvenance } from "@the-synactic/contracts";

/** Fixed evaluation instant for deterministic tests (2026-07-24T12:00:00Z). */
export const NOW = new Date("2026-07-24T12:00:00.000Z");

export const RECORD_ID = "123e4567-e89b-42d3-a456-426614174000";
export const CORRELATION_ID = "123e4567-e89b-42d3-a456-426614174001";
export const TIMESTAMP = "2026-07-24T12:00:00.000Z";

export const PROVENANCE: SourceProvenance = {
  sourceId: "tool-policy-test-suite",
  sourceUri: "https://example.com/source",
  retrievedAt: "2026-07-24T11:59:00.000Z",
  integrityHash: null,
};

/** ActionPolicy factory: secure-by-relaxation defaults (allow/read/no grant/no side effects). */
export function makePolicy(
  over: Partial<ActionPolicy> & { policyId: string; toolPattern: string },
): ActionPolicy {
  return {
    effect: "allow",
    classification: "read",
    approval: null,
    allowedSideEffects: [],
    ...over,
  };
}

/** ApprovalGrant factory: valid at NOW (granted 10:00Z, expires 13:00Z, single-use, unused). */
export function makeGrant(over: Partial<ApprovalGrant> = {}): ApprovalGrant {
  return {
    grantedBy: "human-operator",
    grantedAt: "2026-07-24T10:00:00.000Z",
    expiresAt: "2026-07-24T13:00:00.000Z",
    singleUse: true,
    usedAt: null,
    ...over,
  };
}

/** Recursively Object.freeze a value (Date instances are frozen but not recursed into). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (!(value instanceof Date)) {
      for (const key of Object.keys(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
    Object.freeze(value);
  }
  return value;
}

/** All orderings of the input array (for tie-break determinism tests). */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i] as T;
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      out.push([head, ...perm]);
    }
  }
  return out;
}
