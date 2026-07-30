import { describe, expect, it } from "vitest";

import { SynacticEventSchema, noSecretShapedFields } from "@the-synactic/contracts";

import {
  ENVELOPE_VERSION,
  createEvent,
  deserializeEvent,
  validateEvent,
} from "./index.js";
import type { CreateEventInput } from "./index.js";

/**
 * Committed proof for tool-policy principle (c): secrets never pass through
 * event envelopes. Two layers of evidence:
 *  (a) STATIC — introspect the contracts SynacticEvent schema and prove that
 *      every open-ended (record/unknown/any-typed) field in the event tree
 *      carries the secret-guard refinement, bound semantically to contracts'
 *      noSecretShapedFields.
 *  (b) RUNTIME — probe validation with secret-shaped fixtures (keys and
 *      well-known secret value formats) at nested depths and assert rejection
 *      on every ingress path (validateEvent, createEvent, deserializeEvent).
 */

// ---------------------------------------------------------------------------
// (a) Static introspection of the zod 4 schema tree (schema._zod.def)
// ---------------------------------------------------------------------------

/** Minimal structural view of zod 4 internals. Test-only; not library code. */
interface ZodDefLike {
  type?: string;
  shape?: Record<string, unknown>;
  innerType?: unknown;
  checks?: readonly unknown[];
}

interface ZodCheckDefLike {
  check?: string;
}

function defOf(schema: unknown): ZodDefLike {
  return (schema as { _zod?: { def?: ZodDefLike } })._zod?.def ?? {};
}

function checkDefOf(check: unknown): ZodCheckDefLike {
  const fromZod = (check as { _zod?: { def?: ZodCheckDefLike } })._zod?.def;
  if (fromZod) return fromZod;
  const fromDef = (check as { def?: ZodCheckDefLike }).def;
  if (fromDef) return fromDef;
  return (check ?? {}) as ZodCheckDefLike;
}

const WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "nonoptional",
  "readonly",
  "catch",
]);

function coreDef(schema: unknown): ZodDefLike {
  let def = defOf(schema);
  let hops = 0;
  while (
    def.type !== undefined &&
    WRAPPER_TYPES.has(def.type) &&
    def.innerType !== undefined &&
    hops < 16
  ) {
    def = defOf(def.innerType);
    hops += 1;
  }
  return def;
}

const OPEN_ENDED_TYPES: ReadonlySet<string> = new Set(["record", "unknown", "any"]);

interface OpenEndedField {
  readonly path: string;
  readonly schema: unknown;
  readonly coreType: string;
}

/** Collects every record/unknown/any-typed field position in the object tree. */
function collectOpenEndedFields(schema: unknown, path: string, out: OpenEndedField[]): void {
  const def = coreDef(schema);
  if (def.type === "object") {
    for (const [key, fieldSchema] of Object.entries(def.shape ?? {})) {
      const fieldPath = path === "" ? key : `${path}.${key}`;
      const fieldDef = coreDef(fieldSchema);
      if (fieldDef.type !== undefined && OPEN_ENDED_TYPES.has(fieldDef.type)) {
        out.push({ path: fieldPath, schema: fieldSchema, coreType: fieldDef.type });
      } else {
        collectOpenEndedFields(fieldSchema, fieldPath, out);
      }
    }
  }
}

/** Custom-check defs found on the schema itself or its wrapper chain. */
function customCheckDefs(schema: unknown): ZodCheckDefLike[] {
  const found: ZodCheckDefLike[] = [];
  let current: unknown = schema;
  let hops = 0;
  while (current !== undefined && hops < 16) {
    const def = defOf(current);
    for (const check of def.checks ?? []) {
      const cd = checkDefOf(check);
      if (cd.check === "custom") found.push(cd);
    }
    if (def.type !== undefined && WRAPPER_TYPES.has(def.type) && def.innerType !== undefined) {
      current = def.innerType;
      hops += 1;
      continue;
    }
    break;
  }
  return found;
}

type RefinementCtx = Parameters<typeof noSecretShapedFields>[1];

interface CapturedIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** Invokes the contracts guard directly to learn its exact issue signature. */
function captureGuardIssue(value: unknown): CapturedIssue {
  const captured: CapturedIssue[] = [];
  const ctx = {
    addIssue: (issue: { code: string; message: string; path: (string | number)[] }) => {
      captured.push({ message: issue.message, path: issue.path });
    },
  } as unknown as RefinementCtx;
  noSecretShapedFields(value, ctx);
  const first = captured[0];
  if (!first) throw new Error("contracts secret guard did not fire on the fixture");
  return first;
}

interface SafeParseLike {
  safeParse: (
    v: unknown,
  ) =>
    | { success: true }
    | {
        success: false;
        error: { issues: Array<{ code: string; message: string; path?: PropertyKey[] }> };
      };
}

const samePath = (a: readonly PropertyKey[], b: readonly (string | number)[]): boolean =>
  a.length === b.length && a.every((p, i) => String(p) === String(b[i]));

describe("static proof: secret-guard coverage of SynacticEventSchema", () => {
  const openEndedFields: OpenEndedField[] = [];
  collectOpenEndedFields(SynacticEventSchema, "", openEndedFields);

  it("finds the open-ended (record/unknown) fields in the event tree", () => {
    expect(openEndedFields.length).toBeGreaterThan(0);
    expect(openEndedFields.map((f) => f.path)).toContain("payload");
  });

  it("every open-ended field carries at least one custom refinement check", () => {
    for (const field of openEndedFields) {
      expect(
        customCheckDefs(field.schema).length,
        `field "${field.path}" (${field.coreType}) must carry a custom refinement`,
      ).toBeGreaterThan(0);
    }
  });

  it("every open-ended field's refinement is the contracts secret guard", () => {
    const fixtures: ReadonlyArray<Record<string, unknown>> = [
      { nested: { apiKey: "not-a-real-key-but-the-name-matches" } },
      { nested: { note: "ghp_abcdefghijklmnopqrstuvwx" } },
    ];
    for (const field of openEndedFields) {
      const schema = field.schema as SafeParseLike;
      for (const fixture of fixtures) {
        const expected = captureGuardIssue(fixture);
        const parsed = schema.safeParse(fixture);
        expect(parsed.success, `field "${field.path}" must reject secret-shaped data`).toBe(false);
        if (parsed.success) continue;
        const match = parsed.error.issues.some(
          (i) =>
            i.code === "custom" &&
            i.message === expected.message &&
            samePath(i.path ?? [], expected.path),
        );
        expect(
          match,
          `field "${field.path}" must reject via the contracts secret guard (same custom issue)`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (b) Runtime probes with secret-shaped fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-07-24T12:00:00.000Z");
const testOptions = { now: () => new Date(FIXED_NOW.getTime()) } as const;

const provenance = {
  sourceId: "secret-proof",
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

const SECRET_KEY_FIXTURES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['top-level key "apiKey"', { apiKey: "not-a-real-key-but-the-name-matches" }],
  ['top-level key "password"', { password: "hunter2" }],
  ["nested key at depth 3", { level1: { level2: { token: "abc" } } }],
  ["key inside an array element", { items: [{ secret: "abc" }] }],
  ["key inside nested arrays", { matrix: [[{ credentials: "abc" }]] }],
];

const SECRET_VALUE_FIXTURES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["OpenAI-style key (sk-...)", { note: "sk-abcdefghijklmnop1234567890" }],
  ["GitHub PAT (ghp_...)", { note: "ghp_abcdefghijklmnopqrstuvwx" }],
  [
    "GitHub fine-grained PAT (github_pat_...)",
    { note: "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789" },
  ],
  ["AWS access key id (AKIA...)", { note: "AKIAIOSFODNN7EXAMPLE" }],
  [
    "JWT",
    {
      note: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
    },
  ],
  ["PEM private key header", { note: "-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJBAK" }],
  ["secret value at depth 3", { a: { b: { c: "sk-abcdefghijklmnop1234567890" } } }],
  ["secret value inside an array", { list: ["safe", "xoxb-1234567890-abcdefghijkl"] }],
];

const ALL_FIXTURES = [...SECRET_KEY_FIXTURES, ...SECRET_VALUE_FIXTURES];

describe("runtime proof: secret-shaped payloads are rejected on every ingress path", () => {
  describe("validateEvent", () => {
    it.each(ALL_FIXTURES)("rejects %s", (label, payload) => {
      const result = validateEvent({ ...baseEvent, payload }, testOptions);
      expect(result.ok, label).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.issues.some((i) => i.code === "custom"), label).toBe(true);
    });
  });

  describe("createEvent", () => {
    it.each(ALL_FIXTURES)("rejects %s", (label, payload) => {
      const input: CreateEventInput = { type: "probe", provenance, payload };
      const result = createEvent(input, testOptions);
      expect(result.ok, label).toBe(false);
    });
  });

  describe("deserializeEvent", () => {
    it.each(ALL_FIXTURES)("rejects %s", (label, payload) => {
      const json = JSON.stringify({ ...baseEvent, payload });
      const result = deserializeEvent(json, testOptions);
      expect(result.ok, label).toBe(false);
    });
  });

  it("accepts a benign payload (fail-closed guard does not break normal traffic)", () => {
    const payload = {
      query: "weather in paris",
      url: "https://example.com/page?x=1",
      items: [1, "two", { three: true }],
      note: "this string mentions tokens but is not one",
    };
    const result = validateEvent({ ...baseEvent, payload }, testOptions);
    expect(result.ok).toBe(true);
  });
});
