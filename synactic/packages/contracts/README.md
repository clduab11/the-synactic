# @the-synactic/contracts

Shared type definitions and zod schemas for the-synactic platform.

Pure package: zero I/O, zero network, zero side effects; the only
runtime dependency is `zod`.

## Contracts

- `SynacticEvent` / `SynacticEventSchema` — platform event envelope.
  Strict object (unknown top-level fields rejected), `version` pinned
  to `ENVELOPE_VERSION` (`1`), required `SourceProvenance`, and a
  secret-guarded `payload`. There are no dedicated credential-carrying
  fields by design.
- `SourceProvenance` / `SourceProvenanceSchema` — verifiable source
  metadata: `sourceId`, `sourceUri`, `retrievedAt`, and a nullable
  `integrityHash` slot that is present in the type by design.
- `ToolCallRecord` / `ToolCallRecordSchema` — auditable record of one
  mediated tool call: decision (`allow` / `deny` / `require-approval`)
  with a machine-readable kebab-case `reasonCode`, `policyId`
  reference, required provenance, and `correlationId` back to the
  triggering event. `arguments` and `results` are secret-guarded.
- `ActionPolicy` / `ActionPolicySchema` — explicit, auditable tool
  policy with secure defaults: `effect` defaults to `"deny"`,
  `classification` defaults to `"read"`, `allowedSideEffects`
  defaults to `[]`, and write operations carry an `ApprovalGrant`
  (`grantedBy`, `grantedAt`, required `expiresAt`, single-use
  semantics via `usedAt`).
- `DigestRequest` / `DigestResponse` — digest query (`topics`,
  `window`, `limit`) and result (`generatedAt`, `items[]`); every
  digest item carries required `SourceProvenance`.

## Secret guard

Tool-policy principle (c) — secrets are never logged, echoed, or
passed through event envelopes — is encoded as executable validation:

- `SECRET_FIELD_PATTERN` — case-insensitive regex matching credential
  carrier key names (`token`, `password`, `secret`, `api-key`,
  `credential`, ...).
- `SECRET_VALUE_PATTERNS` — regexes for well-known secret shapes
  (`sk-...`, `ghp_...`, `AKIA...`, JWTs, PEM private-key headers, ...).
- `findSecretShapedField(value)` — pure deep-search predicate.
- `assertNoSecretShapedFields(value)` — throws on secret-shaped fields.
- `noSecretShapedFields(value, ctx)` — reusable zod `.superRefine`
  mixin; applied to event payloads and tool-call arguments/results via
  `SecretSafeRecordSchema`.

## Conventions

- Timestamps are ISO 8601 strings with explicit timezone information
  (`IsoTimestampSchema` = `z.iso.datetime({ offset: true })`); naive
  local datetimes are rejected.
- All object schemas use `z.strictObject`: unknown fields are rejected.
- Relative imports use explicit `.js` extensions (ESM NodeNext).
