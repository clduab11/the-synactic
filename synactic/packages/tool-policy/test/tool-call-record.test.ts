import { ToolCallRecordSchema } from "@the-synactic/contracts";
import { describe, expect, it } from "vitest";

import {
  buildToolCallRecord,
  evaluatePolicy,
  UNMATCHED_POLICY_ID,
  type PolicyDecision,
} from "../src/index.js";
import {
  CORRELATION_ID,
  deepFreeze,
  makeGrant,
  makePolicy,
  NOW,
  PROVENANCE,
  RECORD_ID,
  TIMESTAMP,
} from "./helpers.js";

function decisionsByReasonCode(): Record<string, PolicyDecision> {
  return {
    "no-matching-policy": evaluatePolicy([], { toolName: "fs.read" }, { now: NOW }),
    "side-effect-not-allowed": evaluatePolicy(
      [makePolicy({ policyId: "p-side", toolPattern: "net.fetch" })],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http"] },
      { now: NOW },
    ),
    "policy-denied": evaluatePolicy(
      [makePolicy({ policyId: "p-deny", toolPattern: "fs.read", effect: "deny" })],
      { toolName: "fs.read" },
      { now: NOW },
    ),
    "read-allowed": evaluatePolicy(
      [makePolicy({ policyId: "p-read", toolPattern: "fs.read" })],
      { toolName: "fs.read" },
      { now: NOW },
    ),
    "write-requires-approval": evaluatePolicy(
      [makePolicy({ policyId: "p-write", toolPattern: "fs.write", classification: "write" })],
      { toolName: "fs.write" },
      { now: NOW },
    ),
    "approval-expired": evaluatePolicy(
      [
        makePolicy({
          policyId: "p-expired",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ expiresAt: "2026-07-24T11:00:00.000Z" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    ),
    "approval-already-used": evaluatePolicy(
      [
        makePolicy({
          policyId: "p-used",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ usedAt: "2026-07-24T11:30:00.000Z" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    ),
    "write-approved": evaluatePolicy(
      [
        makePolicy({
          policyId: "p-approved",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant(),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    ),
  };
}

function baseInput(decision: PolicyDecision) {
  return {
    id: RECORD_ID,
    toolName: "fs.read",
    arguments: { path: "/tmp/x" },
    decision,
    timestamp: TIMESTAMP,
    provenance: PROVENANCE,
    correlationId: CORRELATION_ID,
  };
}

describe("buildToolCallRecord", () => {
  it("builds a valid ToolCallRecord for every decision type", () => {
    for (const [code, decision] of Object.entries(decisionsByReasonCode())) {
      const record = buildToolCallRecord(baseInput(decision));
      expect(record.decision).toBe(decision.decision);
      expect(record.reasonCode).toBe(code);
      expect(record.policyId).toBe(decision.policyId ?? UNMATCHED_POLICY_ID);
      expect(record.results).toBeNull();
      expect(() => ToolCallRecordSchema.parse(record)).not.toThrow();
    }
  });

  it("substitutes the UNMATCHED_POLICY_ID sentinel only when policyId is null", () => {
    const unmatched = decisionsByReasonCode()["no-matching-policy"] as PolicyDecision;
    expect(unmatched.policyId).toBeNull();
    const record = buildToolCallRecord(baseInput(unmatched));
    expect(record.policyId).toBe(UNMATCHED_POLICY_ID);

    const matched = decisionsByReasonCode()["read-allowed"] as PolicyDecision;
    expect(matched.policyId).toBe("p-read");
    const matchedRecord = buildToolCallRecord(baseInput(matched));
    expect(matchedRecord.policyId).toBe("p-read");
  });

  it("exposes the sentinel value 'unmatched'", () => {
    expect(UNMATCHED_POLICY_ID).toBe("unmatched");
  });

  it("defaults results to null when omitted", () => {
    const record = buildToolCallRecord(baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision));
    expect(record.results).toBeNull();
  });

  it("keeps caller-supplied results", () => {
    const record = buildToolCallRecord({
      ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
      results: { bytes: 42 },
    });
    expect(record.results).toEqual({ bytes: 42 });
  });

  it("rejects secret-shaped argument keys (contracts guard)", () => {
    expect(() =>
      buildToolCallRecord({
        ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
        arguments: { password: "hunter2" },
      }),
    ).toThrow();
  });

  it("rejects secret-shaped argument values (contracts guard)", () => {
    expect(() =>
      buildToolCallRecord({
        ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
        arguments: { note: "sk-abcdefghijklmnopqrstuvwxyz" },
      }),
    ).toThrow();
  });

  it("rejects secret-shaped fields nested inside arguments", () => {
    expect(() =>
      buildToolCallRecord({
        ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
        arguments: { outer: { apiKey: "abc" } },
      }),
    ).toThrow();
    expect(() =>
      buildToolCallRecord({
        ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
        arguments: { list: ["ghp_abcdefghijklmnopqrstuvwxyz"] },
      }),
    ).toThrow();
  });

  it("rejects secret-shaped results", () => {
    expect(() =>
      buildToolCallRecord({
        ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
        results: { token: "abc" },
      }),
    ).toThrow();
  });

  it("accepts benign nested argument structures (no guard false positive)", () => {
    const record = buildToolCallRecord({
      ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
      arguments: { outer: { path: "/x" }, list: ["a", "b"] },
    });
    expect(record.arguments).toEqual({ outer: { path: "/x" }, list: ["a", "b"] });
  });

  it("rejects a non-uuid record id and correlationId", () => {
    expect(() =>
      buildToolCallRecord({
        ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
        id: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      buildToolCallRecord({
        ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
        correlationId: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("rejects a naive timestamp without an offset; accepts an explicit offset", () => {
    expect(() =>
      buildToolCallRecord({
        ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
        timestamp: "2026-07-24T12:00:00",
      }),
    ).toThrow();
    const record = buildToolCallRecord({
      ...baseInput(decisionsByReasonCode()["read-allowed"] as PolicyDecision),
      timestamp: "2026-07-24T14:00:00+02:00",
    });
    expect(record.timestamp).toBe("2026-07-24T14:00:00+02:00");
  });

  it("does not mutate its (frozen) input", () => {
    const input = deepFreeze(baseInput(decisionsByReasonCode()["write-approved"] as PolicyDecision));
    const snapshot = JSON.stringify(input);
    const record = buildToolCallRecord(input);
    expect(record.reasonCode).toBe("write-approved");
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
