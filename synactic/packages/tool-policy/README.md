# @the-synactic/tool-policy

Pure, deterministic policy evaluator for mediated tool calls. Implements
docs/TOOL-POLICY.md: default read-only posture, explicit human approval
before writes, secrets never logged, and no external side effects
without explicit policy allowance.

## API

- `evaluatePolicy(policies, call, options?) => PolicyDecision` — evaluate
  a `ToolCallDescriptor` against `ActionPolicy[]`. `options.now` injects
  the clock (default `new Date()` — the evaluator's only non-injected
  clock read).
- `matchesToolPattern(toolPattern, toolName)` — matching predicate. A
  single trailing `*` is the only wildcard (prefix match): `fs.*`
  matches `fs.read` but not `fs`; `*` matches everything; any other
  character is literal.
- `buildToolCallRecord(input) => ToolCallRecord` — minimal helper
  building a contracts `ToolCallRecord` from a decision. Pure (id and
  timestamp injected); validation, including the secret guard on
  arguments/results, via `ToolCallRecordSchema.parse`.
- Schemas/types: `ToolCallDescriptorSchema` (`ToolCallDescriptor`,
  `ToolCallDescriptorInput`), `PolicyDecisionSchema` (`PolicyDecision`,
  `PolicyReasonCode`), `ReasonCodes`, `REASON_MESSAGES`,
  `UNMATCHED_POLICY_ID` (policyId sentinel for no-match records).

## Decision table

Evaluated in this exact order against the single winning policy
(see tie-breaking):

| # | Condition | decision | reasonCode |
|---|-----------|----------|------------|
| 1 | no matching policy | deny | `no-matching-policy` (policyId null) |
| 2 | any `requestedSideEffects` entry not in `allowedSideEffects` | deny | `side-effect-not-allowed` |
| 3 | policy effect `deny` | deny | `policy-denied` |
| 4 | effective classification `read` | allow | `read-allowed` |
| 5 | effective classification `write`, no grant | require-approval | `write-requires-approval` |
| 6 | write, grant expired (`expiresAt <= now`) | require-approval | `approval-expired` |
| 7 | write, single-use grant consumed (`usedAt` set) | require-approval | `approval-already-used` |
| 8 | write, valid grant | allow | `write-approved` |

Effective classification = `call.classification` when declared, else the
matched policy's classification ("defaults per policy match"). Grants
are scoped structurally: an `ApprovalGrant` lives on its policy, and
only the winning policy's grant is considered.

Tie-breaking when multiple policies match: (1) most specific pattern
(longest literal prefix) wins; (2) an exact pattern beats a trailing
wildcard of equal prefix length; (3) deny-over-allow; (4) `policyId`
ascending. Sorting is stable, so the outcome is fully deterministic.

## Purity and determinism

- Zero I/O, zero side effects, zero network, zero logging.
- Time only via `options.now` (inject it for deterministic replays).
- Inputs are never mutated: the policy list is copied before sorting
  and grants are read-only. Marking a single-use grant consumed
  (`usedAt`) after a `write-approved` decision is the CALLER's job.
- Fail-closed: malformed grant timestamps or an invalid injected clock
  resolve to `approval-expired`, never to an allow.
- Principle (c) is structural: the descriptor carries no tool arguments
  and all decision messages are compile-time constants — nothing can
  echo arguments, side-effect names, or secret material.

## Scope

Wave 2 ships this evaluator plus a smoke test (`test/`). The full test
suite lands in Wave 3. The logging transport/sink for `ToolCallRecord`
is future work (docs/TOOL-POLICY.md principle 5).
