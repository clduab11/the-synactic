# @the-synactic/event-envelope

Event envelope creation, strict validation, and JSON (de)serialization for
the-synactic platform, built on `@the-synactic/contracts`.

Pure functions only: no I/O, no network, no side effects. ESM (NodeNext).

## API

### `createEvent(input, options?)`

Builds a `SynacticEvent` — fills `id` (`node:crypto` `randomUUID`),
`timestamp` (`options.now()`, ISO 8601) and pins `version` to
`ENVELOPE_VERSION` — then runs full validation before returning.
Non-throwing for validation failures.

### `validateEvent(data, options?)`

Strictly validates unknown data: contracts schema parse (`z.strictObject`
at every level, so unknown fields are rejected everywhere), secret-guard
re-check, payload size limit, future-timestamp limit. Returns
`{ ok: true, event } | { ok: false, issues }` — never throws for
validation failures.

### `serializeEvent(event)` / `deserializeEvent(json, options?)`

JSON round-trip. `deserializeEvent` re-validates strictly (full
`validateEvent`).

### `EnvelopeOptions`

| option | default | effect |
| --- | --- | --- |
| `maxPayloadBytes` | `64 * 1024` | serialized payload byte limit (`payload_too_large`) |
| `clockSkewToleranceMs` | `5 * 60 * 1000` | max future skew for `timestamp` (`timestamp_in_future`) |
| `now` | `() => new Date()` | injectable clock for deterministic testing |

## Policy enforcement

- **Secrets** (tool-policy principle c): payloads are guarded by the
  contracts secret guard on every ingress path (create / validate /
  deserialize) — REJECT, never redact.
- **Oversized payloads**: serialized payload bytes must not exceed
  `maxPayloadBytes`.
- **Future-dated timestamps**: `timestamp` must not be more than
  `clockSkewToleranceMs` ahead of `now()`.
- `src/secret-proof.test.ts` is the committed static + runtime proof.
