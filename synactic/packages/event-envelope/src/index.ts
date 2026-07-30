// Public API of @the-synactic/event-envelope.

export {
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  DEFAULT_MAX_PAYLOAD_BYTES,
  resolveEnvelopeOptions,
} from "./options.js";
export type { EnvelopeOptions, ResolvedEnvelopeOptions } from "./options.js";

export type { EnvelopeIssue, EventValidationResult } from "./result.js";

export { createEvent } from "./create.js";
export type { CreateEventInput } from "./create.js";

export { validateEvent } from "./validate.js";

export { deserializeEvent, serializeEvent } from "./serialize.js";

// Convenience re-exports from the underlying contracts.
export { ENVELOPE_VERSION } from "@the-synactic/contracts";
export type { SynacticEvent } from "@the-synactic/contracts";
