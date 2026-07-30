import { describe, expect, it } from "vitest";

import {
  DigestItemSchema,
  DigestRequestSchema,
  DigestResponseSchema,
  DigestWindowSchema,
} from "./index.js";
import type { DigestRequest, DigestResponse } from "./index.js";

const provenance = {
  sourceId: "unit-test",
  sourceUri: "https://example.com/feed",
  retrievedAt: "2026-07-24T11:59:00.000Z",
  integrityHash: null,
};

const validWindow = {
  since: "2026-07-01T00:00:00.000Z",
  until: "2026-07-24T00:00:00.000Z",
};

const validRequest = {
  topics: ["security", "releases"],
  window: validWindow,
  limit: 10,
};

const validItem = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  summary: "Weekly security digest",
  provenance,
};

const validResponse = {
  generatedAt: "2026-07-24T12:00:00.000Z",
  items: [validItem],
};

describe("DigestWindowSchema ordering refinement", () => {
  it("accepts since before until", () => {
    expect(DigestWindowSchema.parse(validWindow)).toEqual(validWindow);
  });

  it("rejects since after until", () => {
    const bad = { since: "2026-07-24T00:00:00.000Z", until: "2026-07-01T00:00:00.000Z" };
    expect(DigestWindowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects since equal to until (window must be non-empty)", () => {
    const bad = { since: validWindow.since, until: validWindow.since };
    expect(DigestWindowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects naive window timestamps", () => {
    expect(
      DigestWindowSchema.safeParse({ ...validWindow, since: "2026-07-01T00:00:00" }).success,
    ).toBe(false);
  });
});

describe("DigestRequestSchema", () => {
  it("parses a valid digest request", () => {
    const parsed: DigestRequest = DigestRequestSchema.parse(validRequest);
    expect(parsed).toEqual(validRequest);
  });

  it("requires at least one topic", () => {
    expect(DigestRequestSchema.safeParse({ ...validRequest, topics: [] }).success).toBe(false);
  });

  it("rejects empty topic strings", () => {
    expect(DigestRequestSchema.safeParse({ ...validRequest, topics: [""] }).success).toBe(false);
  });

  it("requires limit to be a positive integer", () => {
    expect(DigestRequestSchema.safeParse({ ...validRequest, limit: 0 }).success).toBe(false);
    expect(DigestRequestSchema.safeParse({ ...validRequest, limit: -3 }).success).toBe(false);
    expect(DigestRequestSchema.safeParse({ ...validRequest, limit: 1.5 }).success).toBe(false);
    expect(DigestRequestSchema.safeParse({ ...validRequest, limit: "10" }).success).toBe(false);
    expect(DigestRequestSchema.safeParse({ ...validRequest, limit: 1 }).success).toBe(true);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(DigestRequestSchema.safeParse({ ...validRequest, cursor: "abc" }).success).toBe(false);
  });
});

describe("DigestResponseSchema", () => {
  it("parses a valid digest response", () => {
    const parsed: DigestResponse = DigestResponseSchema.parse(validResponse);
    expect(parsed).toEqual(validResponse);
  });

  it("accepts an empty items array", () => {
    expect(DigestResponseSchema.safeParse({ ...validResponse, items: [] }).success).toBe(true);
  });

  it("rejects a naive generatedAt", () => {
    expect(
      DigestResponseSchema.safeParse({ ...validResponse, generatedAt: "2026-07-24T12:00:00" })
        .success,
    ).toBe(false);
  });
});

describe("DigestItemSchema", () => {
  it("requires provenance on every digest item", () => {
    const missing = { id: validItem.id, summary: validItem.summary };
    expect(DigestItemSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects unknown fields on items (strict)", () => {
    expect(DigestItemSchema.safeParse({ ...validItem, url: "https://example.com" }).success).toBe(
      false,
    );
  });

  it("rejects an empty summary and a non-uuid id", () => {
    expect(DigestItemSchema.safeParse({ ...validItem, summary: "" }).success).toBe(false);
    expect(DigestItemSchema.safeParse({ ...validItem, id: "nope" }).success).toBe(false);
  });
});
