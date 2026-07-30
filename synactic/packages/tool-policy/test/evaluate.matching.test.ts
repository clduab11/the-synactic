import { describe, expect, it } from "vitest";

import { evaluatePolicy, matchesToolPattern } from "../src/index.js";
import { makePolicy, NOW, permutations } from "./helpers.js";

describe("matchesToolPattern", () => {
  it("exact equality matches", () => {
    expect(matchesToolPattern("fs.read", "fs.read")).toBe(true);
  });

  it("exact pattern does not match a different name", () => {
    expect(matchesToolPattern("fs.read", "fs.write")).toBe(false);
  });

  it("a trailing wildcard matches by literal prefix", () => {
    expect(matchesToolPattern("fs.*", "fs.read")).toBe(true);
    expect(matchesToolPattern("fs.*", "fs.write.deep")).toBe(true);
  });

  it("a trailing wildcard does not match the bare namespace", () => {
    expect(matchesToolPattern("fs.*", "fs")).toBe(false);
  });

  it("the wildcard prefix is literal (fs.* does not match fsx.read)", () => {
    expect(matchesToolPattern("fs.*", "fsx.read")).toBe(false);
  });

  it('"*" matches every tool name', () => {
    expect(matchesToolPattern("*", "anything.at-all")).toBe(true);
    expect(matchesToolPattern("*", "fs")).toBe(true);
    expect(matchesToolPattern("*", "x")).toBe(true);
  });

  it('"*" in a non-trailing position is literal', () => {
    expect(matchesToolPattern("f*s", "fs")).toBe(false);
    expect(matchesToolPattern("f*s", "f*s")).toBe(true);
    expect(matchesToolPattern("fs*read", "fsXread")).toBe(false);
    expect(matchesToolPattern("fs*read", "fs*read")).toBe(true);
  });

  it("a bare trailing star matches the prefix itself", () => {
    expect(matchesToolPattern("fs*", "fs")).toBe(true);
    expect(matchesToolPattern("fs*", "fs.read")).toBe(true);
  });

  it("matching is case-sensitive", () => {
    expect(matchesToolPattern("FS.*", "fs.read")).toBe(false);
    expect(matchesToolPattern("fs.*", "FS.read")).toBe(false);
  });
});

describe("evaluatePolicy matching", () => {
  it("selects an exact-match policy", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.read" })],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "p1" });
  });

  it("selects a trailing-wildcard policy", () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "fs.*" })],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "p1" });
  });

  it('selects the catch-all "*" policy', () => {
    const d = evaluatePolicy(
      [makePolicy({ policyId: "p1", toolPattern: "*" })],
      { toolName: "anything.at-all" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "p1" });
  });
});

describe("tie-breaking", () => {
  it("specificity precedes effect: an exact allow beats a wildcard deny", () => {
    const d = evaluatePolicy(
      [
        makePolicy({ policyId: "wild", toolPattern: "fs.*", effect: "deny" }),
        makePolicy({ policyId: "exact", toolPattern: "fs.read" }),
      ],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "exact" });
  });

  it("a longer wildcard prefix beats a shorter one", () => {
    const d = evaluatePolicy(
      [
        makePolicy({ policyId: "short", toolPattern: "fs.*" }),
        makePolicy({ policyId: "long", toolPattern: "fs.admin.*", effect: "deny" }),
      ],
      { toolName: "fs.admin.delete" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "deny", reasonCode: "policy-denied", policyId: "long" });
  });

  it("an exact pattern beats a trailing wildcard of equal literal-prefix length", () => {
    const d = evaluatePolicy(
      [
        makePolicy({ policyId: "p-wild", toolPattern: "fs.read*", effect: "deny" }),
        makePolicy({ policyId: "p-exact", toolPattern: "fs.read" }),
      ],
      { toolName: "fs.read" },
      { now: NOW },
    );
    expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "p-exact" });
  });

  it("deny beats allow at equal specificity, in both input orders", () => {
    const allow = makePolicy({ policyId: "a-allow", toolPattern: "fs.read" });
    const deny = makePolicy({ policyId: "z-deny", toolPattern: "fs.read", effect: "deny" });
    for (const ordering of [
      [allow, deny],
      [deny, allow],
    ]) {
      const d = evaluatePolicy(ordering, { toolName: "fs.read" }, { now: NOW });
      expect(d).toMatchObject({ decision: "deny", reasonCode: "policy-denied", policyId: "z-deny" });
    }
  });

  it("policyId ascending breaks full ties, in both input orders", () => {
    const first = makePolicy({ policyId: "p-a", toolPattern: "fs.read" });
    const second = makePolicy({ policyId: "p-b", toolPattern: "fs.read" });
    for (const ordering of [
      [first, second],
      [second, first],
    ]) {
      const d = evaluatePolicy(ordering, { toolName: "fs.read" }, { now: NOW });
      expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "p-a" });
    }
  });

  it("is deterministic across every input permutation (deny outcome)", () => {
    const policies = [
      makePolicy({ policyId: "p-star", toolPattern: "*" }),
      makePolicy({ policyId: "p-wild", toolPattern: "fs.*" }),
      makePolicy({ policyId: "p-exact", toolPattern: "fs.read", effect: "deny" }),
    ];
    for (const ordering of permutations(policies)) {
      const d = evaluatePolicy(ordering, { toolName: "fs.read" }, { now: NOW });
      expect(d).toMatchObject({ decision: "deny", reasonCode: "policy-denied", policyId: "p-exact" });
    }
  });

  it("is deterministic across every input permutation (allow outcome)", () => {
    const policies = [
      makePolicy({ policyId: "p-star", toolPattern: "*" }),
      makePolicy({ policyId: "p-wild", toolPattern: "fs.*" }),
      makePolicy({ policyId: "p-exact", toolPattern: "fs.read", effect: "deny" }),
    ];
    for (const ordering of permutations(policies)) {
      const d = evaluatePolicy(ordering, { toolName: "fs.write" }, { now: NOW });
      expect(d).toMatchObject({ decision: "allow", reasonCode: "read-allowed", policyId: "p-wild" });
    }
  });
});
