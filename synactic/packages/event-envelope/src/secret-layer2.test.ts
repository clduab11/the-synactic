import { describe, expect, it, vi } from "vitest";

/**
 * Isolation tests for the defense-in-depth secret re-check inside
 * validate.ts (enforcement layer 2). The contracts schema (layer 1)
 * already rejects secret-shaped payloads, so the runtime probes in
 * secret-proof.test.ts can never observe layer 2 on its own. Here the
 * schema is replaced with a permissive pass-through while the REAL
 * findSecretShapedField stays bound, so these tests fail iff layer 2
 * is removed or neutralized. This is the mutation-proof tripwire.
 */

vi.mock("@the-synactic/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@the-synactic/contracts")>();
  return {
    ...actual,
    SynacticEventSchema: {
      safeParse: (value: unknown) => ({ success: true as const, data: value }),
    },
  };
});

import {
  ENVELOPE_VERSION,
  createEvent,
  deserializeEvent,
  validateEvent,
} from "./index.js";
import type { CreateEventInput } from "./index.js";

const FIXED_NOW = new Date("2026-07-24T12:00:00.000Z");
const testOptions = { now: () => new Date(FIXED_NOW.getTime()) } as const;

const provenance = {
  sourceId: "layer2",
  sourceUri: "https://example.com/source",
  retrievedAt: "2026-07-24T11:59:00.000Z",
  integrityHash: null,
};

const baseEvent = {
  version: ENVELOPE_VERSION,
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  type: "probe",
  timestamp: "2026-07-24T12:00:00.000Z",
  provenance,
  payload: {},
};

const GHP = "ghp_abcdefghijklmnopqrstuvwx";
const SK = "sk-abcdefghijklmnop1234567890";

describe("defense-in-depth secret re-check (validate.ts layer 2)", () => {
  it("sanity: the permissive schema mock waves a benign event through", () => {
    // Anchors the mock: without layer 2 every fixture below would pass,
    // which is exactly why the rejection tests are meaningful.
    const result = validateEvent(
      { ...baseEvent, payload: { note: "plain text" } },
      testOptions,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a secret-shaped key the schema no longer catches", () => {
    const result = validateEvent(
      { ...baseEvent, payload: { apiKey: "not-a-real-key-but-the-name-matches" } },
      testOptions,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const issue = result.issues.find((i) => i.code === "secret_shaped_field");
    expect(issue).toBeDefined();
    expect(issue?.path).toEqual(["payload", "apiKey"]);
  });

  it("rejects a secret-shaped value at nested depth", () => {
    const result = validateEvent(
      { ...baseEvent, payload: { a: { b: { note: GHP } } } },
      testOptions,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const issue = result.issues.find((i) => i.code === "secret_shaped_field");
    expect(issue?.path).toEqual(["payload", "a", "b", "note"]);
  });

  it("rejects a secret-shaped value inside an array", () => {
    const result = validateEvent(
      { ...baseEvent, payload: { list: ["safe", SK] } },
      testOptions,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const issue = result.issues.find((i) => i.code === "secret_shaped_field");
    expect(issue?.path).toEqual(["payload", "list", 1]);
  });

  it("rejects via createEvent when only layer 2 stands guard", () => {
    const input: CreateEventInput = {
      type: "probe",
      provenance,
      payload: { token: "abc" },
    };
    const result = createEvent(input, testOptions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "secret_shaped_field")).toBe(true);
  });

  it("rejects via deserializeEvent when only layer 2 stands guard", () => {
    const json = JSON.stringify({ ...baseEvent, payload: { note: GHP } });
    const result = deserializeEvent(json, testOptions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.some((i) => i.code === "secret_shaped_field")).toBe(true);
  });

  it("never leaks the secret value into the issue message", () => {
    const result = validateEvent({ ...baseEvent, payload: { note: SK } }, testOptions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const issue = result.issues.find((i) => i.code === "secret_shaped_field");
    expect(issue).toBeDefined();
    expect(issue?.message.includes(SK)).toBe(false);
    expect(issue?.message.includes("value")).toBe(true);
  });
});
