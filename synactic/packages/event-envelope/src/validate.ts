import { Buffer } from "node:buffer";

import { SynacticEventSchema, findSecretShapedField } from "@the-synactic/contracts";

import type { EnvelopeOptions } from "./options.js";
import { resolveEnvelopeOptions } from "./options.js";
import type { EnvelopeIssue, EventValidationResult } from "./result.js";

/**
 * Strictly validates unknown data as a SynacticEvent.
 *
 * Enforcement layers, in order:
 * 1. Contracts schema parse. Contracts schemas are z.strictObject at every
 *    level, so unknown fields are rejected everywhere. The schema's
 *    SecretSafeRecordSchema also rejects secret-shaped payloads (tool-policy
 *    principle c: REJECT, never redact).
 * 2. Defense-in-depth secret re-check via findSecretShapedField, so no
 *    refactor of this module can silently drop the guard.
 * 3. Oversized payload rejection: JSON.stringify(payload) measured in UTF-8
 *    bytes must not exceed maxPayloadBytes.
 * 4. Future-dated timestamp rejection: timestamp must not be more than
 *    clockSkewToleranceMs ahead of now().
 *
 * Never throws for validation failures; returns a discriminated result.
 */
export function validateEvent(data: unknown, options?: EnvelopeOptions): EventValidationResult {
  const opts = resolveEnvelopeOptions(options);

  const parsed = SynacticEventSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((zi) => ({
        code: zi.code,
        message: zi.message,
        path: (zi.path ?? []).map((p) => (typeof p === "symbol" ? String(p) : p)),
      })),
    };
  }
  const event = parsed.data;

  const issues: EnvelopeIssue[] = [];

  const secretHit = findSecretShapedField(event.payload);
  if (secretHit) {
    issues.push({
      code: "secret_shaped_field",
      message: `Secret-shaped ${secretHit.kind} rejected: secrets must never pass through event envelopes`,
      path: ["payload", ...secretHit.path],
    });
  }

  let payloadJson: string | undefined;
  try {
    payloadJson = JSON.stringify(event.payload);
  } catch {
    issues.push({
      code: "payload_not_serializable",
      message: "Payload is not JSON-serializable",
      path: ["payload"],
    });
  }
  if (payloadJson !== undefined && Buffer.byteLength(payloadJson, "utf8") > opts.maxPayloadBytes) {
    issues.push({
      code: "payload_too_large",
      message: `Serialized payload exceeds ${opts.maxPayloadBytes} bytes`,
      path: ["payload"],
    });
  }

  const eventTime = Date.parse(event.timestamp);
  if (Number.isNaN(eventTime)) {
    issues.push({
      code: "invalid_timestamp",
      message: "Timestamp is not parseable",
      path: ["timestamp"],
    });
  } else if (eventTime - opts.now().getTime() > opts.clockSkewToleranceMs) {
    issues.push({
      code: "timestamp_in_future",
      message: `Timestamp is more than ${opts.clockSkewToleranceMs}ms in the future`,
      path: ["timestamp"],
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, event };
}
