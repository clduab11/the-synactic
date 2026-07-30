import { describe, expect, it } from "vitest";

import { ENVELOPE_VERSION, SynacticEventSchema } from "./index.js";
import type { SynacticEvent } from "./index.js";

const provenance = {
  sourceId: "unit-test",
  sourceUri: "https://example.com/source",
  retrievedAt: "2026-07-24T11:59:00.000Z",
  integrityHash: null,
};

const validEvent = {
  version: ENVELOPE_VERSION,
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  type: "tool.invoked",
  timestamp: "2026-07-24T12:00:00.000Z",
  provenance,
  payload: { tool: "search", args: { query: "hello" } },
};

describe("SynacticEventSchema", () => {
  it("exposes ENVELOPE_VERSION 1", () => {
    expect(ENVELOPE_VERSION).toBe(1);
  });

  it("parses a valid event and infers the expected output", () => {
    const parsed: SynacticEvent = SynacticEventSchema.parse(validEvent);
    expect(parsed).toEqual(validEvent);
    expect(parsed.version).toBe(ENVELOPE_VERSION);
  });

  it("rejects a non-uuid id", () => {
    expect(SynacticEventSchema.safeParse({ ...validEvent, id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects an empty type", () => {
    expect(SynacticEventSchema.safeParse({ ...validEvent, type: "" }).success).toBe(false);
  });

  it("rejects a mismatched version", () => {
    expect(SynacticEventSchema.safeParse({ ...validEvent, version: 2 }).success).toBe(false);
    expect(SynacticEventSchema.safeParse({ ...validEvent, version: "1" }).success).toBe(false);
  });

  it("rejects missing provenance (provenance is REQUIRED)", () => {
    const withoutProvenance = {
      version: ENVELOPE_VERSION,
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      type: "tool.invoked",
      timestamp: "2026-07-24T12:00:00.000Z",
      payload: {},
    };
    expect(SynacticEventSchema.safeParse(withoutProvenance).success).toBe(false);
  });

  it("rejects invalid nested provenance", () => {
    const bad = { ...validEvent, provenance: { ...provenance, sourceUri: "not-a-url" } };
    expect(SynacticEventSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a naive timestamp without zone", () => {
    expect(
      SynacticEventSchema.safeParse({ ...validEvent, timestamp: "2026-07-24T12:00:00" }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(SynacticEventSchema.safeParse({ ...validEvent, extra: "nope" }).success).toBe(false);
  });

  it("rejects unknown nested fields in provenance (strict at depth)", () => {
    const forged = { ...validEvent, provenance: { ...provenance, injected: true } };
    expect(SynacticEventSchema.safeParse(forged).success).toBe(false);
  });

  it("rejects secret-shaped payload keys (principle c)", () => {
    const forged = { ...validEvent, payload: { apiKey: "not-a-real-key-but-the-name-matches" } };
    expect(SynacticEventSchema.safeParse(forged).success).toBe(false);
  });

  it("rejects secret-shaped payload values (principle c)", () => {
    const forged = { ...validEvent, payload: { note: "sk-abcdefghijklmnop" } };
    expect(SynacticEventSchema.safeParse(forged).success).toBe(false);
  });
});
