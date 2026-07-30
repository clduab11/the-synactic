import { describe, expect, it } from "vitest";

import { evaluatePolicy } from "../src/index.js";
import { makeGrant, makePolicy, NOW } from "./helpers.js";

describe("decision table rows", () => {
  it("read-allowed: allow effect + read classification + no side effects", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read" })],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "p1" });
  });

  it("read-allowed when the call declares read on a write-classified policy", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read", classification: "write" })],
      { toolName: "fs.read", classification: "read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed" });
  });

  it("policy-denied: deny effect beats read classification", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read", effect: "deny" })],
      { toolName: "fs.read", classification: "read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "policy-denied", policyId: "p1" });
  });

  it("policy-denied: deny effect beats a valid write grant", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          effect: "deny",
          classification: "write",
          approval: makeGrant(),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "policy-denied" });
  });

  it("write-requires-approval: write classification without a grant", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "write" })],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({
      decision: "require-approval",
      reasonCode: "write-requires-approval",
      policyId: "p1",
    });
  });

  it("write-requires-approval when the call declares write on a read-classified policy", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "read" })],
      { toolName: "fs.write", classification: "write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "write-requires-approval" });
  });

  it("approval-expired: expiresAt in the past", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ expiresAt: "2026-07-24T11:00:00.000Z" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });
  });

  it("approval-expired at the exact boundary expiresAt == now", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ expiresAt: "2026-07-24T12:00:00.000Z" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });
  });

  it("approval-expired one millisecond before now", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ expiresAt: "2026-07-24T11:59:59.999Z" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });
  });

  it("write-approved one millisecond after now (boundary complement)", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ expiresAt: "2026-07-24T12:00:00.001Z" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "write-approved" });
  });

  it("approval-already-used: single-use grant with usedAt set", () => {
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
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-already-used" });
  });

  it("expiry is checked before consumption (expired + used => approval-expired)", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({
            expiresAt: "2026-07-24T11:00:00.000Z",
            usedAt: "2026-07-24T10:30:00.000Z",
          }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });
  });

  it("write-approved: valid grant", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant(),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "write-approved", policyId: "p1" });
  });

  it("write-approved: multi-use grant ignores usedAt", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ singleUse: false, usedAt: "2026-07-24T11:30:00.000Z" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "write-approved" });
  });

  it("side-effect-not-allowed: single requested effect outside the allowlist", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "net.fetch", allowedSideEffects: ["egress:dns"] })],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http"] },
      { now: NOW },
    );
    expect(d).toMatchObject({
      decision: "deny",
      reasonCode: "side-effect-not-allowed",
      policyId: "p1",
    });
  });

  it("side-effect-not-allowed: the default allowlist is empty", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "net.fetch" })],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http"] },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "side-effect-not-allowed" });
  });

  it("side-effect-not-allowed: multiple requested effects with one bad entry", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "net.fetch", allowedSideEffects: ["egress:http"] })],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http", "egress:dns"] },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "side-effect-not-allowed" });
  });

  it("side-effect check precedes the policy effect (deny policy + forbidden effect)", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "net.fetch", effect: "deny" })],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http"] },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "side-effect-not-allowed" });
  });

  it("side-effect allowlist is never relaxed by a valid approval grant", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "net.publish",
          classification: "write",
          approval: makeGrant(),
        }),
      ],
      { toolName: "net.publish", requestedSideEffects: ["egress:http"] },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "side-effect-not-allowed" });
  });

  it("side effects inside the allowlist proceed to read-allowed", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "net.fetch",
          allowedSideEffects: ["egress:http", "egress:dns"],
        }),
      ],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http", "egress:dns"] },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed" });
  });

  it("only the winning policy's grant is considered (less specific grant not consulted)", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "wild",
          toolPattern: "fs.*",
          classification: "write",
          approval: makeGrant(),
        }),
        makePolicy({ policyId: "exact", toolPattern: "fs.write", classification: "write" }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({
      decision: "require-approval",
      reasonCode: "write-requires-approval",
      policyId: "exact",
    });
  });

  it("the winning policy's own grant applies (more specific policy carries the grant)", () => {
    const d = evaluatePolicy(
      [
        makePolicy({ policyId: "wild", toolPattern: "fs.*", classification: "write" }),
        makePolicy({
          policyId: "exact",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant(),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "write-approved", policyId: "exact" });
  });
});

describe("call descriptor defaults", () => {
  it("classification omitted => the read policy classification applies", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read", classification: "read" })],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed" });
  });

  it("classification omitted => the write policy classification applies", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.write", classification: "write" })],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "write-requires-approval" });
  });

  it("requestedSideEffects omitted => defaults to [] and passes an empty allowlist", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "net.fetch" })],
      { toolName: "net.fetch" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed" });
  });
});

describe("fail-closed edges", () => {
  it("unparseable expiresAt => approval-expired, never allow", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ expiresAt: "not-a-timestamp" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });
  });

  it("empty-string expiresAt => approval-expired", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ expiresAt: "" }),
        }),
      ],
      { toolName: "fs.write" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });
  });

  it("invalid injected now => approval-expired without crashing", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant(),
        }),
      ],
      { toolName: "fs.write" },
      { now: new Date("not-a-date") },
    );
    expect(d).toMatchObject({ decision: "require-approval", reasonCode: "approval-expired" });
  });

  it("invalid injected now never turns a write into an allow", () => {
    const d = evaluatePolicy(
      [
        makePolicy({
          policyId: "p1",
          toolPattern: "fs.write",
          classification: "write",
          approval: makeGrant({ singleUse: false }),
        }),
      ],
      { toolName: "fs.write" },
      { now: new Date(Number.NaN) },
    );
    expect(d.decision).not.toBe("allow");
    expect(d.reasonCode).toBe("approval-expired");
  });

  it("invalid injected now on the no-match path still default-denies without crashing", () => {
    const d = evaluatePolicy([], { toolName: "fs.read" }, { now: new Date("not-a-date") });
    expect(d).toMatchObject({ decision: "deny", reasonCode: "no-matching-policy" });
  });

  it("read-classified decisions do not depend on the clock", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read" })],
      { toolName: "fs.read" },
      { now: new Date("not-a-date") },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed" });
  });
});
