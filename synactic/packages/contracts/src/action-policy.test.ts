import { describe, expect, it } from "vitest";

import { ActionPolicySchema, ApprovalGrantSchema } from "./index.js";
import type {
  ActionPolicy,
  ActionPolicyInput,
  ApprovalGrant,
  ApprovalGrantInput,
} from "./index.js";

const minimalInput: ActionPolicyInput = {
  policyId: "policy-default",
  toolPattern: "fs.*",
  approval: null,
};

const validGrant: ApprovalGrantInput = {
  grantedBy: "operator@example.com",
  grantedAt: "2026-07-24T12:00:00.000Z",
  expiresAt: "2026-07-24T13:00:00.000Z",
  usedAt: null,
};

describe("ActionPolicySchema defaults (secure-by-default posture)", () => {
  it("applies deny / read / no-side-effects defaults to a minimal policy", () => {
    const parsed: ActionPolicy = ActionPolicySchema.parse(minimalInput);
    expect(parsed.policyId).toBe("policy-default");
    expect(parsed.toolPattern).toBe("fs.*");
    expect(parsed.effect).toBe("deny");
    expect(parsed.classification).toBe("read");
    expect(parsed.allowedSideEffects).toEqual([]);
    expect(parsed.approval).toBeNull();
  });

  it("preserves explicit relaxations", () => {
    const relaxed = {
      policyId: "p2",
      toolPattern: "fs.write",
      effect: "allow",
      classification: "write",
      approval: null,
      allowedSideEffects: ["network egress"],
    };
    const parsed = ActionPolicySchema.parse(relaxed);
    expect(parsed.effect).toBe("allow");
    expect(parsed.classification).toBe("write");
    expect(parsed.allowedSideEffects).toEqual(["network egress"]);
  });

  it("parses a policy carrying a full approval grant", () => {
    const input: ActionPolicyInput = {
      policyId: "p3",
      toolPattern: "fs.write",
      effect: "allow",
      classification: "write",
      approval: validGrant,
    };
    const parsed = ActionPolicySchema.parse(input);
    expect(parsed.approval).not.toBeNull();
    const grant = parsed.approval;
    if (grant === null) throw new Error("unreachable");
    expect(grant.grantedBy).toBe("operator@example.com");
    expect(grant.singleUse).toBe(true);
    expect(grant.usedAt).toBeNull();
  });

  it("rejects invalid effect and classification values", () => {
    expect(ActionPolicySchema.safeParse({ ...minimalInput, effect: "audit" }).success).toBe(false);
    expect(
      ActionPolicySchema.safeParse({ ...minimalInput, classification: "execute" }).success,
    ).toBe(false);
  });

  it("rejects empty policyId / toolPattern", () => {
    expect(ActionPolicySchema.safeParse({ ...minimalInput, policyId: "" }).success).toBe(false);
    expect(ActionPolicySchema.safeParse({ ...minimalInput, toolPattern: "" }).success).toBe(false);
  });

  it("rejects empty strings inside allowedSideEffects", () => {
    expect(
      ActionPolicySchema.safeParse({ ...minimalInput, allowedSideEffects: ["ok", ""] }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(ActionPolicySchema.safeParse({ ...minimalInput, extra: true }).success).toBe(false);
  });

  it("rejects unknown nested fields inside approval (strict)", () => {
    const bad = { ...minimalInput, approval: { ...validGrant, injected: 1 } };
    expect(ActionPolicySchema.safeParse(bad).success).toBe(false);
  });
});

describe("ApprovalGrantSchema", () => {
  it("defaults singleUse to true when omitted", () => {
    const parsed: ApprovalGrant = ApprovalGrantSchema.parse(validGrant);
    expect(parsed.singleUse).toBe(true);
  });

  it("preserves an explicit singleUse false", () => {
    const parsed = ApprovalGrantSchema.parse({ ...validGrant, singleUse: false });
    expect(parsed.singleUse).toBe(false);
  });

  it("rejects expiresAt before grantedAt (refinement)", () => {
    const bad = {
      ...validGrant,
      grantedAt: "2026-07-24T13:00:00.000Z",
      expiresAt: "2026-07-24T12:00:00.000Z",
    };
    expect(ApprovalGrantSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects expiresAt equal to grantedAt (must be strictly after)", () => {
    const bad = { ...validGrant, expiresAt: validGrant.grantedAt };
    expect(ApprovalGrantSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects naive timestamps without zone", () => {
    expect(
      ApprovalGrantSchema.safeParse({ ...validGrant, grantedAt: "2026-07-24T12:00:00" }).success,
    ).toBe(false);
    expect(
      ApprovalGrantSchema.safeParse({ ...validGrant, expiresAt: "2026-07-24T13:00:00" }).success,
    ).toBe(false);
  });

  it("requires the usedAt key (explicit null while unused)", () => {
    const missing = {
      grantedBy: "op",
      grantedAt: "2026-07-24T12:00:00.000Z",
      expiresAt: "2026-07-24T13:00:00.000Z",
    };
    expect(ApprovalGrantSchema.safeParse(missing).success).toBe(false);
  });

  it("accepts a consumed grant (usedAt set)", () => {
    const consumed = { ...validGrant, usedAt: "2026-07-24T12:30:00.000Z" };
    expect(ApprovalGrantSchema.parse(consumed)).toEqual({ ...consumed, singleUse: true });
  });

  it("rejects an empty grantedBy", () => {
    expect(ApprovalGrantSchema.safeParse({ ...validGrant, grantedBy: "" }).success).toBe(false);
  });
});
