import { randomUUID } from "node:crypto";

import {
  SourceProvenanceSchema,
  findSecretShapedField,
  type SourceProvenance,
  type ToolCallRecord,
} from "@the-synactic/contracts";
import { createEvent } from "@the-synactic/event-envelope";
import { buildToolCallRecord, evaluatePolicy } from "@the-synactic/tool-policy";
import type { ActionPolicy } from "@the-synactic/contracts";

import type { ToolDescriptor } from "./registry.js";
import type { TransportSink } from "./transport.js";
import { InMemoryTransportSink } from "./transport.js";
import { GatewayError, GatewayErrorCodes } from "./errors.js";

export interface GatewayConfig {
  readonly policies: readonly ActionPolicy[];
  readonly transport?: TransportSink;
  readonly now?: () => Date;
}

export interface InvokeToolInput {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly requestedSideEffects?: readonly string[];
  readonly correlationEventId?: string;
  readonly provenance: SourceProvenance;
}

export interface InvokeToolSuccess {
  readonly ok: true;
  readonly record: ToolCallRecord;
  readonly event: import("@the-synactic/contracts").SynacticEvent | null;
}

export interface InvokeToolDenied {
  readonly ok: false;
  readonly record: ToolCallRecord;
  readonly event: import("@the-synactic/contracts").SynacticEvent | null;
}

export type InvokeToolResult = InvokeToolSuccess | InvokeToolDenied;

export { GatewayError, GatewayErrorCodes } from "./errors.js";

function validateProvenance(base: SourceProvenance): SourceProvenance {
  return SourceProvenanceSchema.parse({
    sourceId: base.sourceId,
    sourceUri: base.sourceUri,
    retrievedAt: base.retrievedAt,
    integrityHash: base.integrityHash,
  });
}

function validateInput(input: InvokeToolInput): void {
  if (!input.toolName || input.toolName.trim().length === 0) {
    throw new GatewayError(GatewayErrorCodes.InvalidInput, "toolName must be non-empty");
  }
  if (input.arguments === null || typeof input.arguments !== "object") {
    throw new GatewayError(GatewayErrorCodes.InvalidInput, "arguments must be an object");
  }
  const secretHit = findSecretShapedField(input.arguments);
  if (secretHit) {
    throw new GatewayError(GatewayErrorCodes.SecretInArguments, "Arguments contain secret-shaped fields");
  }
}

function validateResult(result: unknown): Record<string, unknown> | null {
  if (result === null || result === undefined) return null;
  if (typeof result !== "object" || Array.isArray(result)) {
    throw new GatewayError(GatewayErrorCodes.InvalidResult, "Tool result must be a plain object");
  }
  const secretHit = findSecretShapedField(result as Record<string, unknown>);
  if (secretHit) {
    throw new GatewayError(GatewayErrorCodes.SecretInResult, "Tool result contains secret-shaped fields");
  }
  return result as Record<string, unknown>;
}

export class McpGateway {
  private readonly registry = new Map<string, ToolDescriptor>();
  private readonly policies: readonly ActionPolicy[];
  private readonly transport: TransportSink;
  private readonly now: () => Date;

  constructor(config: GatewayConfig) {
    this.policies = config.policies;
    this.transport = config.transport ?? new InMemoryTransportSink();
    this.now = config.now ?? (() => new Date());
  }

  register(tool: ToolDescriptor): void {
    if (this.registry.has(tool.name)) {
      throw new GatewayError(GatewayErrorCodes.ToolAlreadyRegistered, "Tool already registered");
    }
    this.registry.set(tool.name, tool);
  }

  hasTool(name: string): boolean {
    return this.registry.has(name);
  }

  listTools(): readonly ToolDescriptor[] {
    return Array.from(this.registry.values());
  }

  invoke(input: InvokeToolInput): InvokeToolResult {
    validateInput(input);
    const recordId = randomUUID();
    const correlationId = input.correlationEventId ?? randomUUID();
    const timestamp = this.now().toISOString();
    const provenance = validateProvenance(input.provenance);

    const descriptor = this.registry.get(input.toolName);
    if (descriptor === undefined) {
      const sideEffects = input.requestedSideEffects ? [...input.requestedSideEffects] : [];
      const decision = evaluatePolicy(this.policies, {
        toolName: input.toolName,
        requestedSideEffects: sideEffects,
        correlationId,
      });
      const record = buildToolCallRecord({
        id: recordId,
        toolName: input.toolName,
        arguments: input.arguments,
        decision,
        timestamp,
        provenance,
        correlationId,
        results: null,
      });
      this.transport.emit(record);
      const eventResult = this.maybeEmitEvent(input, decision, record, null);
      return { ok: false, record, event: eventResult };
    }

    const sideEffects = input.requestedSideEffects
      ? [...input.requestedSideEffects]
      : [...descriptor.sideEffects];

    const decision = evaluatePolicy(this.policies, {
      toolName: input.toolName,
      classification: descriptor.classification,
      requestedSideEffects: sideEffects,
      correlationId,
    });

    if (decision.decision !== "allow") {
      const record = buildToolCallRecord({
        id: recordId,
        toolName: input.toolName,
        arguments: input.arguments,
        decision,
        timestamp,
        provenance,
        correlationId,
        results: null,
      });
      this.transport.emit(record);
      const eventResult = this.maybeEmitEvent(input, decision, record, null);
      return { ok: false, record, event: eventResult };
    }

    let result: Record<string, unknown> | null;
    try {
      const rawResult = descriptor.execute(input.arguments);
      result = validateResult(rawResult);
    } catch {
      const record = buildToolCallRecord({
        id: recordId,
        toolName: input.toolName,
        arguments: input.arguments,
        decision,
        timestamp,
        provenance,
        correlationId,
        results: null,
      });
      this.transport.emit(record);
      const eventResult = this.maybeEmitEvent(input, decision, record, null);
      return { ok: false, record, event: eventResult };
    }

    const record = buildToolCallRecord({
      id: recordId,
      toolName: input.toolName,
      arguments: input.arguments,
      decision,
      timestamp,
      provenance,
      correlationId,
      results: result,
    });
    this.transport.emit(record);

    const eventResult = this.maybeEmitEvent(input, decision, record, result);
    return { ok: true, record, event: eventResult };
  }

  private maybeEmitEvent(
    input: InvokeToolInput,
    decision: import("@the-synactic/tool-policy").PolicyDecision,
    record: ToolCallRecord,
    resultValue: Record<string, unknown> | null,
  ): import("@the-synactic/contracts").SynacticEvent | null {
    const eventRes = createEvent({
      type: "tool.invoked",
      provenance: validateProvenance(input.provenance),
      payload: {
        toolName: input.toolName,
        arguments: input.arguments,
        decision: decision.decision,
        reasonCode: decision.reasonCode,
        recordId: record.id,
        result: resultValue,
      },
    });
    if (!eventRes.ok) return null;
    return eventRes.event;
  }
}
