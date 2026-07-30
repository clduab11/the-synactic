import { describe, expect, it } from "vitest";

import {
  ENVELOPE_VERSION,
  SECRET_FIELD_PATTERN,
  SECRET_VALUE_PATTERNS,
  SecretSafeRecordSchema,
  SynacticEventSchema,
  ToolCallRecordSchema,
  assertNoSecretShapedFields,
  findSecretShapedField,
  noSecretShapedFields,
} from "./index.js";

const provenance = {
  sourceId: "unit-test",
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

const baseRecord = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  toolName: "fs.read",
  arguments: {},
  decision: "deny",
  reasonCode: "default-deny",
  policyId: "policy-default",
  timestamp: "2026-07-24T12:00:00.000Z",
  provenance,
  correlationId: "9b2f8c1e-3d4a-4e5b-9c6d-7e8f9a0b1c2d",
  results: null,
};

const JWT_EXAMPLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c";

const SECRET_KEY_NAMES: readonly string[] = [
  "token",
  "authToken",
  "password",
  "Password",
  "passwd",
  "pwd",
  "secret",
  "mySecret",
  "apiKey",
  "api_key",
  "api-key",
  "apikey",
  "API_KEY",
  "credential",
  "credentials",
  "bearer",
  "privateKey",
  "private_key",
  "accessKey",
  "access_key",
  "sessionKey",
  "session_key",
  "signingKey",
  "signing_key",
];

describe("SECRET_FIELD_PATTERN (key names, fail-closed)", () => {
  it.each(SECRET_KEY_NAMES)("rejects credential-carrier key %s", (key) => {
    expect(SECRET_FIELD_PATTERN.test(key)).toBe(true);
    expect(SecretSafeRecordSchema.safeParse({ [key]: "x" }).success).toBe(false);
  });

  it.each(["monkey", "keyboard", "key", "notes", "query", "toolName"])(
    "accepts benign lookalike key %s",
    (key) => {
      expect(SECRET_FIELD_PATTERN.test(key)).toBe(false);
      expect(SecretSafeRecordSchema.safeParse({ [key]: "x" }).success).toBe(true);
    },
  );

  it("is fail-closed by design: benign keys containing a carrier substring are rejected", () => {
    // "tokenizer" contains "token": rejected even though it is not a credential.
    // This is the documented fail-closed trade-off of the substring pattern.
    expect(SecretSafeRecordSchema.safeParse({ tokenizer: "bpe" }).success).toBe(false);
  });
});

const SECRET_VALUE_CASES: ReadonlyArray<readonly [string, string]> = [
  ["OpenAI-style key (sk-...)", "sk-" + "a".repeat(16)],
  ["GitHub PAT (ghp_...)", "ghp_" + "a".repeat(20)],
  ["GitHub OAuth token (gho_...)", "gho_" + "a".repeat(20)],
  ["GitHub user-to-server token (ghu_...)", "ghu_" + "a".repeat(20)],
  ["GitHub server-to-server token (ghs_...)", "ghs_" + "a".repeat(20)],
  ["GitHub refresh token (ghr_...)", "ghr_" + "a".repeat(20)],
  ["GitHub fine-grained PAT (github_pat_...)", "github_pat_" + "a".repeat(20)],
  ["AWS access key id (AKIA...)", "AKIA" + "A".repeat(16)],
  ["Google API key (AIza...)", "AIza" + "a".repeat(20)],
  ["Slack bot token (xoxb-...)", "xoxb-" + "a".repeat(10)],
  ["Slack user token (xoxp-...)", "xoxp-" + "a".repeat(10)],
  ["JWT", JWT_EXAMPLE],
  ["PEM private key header", "-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJBAK"],
  ["PEM RSA private key header", "-----BEGIN RSA PRIVATE KEY-----"],
];

describe("SECRET_VALUE_PATTERNS (well-known secret shapes)", () => {
  it.each(SECRET_VALUE_CASES)("rejects value: %s", (_label, value) => {
    expect(SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))).toBe(true);
    expect(SecretSafeRecordSchema.safeParse({ note: value }).success).toBe(false);
  });
});

const VALUE_BOUNDARY_ACCEPT: ReadonlyArray<readonly [string, string]> = [
  ["sk- with only 15 trailing chars", "sk-" + "a".repeat(15)],
  ["ghp_ with only 19 trailing chars", "ghp_" + "a".repeat(19)],
  ["AKIA with only 15 trailing chars", "AKIA" + "A".repeat(15)],
  ["xoxb- with only 9 trailing chars", "xoxb-" + "a".repeat(9)],
  ["sk- shape without a word boundary (ask-...)", "ask-" + "a".repeat(16)],
  ["benign sentence mentioning tokens", "this string mentions tokens but is not one"],
  ["ordinary kebab-case string", "default-deny"],
];

describe("secret value true boundaries", () => {
  it.each(VALUE_BOUNDARY_ACCEPT)("accepts: %s", (_label, value) => {
    expect(SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))).toBe(false);
    expect(SecretSafeRecordSchema.safeParse({ note: value }).success).toBe(true);
  });

  it("rejects at the exact minimum lengths (16/20/16/10)", () => {
    expect(SecretSafeRecordSchema.safeParse({ note: "sk-" + "a".repeat(16) }).success).toBe(false);
    expect(SecretSafeRecordSchema.safeParse({ note: "ghp_" + "a".repeat(20) }).success).toBe(false);
    expect(SecretSafeRecordSchema.safeParse({ note: "AKIA" + "A".repeat(16) }).success).toBe(false);
    expect(SecretSafeRecordSchema.safeParse({ note: "xoxb-" + "a".repeat(10) }).success).toBe(false);
  });
});

describe("findSecretShapedField", () => {
  it("returns null for clean structures", () => {
    expect(
      findSecretShapedField({ query: "paris", nested: { list: [1, "two", { three: true }] } }),
    ).toBeNull();
    expect(findSecretShapedField("just a string")).toBeNull();
    expect(findSecretShapedField(42)).toBeNull();
    expect(findSecretShapedField(null)).toBeNull();
  });

  it("reports the first secret-shaped key with its path", () => {
    const hit = findSecretShapedField({ a: { b: { token: "abc" } } });
    expect(hit).toEqual({ path: ["a", "b", "token"], kind: "key" });
  });

  it("reports secret-shaped values inside arrays with numeric path segments", () => {
    const hit = findSecretShapedField({ list: ["safe", "xoxb-" + "a".repeat(10)] });
    expect(hit).toEqual({ path: ["list", 1], kind: "value" });
  });

  it("reports a bare secret string at the root path", () => {
    const hit = findSecretShapedField("sk-" + "a".repeat(16));
    expect(hit).toEqual({ path: [], kind: "value" });
  });

  it("is cycle-safe and returns null for cyclic clean structures", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(findSecretShapedField(cyclic)).toBeNull();
    expect(SecretSafeRecordSchema.safeParse(cyclic).success).toBe(true);
  });
});

describe("assertNoSecretShapedFields", () => {
  it("is a no-op for clean structures", () => {
    expect(() => assertNoSecretShapedFields({ ok: true })).not.toThrow();
  });

  it("throws for secret-shaped structures", () => {
    expect(() => assertNoSecretShapedFields({ nested: { password: "hunter2" } })).toThrow(
      /Secret-shaped key rejected/,
    );
  });
});

describe("noSecretShapedFields (zod superRefine mixin)", () => {
  type RefinementCtx = Parameters<typeof noSecretShapedFields>[1];

  it("adds a custom issue pointing at the offending field", () => {
    const captured: Array<{ code: string; message: string; path: (string | number)[] }> = [];
    const ctx = {
      addIssue: (issue: { code: string; message: string; path: (string | number)[] }) => {
        captured.push(issue);
      },
    } as unknown as RefinementCtx;
    noSecretShapedFields({ deep: { apiKey: "x" } }, ctx);
    expect(captured).toHaveLength(1);
    const issue = captured[0];
    if (!issue) throw new Error("unreachable");
    expect(issue.code).toBe("custom");
    expect(issue.path).toEqual(["deep", "apiKey"]);
    expect(issue.message).toMatch(/secrets must never pass through/);
  });

  it("adds no issue for clean structures", () => {
    let calls = 0;
    const ctx = {
      addIssue: () => {
        calls += 1;
      },
    } as unknown as RefinementCtx;
    noSecretShapedFields({ ok: "clean" }, ctx);
    expect(calls).toBe(0);
  });
});

describe("SecretSafeRecordSchema", () => {
  it("parses a clean record with nested structures", () => {
    const clean = {
      query: "weather in paris",
      monkey: "see monkey do",
      keyboard: "clack",
      nested: { list: [1, "two", { three: true }] },
      note: "this string mentions tokens but is not one",
    };
    expect(SecretSafeRecordSchema.parse(clean)).toEqual(clean);
  });

  it("rejects non-record input", () => {
    expect(SecretSafeRecordSchema.safeParse("not a record").success).toBe(false);
    expect(SecretSafeRecordSchema.safeParse(null).success).toBe(false);
  });

  it("rejects secret-shaped keys at any depth", () => {
    expect(SecretSafeRecordSchema.safeParse({ l1: { l2: { l3: { secret: "x" } } } }).success).toBe(
      false,
    );
  });

  it("rejects secret-shaped values inside arrays", () => {
    expect(
      SecretSafeRecordSchema.safeParse({ list: ["ok", "ghp_" + "b".repeat(20)] }).success,
    ).toBe(false);
  });
});

const SECRET_PAYLOADS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['key "apiKey"', { apiKey: "not-a-real-key-but-the-name-matches" }],
  ['key "password"', { password: "hunter2" }],
  ["nested key at depth 3", { l1: { l2: { token: "abc" } } }],
  ["key inside an array element", { items: [{ secret: "abc" }] }],
  ["OpenAI sk- value", { note: "sk-" + "a".repeat(16) }],
  ["GitHub PAT value", { note: "ghp_" + "a".repeat(20) }],
  ["AWS key id value", { note: "AKIAIOSFODNN7EXAMPLE" }],
  ["JWT value", { note: JWT_EXAMPLE }],
  ["PEM header value", { note: "-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJBAK" }],
];

describe("principle (c) enforcement in the contracts schemas", () => {
  it.each(SECRET_PAYLOADS)("rejects event payloads with %s", (_label, payload) => {
    expect(SynacticEventSchema.safeParse({ ...baseEvent, payload }).success).toBe(false);
  });

  it.each(SECRET_PAYLOADS)("rejects tool-call arguments with %s", (_label, args) => {
    expect(ToolCallRecordSchema.safeParse({ ...baseRecord, arguments: args }).success).toBe(false);
  });

  it.each(SECRET_PAYLOADS)("rejects tool-call results with %s", (_label, results) => {
    expect(ToolCallRecordSchema.safeParse({ ...baseRecord, results }).success).toBe(false);
  });

  it("accepts null tool-call results and an empty event payload", () => {
    expect(ToolCallRecordSchema.safeParse(baseRecord).success).toBe(true);
    expect(SynacticEventSchema.safeParse(baseEvent).success).toBe(true);
  });
});
