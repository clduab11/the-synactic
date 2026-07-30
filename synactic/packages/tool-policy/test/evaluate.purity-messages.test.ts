import type { ActionPolicy, ToolDecision } from "@the-synactic/contracts";
import { describe, expect, it } from "vitest";

import {
  evaluatePolicy,
  PolicyDecisionSchema,
  REASON_MESSAGES,
  type PolicyReasonCode,
  type ToolCallDescriptorInput,
} from "../src/index.js";
import { deepFreeze, makeGrant, makePolicy, NOW } from "./helpers.js";

interface Scenario {
  readonly code: PolicyReasonCode;
  readonly expectedDecision: ToolDecision;
  readonly policies: ActionPolicy[];
  readonly call: ToolCallDescriptorInput;
}

/** One scenario per reason code in the decision table. */
function scenarios(): Scenario[] {
  return [
    {
      code: "no-matching-policy",
      expectedDecision: "deny",
      policies: [],
      call: { toolName: "fs.read" },
    },
    {
      code: "side-effect-not-allowed",
      expectedDecision: "deny",
      policies: [makePolicy({ policyId: "p1", toolPattern: "net.fetch" })],
      call: { toolName: "net.fetch", requestedSideEffects: ["egress:http"] },
    },
    {
      code: "policy-denied",
      expectedDecision: "deny",
      policies: [makePolicy({ policyId: "p1", toolPattern: "fs.read", effect: "deny" })],
      call: { toolName: "fs.read" },
    },
    {
      code: "read-allowed",
      expectedDecision: "allow",
      policies: [makePolicy({ policyId: "p1", toolPattern: "fs.read" })],
      call: { toolName: "fs.read" },
    },
    {
      code: "write-requires-approval",
      expectedDecision: "require-approval",
      policies: [makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "write" })],
      call: { toolName: "fs.write" },
    },
    {
      code: "approval-expired",
      expectedDecision: "require-approval",
      policies: [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ expiresAt: "2026-07-24T11:00:00.000Z" }),
        }),
      ],
      call: { toolName: "fs.write" },
    },
    {
      code: "approval-already-used",
      expectedDecision: "require-approval",
      policies: [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ usedAt: "2026-07-24T11:30:00.000Z" }),
        }),
      ],
      call: { toolName: "fs.write" },
    },
    {
      code: "write-approved",
      expectedDecision: "allow",
      policies: [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant(),
        }),
      ],
      call: { toolName: "fs.write" },
    },
  ];
}

describe("purity", () => {
  it("evaluates deep-frozen inputs without throwing (write-approved path)", () => {
    const grant = deepFreeze(makeGrant());
    const policy = deepFreeze(
      makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "write", approval: grant }),
    );
    const policies = deepFreeze([policy]);
    const call = deepFreeze({ toolName: "fs.write" });
    const d = evaluatePolicy(policies, call, { now: NOW });
    expect(d).toMatchObject({ decision: "allow", reasonCode: "write-approved" });
  });

  it("evaluates deep-frozen inputs with multiple matching policies (sort path)", () => {
    const policies = deepFreeze([
      makePolicy({ policyId: "wild", toolPattern: "fs.*" }),
      makePolicy({ policyId: "exact", toolPattern: "fs.read", effect: "deny" }),
      makePolicy({ policyId: "star", toolPattern: "*" }),
    ]);
    const call = deepFreeze({ toolName: "fs.read", requestedSideEffects: [] });
    const d = evaluatePolicy(policies, call, { now: NOW });
    expect(d).toMatchObject({ decision: "deny", reasonCode: "policy-denied", policyId: "exact" });
  });

  it("does not mutate the policy list, policies, grants, or the call descriptor", () => {
    const grant = makeGrant();
    const policies = [
      makePolicy({ policyId: "wild", toolPattern: "fs.*", classification: "write", approval: grant }),
      makePolicy({ policyId: "exact", toolPattern: "fs.write", classification: "write" }),
    ];
    const call = { toolName: "fs.write", requestedSideEffects: ["egress:none"] };
    const policiesSnapshot = JSON.stringify(policies);
    const callSnapshot = JSON.stringify(call);
    evaluatePolicy(policies, call, { now: NOW });
    expect(JSON.stringify(policies)).toBe(policiesSnapshot);
    expect(JSON.stringify(call)).toBe(callSnapshot);
  });

  it("leaves grant.usedAt null after a write-approved decision (caller marks consumption)", () => {
    const grant = makeGrant();
    const policies = [
      makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "write", approval: grant }),
    ];
    const d = evaluatePolicy(policies, { toolName: "fs.write" }, { now: NOW });
    expect(d).toMatchObject({ decision: "allow", reasonCode: "write-approved" });
    expect(grant.usedAt).toBeNull();
  });

  it("returns a fresh decision object per call with equal content (determinism)", () => {
    const policies = [makePolicy({ policyId: "p1", toolPattern: "fs.read" })];
    const call = { toolName: "fs.read" };
    const d1 = evaluatePolicy(policies, call, { now: NOW });
    const d2 = evaluatePolicy(policies, call, { now: NOW });
    expect(d1).not.toBe(d2);
    expect(d1).toEqual(d2);
  });

  it("does not mutate a frozen call descriptor requesting side effects", () => {
    const call = deepFreeze({ toolName: "net.fetch", requestedSideEffects: ["egress:http"] });
    const policies = [
      makePolicy({ policyId: "p1", toolPattern: "net.fetch", allowedSideEffects: ["egress:http"] }),
    ];
    const snapshot = JSON.stringify(call);
    const d = evaluatePolicy(policies, call, { now: NOW });
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed" });
    expect(JSON.stringify(call)).toBe(snapshot);
  });
});

describe("principle c: decision messages are static constants", () => {
  it("every reason code maps to its compile-time constant message", () => {
    for (const s of scenarios()) {
      const d = evaluatePolicy(s.policies, s.call, { now: NOW });
      expect(d.reasonCode).toBe(s.code);
      expect(d.decision).toBe(s.expectedDecision);
      expect(d.message).toBe(REASON_MESSAGES[s.code]);
    }
  });

  it("messages never interpolate the tool name", () => {
    const marker = "MARKER-9f8e7d-tool";
    const d = evaluatePolicy([], { toolName: `fs.read.${marker}` }, { now: NOW });
    expect(d.reasonCode).toBe("no-matching-policy");
    expect(d.message).not.toContain(marker);

    const allowed = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: `fs.read.${marker}` })],
      { toolName: `fs.read.${marker}` },
      { now: NOW },
    );
    expect(allowed.reasonCode).toBe("read-allowed");
    expect(allowed.message).not.toContain(marker);
  });

  it("messages never interpolate requested side-effect values", () => {
    const marker = "egress:MARKER-9f8e7d-secretish";
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "net.fetch" })],
      { toolName: "net.fetch", requestedSideEffects: [marker] },
      { now: NOW },
    );
    expect(d.reasonCode).toBe("side-effect-not-allowed");
    expect(d.message).not.toContain(marker);
    expect(d.message).not.toContain("MARKER-9f8e7d-secretish");
  });

  it("messages never interpolate the policyId or grant material", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "policy-MARKER-9f8e7d",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({
            grantedBy: "operator-MARKER-9f8e7d",
            expiresAt: "2026-07-24T11:00:00.000Z",
          }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d.reasonCode).toBe("approval-expired");
    expect(d.message).not.toContain("policy-MARKER-9f8e7d");
    expect(d.message).not.toContain("operator-MARKER-9f8e7d");
  });

  it("messages are identical across different call data for the same reason code", () => {
    const d1 = evaluatePolicy([], { toolName: "fs.read" }, { now: NOW });
    const d2 = evaluatePolicy([], { toolName: "totally.different.tool" }, { now: NOW });
    expect(d1.message).toBe(d2.message);
    expect(d1.message).toBe(
      "No policy matches this tool; the default-deny posture applies.",
    );
  });

  it("every decision satisfies PolicyDecisionSchema", () => {
    for (const s of scenarios()) {
      const d = evaluatePolicy(s.policies, s.call, { now: NOW });
      expect(() => PolicyDecisionSchema.parse(d)).not.toThrow();
    }
  });
});
