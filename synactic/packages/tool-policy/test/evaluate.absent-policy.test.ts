import { describe, expect, it } from "vitest";

import { evaluatePolicy, REASON_MESSAGES } from "../src/index.js";
import { makePolicy, NOW } from "./helpers.js";

describe("evaluatePolicy default-deny (absent policy)", () => {
  it("denies with no-matching-policy when the policy list is empty", () => {
    const d = evaluatePolicy([], { toolName: "fs.read" }, { now: NOW });
    expect(d).toEqual({
      decision: "deny",
      reasonCode: "no-matching-policy",
      policyId: null,
      message: REASON_MESSAGES["no-matching-policy"],
    });
  });

  it("denies when policies exist but none match the tool name", () => {
    const d = evaluatePolicy(
      [
        makePolicy({ policyId: "p1", toolPattern: "fs.write" }),
        makePolicy({ policyId: "p2", toolPattern: "net.fetch" }),
        makePolicy({ policyId: "p3", toolPattern: "db.query" }),
      ],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toEqual({
      decision: "deny",
      reasonCode: "no-matching-policy",
      policyId: null,
      message: REASON_MESSAGES["no-matching-policy"],
    });
  });

  it("denies when wildcard patterns do not cover the tool", () => {
    const d = evaluatePolicy(
      [
        makePolicy({ policyId: "p1", toolPattern: "net.*" }),
        makePolicy({ policyId: "p2", toolPattern: "db.*" }),
      ],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({
      decision: "deny",
      reasonCode: "no-matching-policy",
      policyId: null,
    });
  });

  it("keeps policyId null even though candidate policies carry ids", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "candidate-id", toolPattern: "other.tool" })],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d.policyId).toBeNull();
    expect(d.message).toBe(REASON_MESSAGES["no-matching-policy"]);
  });

  it("default-denies write-classified calls without consulting any policy", () => {
    const d = evaluatePolicy([], { toolName: "fs.write", classification: "write" }, { now: NOW });
    expect(d).toMatchObject({ decision: "deny", reasonCode: "no-matching-policy" });
  });

  it("default-denies calls requesting side effects when nothing matches", () => {
    const d = evaluatePolicy(
      [],
      { toolName: "net.fetch", requestedSideEffects: ["egress:http"] },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "no-matching-policy" });
  });

  it("denies deterministically without an injected clock (default now)", () => {
    const d = evaluatePolicy([], { toolName: "fs.read" });
    expect(d).toEqual({
      decision: "deny",
      reasonCode: "no-matching-policy",
      policyId: null,
      message: REASON_MESSAGES["no-matching-policy"],
    });
  });
});
