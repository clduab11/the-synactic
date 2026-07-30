import { z } from "zod";

/**
 * Tool-policy principle (c): secrets are never logged, echoed, or passed
 * through event envelopes. This module encodes that rule as executable
 * validation, not comments: any structure carrying secret-shaped keys or
 * values is REJECTED.
 */

/**
 * Matches field names that conventionally carry credentials
 * (token / password / secret / api-key / credential variants, ...).
 * Case-insensitive. Fail-closed by design: a benign field whose name
 * merely resembles a credential carrier is also rejected.
 */
export const SECRET_FIELD_PATTERN =
  /(secret|password|passwd|pwd|token|api[-_]?key|apikey|credentials?|bearer|private[-_]?key|access[-_]?key|session[-_]?key|signing[-_]?key)/i;

/**
 * Matches string values that look like well-known secret material:
 * OpenAI ("sk-..."), GitHub ("ghp_...", "github_pat_...", ...),
 * AWS ("AKIA..."), Google ("AIza..."), Slack ("xox..."),
 * JWTs, and PEM private-key headers.
 */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI-style API keys
  /\bghp_[A-Za-z0-9]{20,}/, // GitHub personal access token
  /\bgho_[A-Za-z0-9]{20,}/, // GitHub OAuth token
  /\bghu_[A-Za-z0-9]{20,}/, // GitHub user-to-server token
  /\bghs_[A-Za-z0-9]{20,}/, // GitHub server-to-server token
  /\bghr_[A-Za-z0-9]{20,}/, // GitHub refresh token
  /\bgithub_pat_[A-Za-z0-9_]{20,}/, // GitHub fine-grained PAT
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{20,}/, // Google API key
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, // PEM private key material
];

export interface SecretShapedFieldHit {
  /** Path (object keys / array indices) to the offending field. */
  readonly path: readonly (string | number)[];
  /** What matched: the field name ("key") or the field content ("value"). */
  readonly kind: "key" | "value";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function findHit(
  value: unknown,
  path: readonly (string | number)[],
  seen: WeakSet<object>,
): SecretShapedFieldHit | null {
  if (typeof value === "string") {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) return { path, kind: "value" };
    }
    return null;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    for (let i = 0; i < value.length; i++) {
      const hit = findHit(value[i], [...path, i], seen);
      if (hit) return hit;
    }
    return null;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_FIELD_PATTERN.test(key)) {
        return { path: [...path, key], kind: "key" };
      }
      const hit = findHit(child, [...path, key], seen);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Pure predicate: returns the first secret-shaped field found inside
 * `value` (deep search over plain objects and arrays, cycle-safe),
 * or null when the structure is clean.
 */
export function findSecretShapedField(value: unknown): SecretShapedFieldHit | null {
  return findHit(value, [], new WeakSet());
}

function formatPath(path: readonly (string | number)[]): string {
  return path.length === 0 ? "<root>" : path.map(String).join(".");
}

/**
 * Throws when `value` contains secret-shaped fields; no-op otherwise.
 * Intended for hand-rolled construction sites (producers, sinks) that
 * want fail-fast enforcement outside zod parsing.
 */
export function assertNoSecretShapedFields(value: unknown): void {
  const hit = findSecretShapedField(value);
  if (hit) {
    throw new Error(
      `Secret-shaped ${hit.kind} rejected at ${formatPath(hit.path)}: ` +
        "secrets must never pass through event envelopes or tool-call records",
    );
  }
}

/**
 * Reusable zod `.superRefine` mixin implementing the same rejection
 * during schema parsing. Adds a single issue pointing at the first
 * offending field.
 */
export function noSecretShapedFields(value: unknown, ctx: z.RefinementCtx): void {
  const hit = findSecretShapedField(value);
  if (hit) {
    ctx.addIssue({
      code: "custom",
      message: `Secret-shaped ${hit.kind} rejected: secrets must never pass through event envelopes or tool-call records`,
      path: [...hit.path],
    });
  }
}

/**
 * Structured record guaranteed free of secret-shaped keys/values.
 * Used for event payloads and tool-call arguments/results.
 */
export const SecretSafeRecordSchema = z
  .record(z.string(), z.unknown())
  .superRefine(noSecretShapedFields);

export type SecretSafeRecord = z.infer<typeof SecretSafeRecordSchema>;
