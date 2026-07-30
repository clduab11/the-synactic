import type { SynacticEvent } from "@the-synactic/contracts";

import type { EnvelopeOptions } from "./options.js";
import type { EventValidationResult } from "./result.js";
import { validateEvent } from "./validate.js";

/**
 * Serializes an already-validated event to JSON. Trusted-side helper:
 * producers obtain events via createEvent/validateEvent, which enforce
 * all envelope policy. Per spec, only deserialization re-validates.
 */
export function serializeEvent(event: SynacticEvent): string {
  return JSON.stringify(event);
}

/**
 * Parses JSON and strictly re-validates it as a SynacticEvent (full
 * validateEvent: schema + secret guard + size + skew). Never throws for
 * validation failures; invalid JSON yields an "invalid_json" issue.
 */
export function deserializeEvent(json: string, options?: EnvelopeOptions): EventValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return {
      ok: false,
      issues: [{ code: "invalid_json", message: "Input is not valid JSON", path: [] }],
    };
  }
  return validateEvent(data, options);
}
