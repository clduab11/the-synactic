import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import type { SourceProvenance } from "@the-synactic/contracts";

import {
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  ENVELOPE_VERSION,
  createEvent,
  deserializeEvent,
  serializeEvent,
  validateEvent,
} from "./index.js";
import type { CreateEventInput } from "./index.js";

/**
 * Additive coverage on top of envelope.test.ts / secret-proof.test.ts:
 * round-trip idempotency, exact size/skew boundaries, structural
 * strictness gaps, programmer-error option validation, and JSON edge
 * cases. Nothing here duplicates the existing 65 tests.
 */

const FIXED_NOW = new Date("2026-07-24T12:00:00.000Z");
const fixedClock = (): Date => new Date(FIXED_NOW.getTime());
const testOptions = { now: fixedClock } as const;

const provenance: SourceProvenance = {
  sourceId: "coverage",
  sourceUri: "https://example.com/source",
  retrievedAt: "2026-07-24T11:59:00.000Z",
  integrityHash: null,
};

const validEvent = {
  version: ENVELOPE_VERSION as 1,
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  type: "tool.invoked",
  timestamp: "2026-07-24T12:00:00.000Z",
  provenance,
  payload: { tool: "search" },
};

const richInput: CreateEventInput = {
  type: "tool.invoked",
  provenance,
  payload: {
    tool: "search",
    args: { query: "hello", limit: 3 },
    nested: { list: [1, "two", { three: true, none: null }] },
  },
};

describe("round-trip stability", () => {
  it("validateEvent is idempotent on its own output", () => {
    const first = validateEvent(validEvent, testOptions);
    if (!first.ok) throw new Error("expected first validation to succeed");
    const second = validateEvent(first.event, testOptions);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.event).toEqual(first.event);
    expect(second.event).toEqual(validEvent);
  });

  it("createEvent -> serializeEvent -> deserializeEvent is byte-stable", () => {
    const created = createEvent(richInput, testOptions);
    if (!created.ok) throw new Error("expected createEvent to succeed");
    const json1 = serializeEvent(created.event);
    const restored = deserializeEvent(json1, testOptions);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error("unreachable");
    expect(restored.event).toEqual(created.event);
    const json2 = serializeEvent(restored.event);
    expect(json2).toBe(json1);
  });

  it("deserializes a serialized fixture to a deep-equal event", () => {
    const restored = deserializeEvent(serializeEvent(validEvent), testOptions);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error("unreachable");
    expect(restored.event).toEqual(validEvent);
  });
});

describe("payload size boundaries", () => {
  it("rejects a payload exactly one byte above the limit", () => {
    const limit = 256;
    const overhead = Buffer.byteLength(JSON.stringify({ data: "" }), "utf8");
    const payload = { data: "x".repeat(limit - overhead + 1) };
    const result = validateEvent(
      { ...validEvent, payload },
      { ...testOptions, maxPayloadBytes: limit },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "payload_too_large")).toBe(true);
  });

  it("measures multi-byte UTF-8 characters as bytes, not code units", () => {
    const payload = { data: String.fromCodePoint(0x1f600).repeat(16) };
    const byteLength = Buffer.byteLength(JSON.stringify(payload), "utf8");
    expect(byteLength).toBeGreaterThan(JSON.stringify(payload).length);
    const atLimit = validateEvent(
      { ...validEvent, payload },
      { ...testOptions, maxPayloadBytes: byteLength },
    );
    expect(atLimit.ok).toBe(true);
    const oneBelow = validateEvent(
      { ...validEvent, payload },
      { ...testOptions, maxPayloadBytes: byteLength - 1 },
    );
    expect(oneBelow.ok).toBe(false);
    if (oneBelow.ok) throw new Error("unreachable");
    expect(oneBelow.issues.some((i) => i.code === "payload_too_large")).toBe(true);
  });
});

describe("timestamp boundaries", () => {
  const atOffset = (ms: number): string => new Date(FIXED_NOW.getTime() + ms).toISOString();

  it("rejects a timestamp one millisecond beyond the tolerance", () => {
    const result = validateEvent(
      { ...validEvent, timestamp: atOffset(DEFAULT_CLOCK_SKEW_TOLERANCE_MS + 1) },
      testOptions,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "timestamp_in_future")).toBe(true);
  });

  it("accepts a timestamp exactly at a custom tolerance boundary", () => {
    const result = validateEvent(
      { ...validEvent, timestamp: atOffset(30_000) },
      { ...testOptions, clockSkewToleranceMs: 30_000 },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a timestamp string without an explicit timezone", () => {
    const result = validateEvent(
      { ...validEvent, timestamp: "2026-07-24T12:00:00" },
      testOptions,
    );
    expect(result.ok).toBe(false);
  });
});

describe("structural strictness", () => {
  it("rejects an event with missing provenance", () => {
    const rest = { ...validEvent } as Record<string, unknown>;
    delete rest.provenance;
    expect(validateEvent(rest, testOptions).ok).toBe(false);
  });

  it("rejects an event with a missing payload", () => {
    const rest = { ...validEvent } as Record<string, unknown>;
    delete rest.payload;
    expect(validateEvent(rest, testOptions).ok).toBe(false);
  });

  it("rejects a non-numeric envelope version", () => {
    expect(validateEvent({ ...validEvent, version: "1" }, testOptions).ok).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    expect(validateEvent({ ...validEvent, id: "not-a-uuid" }, testOptions).ok).toBe(false);
  });
});

describe("option validation (programmer errors)", () => {
  it("throws RangeError for a negative maxPayloadBytes", () => {
    expect(() => validateEvent(validEvent, { maxPayloadBytes: -1 })).toThrow(RangeError);
    expect(() => validateEvent(validEvent, { maxPayloadBytes: -1 })).toThrow(/maxPayloadBytes/);
  });

  it("throws RangeError for non-finite maxPayloadBytes", () => {
    expect(() => validateEvent(validEvent, { maxPayloadBytes: Number.NaN })).toThrow(RangeError);
    expect(() => validateEvent(validEvent, { maxPayloadBytes: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });

  it("throws RangeError for a negative clockSkewToleranceMs", () => {
    expect(() => validateEvent(validEvent, { clockSkewToleranceMs: -1 })).toThrow(RangeError);
    expect(() => validateEvent(validEvent, { clockSkewToleranceMs: -1 })).toThrow(
      /clockSkewToleranceMs/,
    );
  });

  it("throws RangeError for non-finite clockSkewToleranceMs", () => {
    expect(() => validateEvent(validEvent, { clockSkewToleranceMs: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it("throws RangeError from createEvent and deserializeEvent as well", () => {
    expect(() => createEvent(richInput, { maxPayloadBytes: -1 })).toThrow(RangeError);
    expect(() => deserializeEvent("{}", { clockSkewToleranceMs: -1 })).toThrow(RangeError);
  });

  it("treats a zero maxPayloadBytes as a hard zero budget", () => {
    // Per resolveEnvelopeOptions, 0 is a valid (degenerate) limit:
    // even the empty object serializes to 2 bytes and is rejected.
    const result = validateEvent(
      { ...validEvent, payload: {} },
      { ...testOptions, maxPayloadBytes: 0 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "payload_too_large")).toBe(true);
  });

  it("treats a zero clockSkewToleranceMs as no future slack at all", () => {
    const at = (ms: number): string => new Date(FIXED_NOW.getTime() + ms).toISOString();
    expect(
      validateEvent(
        { ...validEvent, timestamp: at(0) },
        { ...testOptions, clockSkewToleranceMs: 0 },
      ).ok,
    ).toBe(true);
    expect(
      validateEvent(
        { ...validEvent, timestamp: at(1) },
        { ...testOptions, clockSkewToleranceMs: 0 },
      ).ok,
    ).toBe(false);
  });
});

describe("deserializeEvent JSON edge cases", () => {
  it("rejects an empty string with invalid_json", () => {
    const result = deserializeEvent("", testOptions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "invalid_json")).toBe(true);
  });

  it("rejects JSON literals that are not events (schema failure, not invalid_json)", () => {
    for (const literal of ["null", "42", "[1,2,3]", "true"]) {
      const result = deserializeEvent(literal, testOptions);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.issues.some((i) => i.code === "invalid_json")).toBe(false);
    }
  });
});
