import { describe, expect, it } from "vitest";

import { ReasonCodeSchema, ToolCallRecordSchema, ToolDecisionSchema } from "./index.js";
import type { ToolCallRecord } from "./index.js";

const provenance = {
  sourceId: "unit-test",
  sourceUri: "https://example.com/tool",
  retrievedAt: "2026-07-24T11:59:00.000Z",
  integrityHash: null,
};

const validRecord = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  toolName: "fs.read",
  arguments: { path: "/tmp/data.txt" },
  decision: "deny",
  reasonCode: "default-deny",
  policyId: "policy-default",
  timestamp: "2026-07-24T12:00:00.000Z",
  provenance,
  correlationId: "9b2f8c1e-3d4a-4e5b-9c6d-7e8f9a0b1c2d",
  results: null,
};

describe("ToolCallRecordSchema", () => {
  it("parses a valid record with null results", () => {
    const parsed: ToolCallRecord = ToolCallRecordSchema.parse(validRecord);
    expect(parsed).toEqual(validRecord);
    expect(parsed.results).toBeNull();
  });

  it("parses a valid record with a results snapshot", () => {
    const withResults = {
      ...validRecord,
      decision: "allow",
      reasonCode: "policy-allow",
      results: { bytes: 42 },
    };
    expect(ToolCallRecordSchema.parse(withResults)).toEqual(withResults);
  });

  it.each(["allow", "deny", "require-approval"])("accepts decision %s", (decision) => {
    expect(ToolCallRecordSchema.safeParse({ ...validRecord, decision }).success).toBe(true);
  });

  it.each(["approve", "ALLOW", "require_approval", ""])("rejects decision %s", (decision) => {
    expect(ToolCallRecordSchema.safeParse({ ...validRecord, decision }).success).toBe(false);
  });

  it.each(["default-deny", "a", "a1-b2-c3", "approval-expired"])(
    "accepts kebab-case reasonCode %s",
    (reasonCode) => {
      expect(ToolCallRecordSchema.safeParse({ ...validRecord, reasonCode }).success).toBe(true);
    },
  );

  it.each([
    "DefaultDeny",
    "default_deny",
    "default deny",
    "-default-deny",
    "default-deny-",
    "default--deny",
    "",
  ])("rejects non-kebab-case reasonCode %s", (reasonCode) => {
    expect(ToolCallRecordSchema.safeParse({ ...validRecord, reasonCode }).success).toBe(false);
  });

  it("requires correlationId", () => {
    const missing = { ...validRecord } as Record<string, unknown>;
    delete missing.correlationId;
    expect(ToolCallRecordSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects a non-uuid correlationId", () => {
    expect(
      ToolCallRecordSchema.safeParse({ ...validRecord, correlationId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejects missing provenance (provenance is REQUIRED)", () => {
    const missing = { ...validRecord } as Record<string, unknown>;
    delete missing.provenance;
    expect(ToolCallRecordSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects empty toolName and empty policyId", () => {
    expect(ToolCallRecordSchema.safeParse({ ...validRecord, toolName: "" }).success).toBe(false);
    expect(ToolCallRecordSchema.safeParse({ ...validRecord, policyId: "" }).success).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(ToolCallRecordSchema.safeParse({ ...validRecord, extra: 1 }).success).toBe(false);
  });

  it("rejects secret-shaped keys in arguments (principle c)", () => {
    const bad = { ...validRecord, arguments: { token: "abc" } };
    expect(ToolCallRecordSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects secret-shaped values in arguments (principle c)", () => {
    const bad = { ...validRecord, arguments: { note: "ghp_abcdefghijklmnopqrst" } };
    expect(ToolCallRecordSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects secret-shaped values in results (principle c)", () => {
    const bad = { ...validRecord, results: { output: "AKIAIOSFODNN7EXAMPLE" } };
    expect(ToolCallRecordSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a naive timestamp without zone", () => {
    expect(
      ToolCallRecordSchema.safeParse({ ...validRecord, timestamp: "2026-07-24T12:00:00" }).success,
    ).toBe(false);
  });
});

describe("ToolDecisionSchema / ReasonCodeSchema standalone", () => {
  it("ToolDecisionSchema accepts exactly the three documented decisions", () => {
    expect(ToolDecisionSchema.options).toEqual(["allow", "deny", "require-approval"]);
  });

  it("ReasonCodeSchema enforces kebab-case", () => {
    expect(ReasonCodeSchema.safeParse("default-deny").success).toBe(true);
    expect(ReasonCodeSchema.safeParse("notKebab").success).toBe(false);
  });
});
