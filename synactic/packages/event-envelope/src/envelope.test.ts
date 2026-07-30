import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import type { SourceProvenance } from "@the-synactic/contracts";

import {
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  DEFAULT_MAX_PAYLOAD_BYTES,
  ENVELOPE_VERSION,
  createEvent,
  deserializeEvent,
  serializeEvent,
  validateEvent,
} from "./index.js";
import type { CreateEventInput } from "./index.js";

const FIXED_NOW = new Date("2026-07-24T12:00:00.000Z");
const fixedClock = (): Date => new Date(FIXED_NOW.getTime());
const testOptions = { now: fixedClock } as const;

const provenance: SourceProvenance = {
  sourceId: "unit-test",
  sourceUri: "https://example.com/source",
  retrievedAt: "2026-07-24T11:59:00.000Z",
  integrityHash: null,
};

const validInput: CreateEventInput = {
  type: "tool.invoked",
  provenance,
  payload: { tool: "search", args: { query: "hello" } },
};

const validEvent = {
  version: ENVELOPE_VERSION,
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  type: "tool.invoked",
  timestamp: "2026-07-24T12:00:00.000Z",
  provenance,
  payload: { tool: "search" },
};

describe("createEvent", () => {
  it("fills id, timestamp and version and returns a valid event", () => {
    const result = createEvent(validInput, testOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.event.version).toBe(ENVELOPE_VERSION);
    expect(result.event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.event.timestamp).toBe("2026-07-24T12:00:00.000Z");
    expect(result.event.type).toBe("tool.invoked");
    expect(result.event.provenance).toEqual(provenance);
    expect(result.event.payload).toEqual(validInput.payload);
  });

  it("rejects secret-shaped payloads instead of building an envelope", () => {
    const result = createEvent(
      { ...validInput, payload: { apiKey: "sk-abcdefghijklmnop1234567890" } },
      testOptions,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects invalid provenance", () => {
    const result = createEvent(
      { ...validInput, provenance: { ...provenance, sourceId: "" } },
      testOptions,
    );
    expect(result.ok).toBe(false);
  });
});

describe("validateEvent", () => {
  it("accepts a well-formed event", () => {
    expect(validateEvent(validEvent, testOptions).ok).toBe(true);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(validateEvent({ ...validEvent, extra: "nope" }, testOptions).ok).toBe(false);
  });

  it("rejects unknown nested fields at depth (strict)", () => {
    const forged = { ...validEvent, provenance: { ...provenance, injected: true } };
    expect(validateEvent(forged, testOptions).ok).toBe(false);
  });

  it("rejects a mismatched envelope version", () => {
    expect(validateEvent({ ...validEvent, version: 2 }, testOptions).ok).toBe(false);
  });

  it("rejects non-object input without throwing", () => {
    expect(validateEvent("not an event", testOptions).ok).toBe(false);
    expect(validateEvent(null, testOptions).ok).toBe(false);
    expect(validateEvent(42, testOptions).ok).toBe(false);
  });

  it("reports normalized issues with code, message and path", () => {
    const result = validateEvent({ ...validEvent, type: "" }, testOptions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.length).toBeGreaterThan(0);
    for (const i of result.issues) {
      expect(typeof i.code).toBe("string");
      expect(typeof i.message).toBe("string");
      expect(Array.isArray(i.path)).toBe(true);
    }
  });
});

describe("oversized payload rejection", () => {
  it("rejects payloads exceeding the default 64 KiB limit", () => {
    const payload = { data: "x".repeat(DEFAULT_MAX_PAYLOAD_BYTES) };
    const result = validateEvent({ ...validEvent, payload }, testOptions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "payload_too_large")).toBe(true);
  });

  it("honours a custom maxPayloadBytes", () => {
    const payload = { data: "x".repeat(256) };
    const result = validateEvent(
      { ...validEvent, payload },
      { ...testOptions, maxPayloadBytes: 128 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "payload_too_large")).toBe(true);
  });

  it("accepts a payload whose serialized size equals the limit", () => {
    const limit = 128;
    const overhead = Buffer.byteLength(JSON.stringify({ data: "" }), "utf8");
    const payload = { data: "x".repeat(limit - overhead) };
    const result = validateEvent(
      { ...validEvent, payload },
      { ...testOptions, maxPayloadBytes: limit },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects non-JSON-serializable payloads without throwing", () => {
    const result = validateEvent({ ...validEvent, payload: { n: 10n } }, testOptions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "payload_not_serializable")).toBe(true);
  });
});

describe("future-dated timestamp rejection", () => {
  const atOffset = (ms: number): string => new Date(FIXED_NOW.getTime() + ms).toISOString();

  it("rejects timestamps beyond the default 5 minute tolerance", () => {
    const result = validateEvent(
      { ...validEvent, timestamp: atOffset(10 * 60 * 1000) },
      testOptions,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "timestamp_in_future")).toBe(true);
  });

  it("honours a custom clockSkewToleranceMs", () => {
    const result = validateEvent(
      { ...validEvent, timestamp: atOffset(60 * 1000) },
      { ...testOptions, clockSkewToleranceMs: 30 * 1000 },
    );
    expect(result.ok).toBe(false);
  });

  it("accepts timestamps within tolerance", () => {
    expect(validateEvent({ ...validEvent, timestamp: atOffset(4 * 60 * 1000) }, testOptions).ok).toBe(
      true,
    );
  });

  it("accepts a timestamp exactly at the tolerance boundary", () => {
    const result = validateEvent(
      { ...validEvent, timestamp: atOffset(DEFAULT_CLOCK_SKEW_TOLERANCE_MS) },
      testOptions,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts past timestamps", () => {
    expect(validateEvent({ ...validEvent, timestamp: atOffset(-60 * 60 * 1000) }, testOptions).ok).toBe(
      true,
    );
  });
});

describe("serializeEvent / deserializeEvent", () => {
  it("round-trips a valid event through JSON", () => {
    const created = createEvent(validInput, testOptions);
    if (!created.ok) throw new Error("expected createEvent to succeed");
    const json = serializeEvent(created.event);
    const restored = deserializeEvent(json, testOptions);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error("unreachable");
    expect(restored.event).toEqual(created.event);
  });

  it("rejects invalid JSON without throwing", () => {
    const result = deserializeEvent("{not json", testOptions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "invalid_json")).toBe(true);
  });

  it("rejects valid JSON that is not an event", () => {
    expect(deserializeEvent(JSON.stringify({ hello: "world" }), testOptions).ok).toBe(false);
  });

  it("rejects an envelope carrying a secret in transit", () => {
    const forged = { ...validEvent, payload: { note: "ghp_abcdefghijklmnopqrstuvwx" } };
    expect(deserializeEvent(JSON.stringify(forged), testOptions).ok).toBe(false);
  });
});
