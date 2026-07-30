import { describe, expect, it } from "vitest";

import { SourceProvenanceSchema } from "./index.js";
import type { SourceProvenance } from "./index.js";

const validProvenance: SourceProvenance = {
  sourceId: "unit-test",
  sourceUri: "https://example.com/source",
  retrievedAt: "2026-07-24T11:59:00.000Z",
  integrityHash: null,
};

describe("SourceProvenanceSchema", () => {
  it("parses a valid provenance with integrityHash null", () => {
    const parsed: SourceProvenance = SourceProvenanceSchema.parse(validProvenance);
    expect(parsed).toEqual(validProvenance);
    expect(parsed.integrityHash).toBeNull();
  });

  it("parses a valid provenance with a real integrity hash", () => {
    const withHash = { ...validProvenance, integrityHash: "sha256:deadbeef" };
    expect(SourceProvenanceSchema.parse(withHash)).toEqual(withHash);
  });

  it("rejects an empty sourceId", () => {
    expect(
      SourceProvenanceSchema.safeParse({ ...validProvenance, sourceId: "" }).success,
    ).toBe(false);
  });

  it("rejects a non-URL sourceUri", () => {
    expect(
      SourceProvenanceSchema.safeParse({ ...validProvenance, sourceUri: "not-a-url" }).success,
    ).toBe(false);
    expect(
      SourceProvenanceSchema.safeParse({ ...validProvenance, sourceUri: "example.com/no-scheme" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing retrievedAt", () => {
    const missing = {
      sourceId: "unit-test",
      sourceUri: "https://example.com/source",
      integrityHash: null,
    };
    expect(SourceProvenanceSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects a naive retrievedAt without zone", () => {
    expect(
      SourceProvenanceSchema.safeParse({ ...validProvenance, retrievedAt: "2026-07-24T11:59:00" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing integrityHash key (required key, explicit null allowed)", () => {
    const missing = {
      sourceId: "unit-test",
      sourceUri: "https://example.com/source",
      retrievedAt: "2026-07-24T11:59:00.000Z",
    };
    expect(SourceProvenanceSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects an empty-string integrityHash", () => {
    expect(
      SourceProvenanceSchema.safeParse({ ...validProvenance, integrityHash: "" }).success,
    ).toBe(false);
  });

  it("rejects unknown nested fields (strict)", () => {
    expect(
      SourceProvenanceSchema.safeParse({ ...validProvenance, injected: true }).success,
    ).toBe(false);
  });
});
