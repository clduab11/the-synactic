import type { ActionPolicy, ApprovalGrant } from "@the-synactic/contracts";
import { describe, expect, it } from "vitest";

import { buildToolCallRecord, evaluatePolicy, matchesToolPattern } from "../src/index.js";

const NOW = new Date("2026-07-24T12:00:00.000Z");

function makePolicy(
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

function makeGrant(over: Partial<ApprovalGrant> = {}): ApprovalGrant {
  return {
    grantedBy: "human-operator",
    grantedAt: "2026-07-24T10:00:00.000Z",
    expiresAt: "2026-07-24T13:00:00.000Z",
    singleUse: true,
    usedAt: null,
    ...over,
  };
}

describe("evaluatePolicy smoke", () => {
  it("denies when no policy matches (default-deny)", () => {
    const d = evaluatePolicy([], { toolName: "fs.read" }, { now: NOW });
    expect(d).toMatchObject({
      decision: "deny",
      reasonCode: "no-matching-policy",
      policyId: null,
    });
  });

  it("allows read-classified calls under an allow policy", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read" })],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "p1" });
  });

  it("denies under a deny-effect policy", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read", effect: "deny" })],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "policy-denied" });
  });

  it("denies side effects outside the allowlist even for read+allow", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "net.fetch" })],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http"] },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "side-effect-not-allowed" });
  });

  it("allows side effects inside the allowlist", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "net.fetch", allowedSideEffects: ["egress:http"] })],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http"] },
      { now: NOW },
    );
    expect(d.decision).toBe("allow");
  });

  it("requires approval for writes without a grant", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "write" })],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({
      decision: "require-approval",
      reasonCode: "write-requires-approval",
    });
  });

  it("reports expired grants, including the expiresAt == now boundary", () => {
    const policy = makePolicy({
      policyId: "p1",
      toolPattern: "fs.write",
      classification: "write",
      approval: makeGrant({ expiresAt: "2026-07-24T11:00:00.000Z" }),
    });
    const d = evaluatePolicy([policy], { toolName: "fs.write" }, { now: NOW });
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });

    const boundary = makePolicy({
      policyId: "p2",
      toolPattern: "fs.write",
      classification: "write",
      approval: makeGrant({ expiresAt: "2026-07-24T12:00:00.000Z" }),
    });
    const d2 = evaluatePolicy([boundary], { toolName: "fs.write" }, { now: NOW });
    expect(d2).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });
  });

  it("reports consumed single-use grants", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ usedAt: "2026-07-24T11:30:00.000Z" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({
      decision: "require-approval",
      reasonCode: "approval-already-used",
    });
  });

  it("allows writes with a valid grant and never mutates inputs", () => {
    const grant = makeGrant();
    const policies = [
      makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "write", approval: grant }),
    ];
    const snapshot = JSON.stringify(policies);
    const d = evaluatePolicy(policies, { toolName: "fs.write" }, { now: NOW });
    expect(d).toMatchObject({ decision: "allow", reasonCode: "write-approved" });
    expect(JSON.stringify(policies)).toBe(snapshot);
    expect(grant.usedAt).toBeNull();
  });

  it("applies tie-breaking: most specific wins, then deny-over-allow", () => {
    const d = evaluatePolicy(
      [
        makePolicy({ policyId: "wild", toolPattern: "fs.*" }),
        makePolicy({ policyId: "exact", toolPattern: "fs.read", effect: "deny" }),
      ],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", policyId: "exact" });

    const d2 = evaluatePolicy(
      [
        makePolicy({ policyId: "allow-p", toolPattern: "fs.read" }),
        makePolicy({ policyId: "deny-p", toolPattern: "fs.read", effect: "deny" }),
      ],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d2).toMatchObject({ decision: "deny", policyId: "deny-p" });
  });

  it("falls back to the policy classification when the call omits it", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "write" })],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d.reasonCode).toBe("write-requires-approval");
  });
});

describe("matchesToolPattern", () => {
  it("matches exact names and trailing wildcards only", () => {
    expect(matchesToolPattern("fs.read", "fs.read")).toBe(true);
    expect(matchesToolPattern("fs.*", "fs.read")).toBe(true);
    expect(matchesToolPattern("fs.*", "fs")).toBe(false);
    expect(matchesToolPattern("*", "anything.at-all")).toBe(true);
    expect(matchesToolPattern("f*s", "fs")).toBe(false);
    expect(matchesToolPattern("fs.read", "fs.write")).toBe(false);
  });
});

describe("buildToolCallRecord smoke", () => {
  const provenance = {
    sourceId: "test-suite",
    sourceUri: "https://example.com/source",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    integrityHash: null,
  };

  it("builds a valid record, substituting the unmatched-policy sentinel", () => {
    const decision = evaluatePolicy([], { toolName: "fs.read" }, { now: NOW });
    const record = buildToolCallRecord({
      id: "123e4567-e89b-42d3-a456-426614174000",
      toolName: "fs.read",
      arguments: { path: "/tmp/x" },
      decision,
      timestamp: "2026-07-24T12:00:00.000Z",
      provenance,
      correlationId: "123e4567-e89b-42d3-a456-426614174001",
    });
    expect(record).toMatchObject({
      decision: "deny",
      reasonCode: "no-matching-policy",
      policyId: "unmatched",
      results: null,
    });
  });

  it("rejects secret-shaped arguments (principle c)", () => {
    const decision = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read" })],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(() =>
      buildToolCallRecord({
        id: "123e4567-e89b-42d3-a456-426614174000",
        toolName: "fs.read",
        arguments: { password: "hunter2" },
        decision,
        timestamp: "2026-07-24T12:00:00.000Z",
        provenance,
        correlationId: "123e4567-e89b-42d3-a456-426614174001",
      }),
    ).toThrow();
  });
});
