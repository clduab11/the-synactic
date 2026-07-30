import { describe, it, expect } from "vitest";
import { SourceProvenanceSchema, ActionPolicySchema } from "@the-synactic/contracts";

import { McpGateway } from "./gateway.js";
import { GatewayError } from "./errors.js";
import { ToolRegistry } from "./registry.js";
import { InMemoryTransportSink } from "./transport.js";

function makeProvenance(sourceId = "test:gateway") {
  return SourceProvenanceSchema.parse({
    sourceId,
    sourceUri: "https://example.com/test",
    retrievedAt: "2026-01-01T00:00:00Z",
    integrityHash: null,
  });
}

function makePolicies(): readonly import("@the-synactic/contracts").ActionPolicy[] {
  return [
    ActionPolicySchema.parse({
      policyId: "p-read",
      toolPattern: "fs.read",
      effect: "allow",
      classification: "read",
      approval: null,
      allowedSideEffects: [],
    }),
    ActionPolicySchema.parse({
      policyId: "p-write-deny",
      toolPattern: "fs.write",
      effect: "deny",
      classification: "write",
      approval: null,
      allowedSideEffects: [],
    }),
    ActionPolicySchema.parse({
      policyId: "p-wildcard-deny",
      toolPattern: "danger.*",
      effect: "deny",
      classification: "read",
      approval: null,
      allowedSideEffects: [],
    }),
  ];
}

function makeGateway(policies = makePolicies()) {
  return new McpGateway({ policies, transport: new InMemoryTransportSink() });
}

function registerReadTool(gateway: McpGateway) {
  gateway.register({
    name: "fs.read",
    classification: "read",
    sideEffects: [],
    schemaRef: "fs.read/v1",
    execute: (args: Record<string, unknown>) => ({ path: args.path, content: "hello" }),
  });
}

function registerWriteTool(gateway: McpGateway) {
  gateway.register({
    name: "fs.write",
    classification: "write",
    sideEffects: ["disk-modify"],
    schemaRef: "fs.write/v1",
    execute: (args: Record<string, unknown>) => ({ written: true, path: args.path }),
  });
}

describe("McpGateway registration", () => {
  it("registers and lists tools", () => {
    const gw = makeGateway();
    registerReadTool(gw);
    expect(gw.hasTool("fs.read")).toBe(true);
    expect(gw.hasTool("missing")).toBe(false);
    expect(gw.listTools()).toHaveLength(1);
  });

  it("rejects duplicate registration", () => {
    const gw = makeGateway();
    registerReadTool(gw);
    expect(() => registerReadTool(gw)).toThrow(GatewayError);
  });

  it("does not leak tool name in duplicate error message", () => {
    const gw = makeGateway();
    registerReadTool(gw);
    try {
      registerReadTool(gw);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayError);
      expect((err as GatewayError).message).not.toContain("fs.read");
    }
  });
});

describe("McpGateway input validation", () => {
  it("rejects empty toolName", () => {
    const gw = makeGateway();
    expect(() =>
      gw.invoke({ toolName: "", arguments: {}, provenance: makeProvenance() }),
    ).toThrow(GatewayError);
  });

  it("rejects whitespace-only toolName", () => {
    const gw = makeGateway();
    expect(() =>
      gw.invoke({ toolName: "   ", arguments: {}, provenance: makeProvenance() }),
    ).toThrow(GatewayError);
  });

  it("rejects null arguments", () => {
    const gw = makeGateway();
    expect(() =>
      gw.invoke({ toolName: "fs.read", arguments: null as never, provenance: makeProvenance() }),
    ).toThrow(GatewayError);
  });

  it("rejects non-object arguments", () => {
    const gw = makeGateway();
    expect(() =>
      gw.invoke({ toolName: "fs.read", arguments: "string" as never, provenance: makeProvenance() }),
    ).toThrow(GatewayError);
  });
});

describe("McpGateway invoke — unknown tool (deny-by-default)", () => {
  it("denies unknown tool with record and event", () => {
    const gw = makeGateway();
    const prov = makeProvenance();
    const result = gw.invoke({
      toolName: "unknown.tool",
      arguments: { foo: "bar" },
      provenance: prov,
    });
    expect(result.ok).toBe(false);
    expect(result.record.toolName).toBe("unknown.tool");
    expect(result.record.decision).toBe("deny");
    expect(result.record.reasonCode).toBe("no-matching-policy");
    expect(result.record.provenance.sourceId).toBe("test:gateway");
    expect(result.event).not.toBeNull();
  });

  it("emits exactly one record for unknown tool", () => {
    const sink = new InMemoryTransportSink();
    const gw = new McpGateway({ policies: makePolicies(), transport: sink });
    gw.invoke({ toolName: "unknown", arguments: {}, provenance: makeProvenance() });
    expect(sink.drain()).toHaveLength(1);
  });
});

describe("McpGateway invoke — registered tools with policy", () => {
  it("allows read tool and returns actual execute results", () => {
    const gw = makeGateway();
    registerReadTool(gw);
    const result = gw.invoke({
      toolName: "fs.read",
      arguments: { path: "/etc/passwd" },
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(true);
    expect(result.record.decision).toBe("allow");
    expect(result.record.reasonCode).toBe("read-allowed");
    expect(result.record.results).toEqual({ path: "/etc/passwd", content: "hello" });
  });

  it("emits exactly one record per successful invocation", () => {
    const sink = new InMemoryTransportSink();
    const gw = new McpGateway({ policies: makePolicies(), transport: sink });
    registerReadTool(gw);
    gw.invoke({ toolName: "fs.read", arguments: {}, provenance: makeProvenance() });
    expect(sink.drain()).toHaveLength(1);
  });

  it("denies write tool without approval due to side effects", () => {
    const gw = makeGateway();
    registerWriteTool(gw);
    const result = gw.invoke({
      toolName: "fs.write",
      arguments: { path: "/tmp/x" },
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(false);
    expect(result.record.decision).toBe("deny");
    expect(result.record.reasonCode).toBe("side-effect-not-allowed");
  });

  it("denies tool matching deny wildcard", () => {
    const gw = makeGateway();
    gw.register({
      name: "danger.explode",
      classification: "read",
      sideEffects: [],
      schemaRef: "danger/v1",
      execute: () => ({ boom: true }),
    });
    const result = gw.invoke({
      toolName: "danger.explode",
      arguments: {},
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(false);
    expect(result.record.reasonCode).toBe("policy-denied");
  });

  it("allows with correct correlation", () => {
    const gw = makeGateway();
    registerReadTool(gw);
    const eventId = "550e8400-e29b-41d4-a716-446655440000";
    const result = gw.invoke({
      toolName: "fs.read",
      arguments: { path: "/x" },
      correlationEventId: eventId,
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(true);
    expect(result.record.correlationId).toBe(eventId);
  });

  it("handles execute() throwing an error", () => {
    const gw = makeGateway();
    gw.register({
      name: "fs.read",
      classification: "read",
      sideEffects: [],
      schemaRef: "fs.read/v1",
      execute: () => { throw new Error("disk failure"); },
    });
    const result = gw.invoke({
      toolName: "fs.read",
      arguments: { path: "/x" },
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(false);
    expect(result.record.decision).toBe("allow");
    expect(result.record.results).toBeNull();
  });

  it("returns failure for execute() returning secret-shaped data", () => {
    const gw = makeGateway();
    gw.register({
      name: "fs.read",
      classification: "read",
      sideEffects: [],
      schemaRef: "fs.read/v1",
      execute: () => ({ apiKey: "sk-12345" }),
    });
    const result = gw.invoke({
      toolName: "fs.read",
      arguments: { path: "/x" },
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(false);
    expect(result.record.results).toBeNull();
  });

  it("returns failure for execute() returning non-object", () => {
    const gw = makeGateway();
    gw.register({
      name: "fs.read",
      classification: "read",
      sideEffects: [],
      schemaRef: "fs.read/v1",
      execute: () => "string-result" as unknown as Record<string, unknown>,
    });
    const result = gw.invoke({
      toolName: "fs.read",
      arguments: { path: "/x" },
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(false);
    expect(result.record.results).toBeNull();
  });

  it("returns failure for execute() returning array", () => {
    const gw = makeGateway();
    gw.register({
      name: "fs.read",
      classification: "read",
      sideEffects: [],
      schemaRef: "fs.read/v1",
      execute: () => [1, 2, 3] as unknown as Record<string, unknown>,
    });
    const result = gw.invoke({
      toolName: "fs.read",
      arguments: { path: "/x" },
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(false);
    expect(result.record.results).toBeNull();
  });
});

describe("McpGateway envelope integration", () => {
  it("emits valid SynacticEvent on allow", () => {
    const gw = makeGateway();
    registerReadTool(gw);
    const result = gw.invoke({
      toolName: "fs.read",
      arguments: { path: "/x" },
      provenance: makeProvenance("src-1"),
    });
    expect(result.ok).toBe(true);
    const ev = result.event;
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("tool.invoked");
    expect(ev!.provenance.sourceId).toBe("src-1");
    expect(ev!.payload.toolName).toBe("fs.read");
    expect(ev!.payload.decision).toBe("allow");
  });

  it("emits event on deny", () => {
    const gw = makeGateway();
    const result = gw.invoke({
      toolName: "nope",
      arguments: {},
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(false);
    expect(result.event).not.toBeNull();
  });

  it("throws when payload contains secrets", () => {
    const gw = makeGateway();
    registerReadTool(gw);
    expect(() =>
      gw.invoke({
        toolName: "fs.read",
        arguments: { apiKey: "sk-test" },
        provenance: makeProvenance(),
      }),
    ).toThrow();
  });
});

describe("McpGateway transport", () => {
  it("captures exactly one record per invocation", () => {
    const sink = new InMemoryTransportSink();
    const gw = new McpGateway({ policies: makePolicies(), transport: sink });
    registerReadTool(gw);
    gw.invoke({ toolName: "fs.read", arguments: {}, provenance: makeProvenance() });
    gw.invoke({ toolName: "fs.read", arguments: {}, provenance: makeProvenance() });
    expect(sink.drain()).toHaveLength(2);
    sink.clear();
    expect(sink.drain()).toHaveLength(0);
  });

  it("captures record for denied invocation", () => {
    const sink = new InMemoryTransportSink();
    const gw = new McpGateway({ policies: makePolicies(), transport: sink });
    gw.invoke({ toolName: "unknown", arguments: {}, provenance: makeProvenance() });
    const records = sink.drain();
    expect(records).toHaveLength(1);
    expect(records[0].decision).toBe("deny");
  });
});

describe("McpGateway secret guard", () => {
  it("rejects secret-shaped arguments", () => {
    const gw = makeGateway();
    const prov = makeProvenance();
    expect(() =>
      gw.invoke({
        toolName: "fs.read",
        arguments: { password: "secret123" },
        provenance: prov,
      }),
    ).toThrow();
  });

  it("rejects nested secret-shaped arguments", () => {
    const gw = makeGateway();
    const prov = makeProvenance();
    expect(() =>
      gw.invoke({
        toolName: "fs.read",
        arguments: { config: { apiKey: "sk-test" } },
        provenance: prov,
      }),
    ).toThrow();
  });
});

describe("McpGateway empty policies", () => {
  it("denies all tools with empty policy list", () => {
    const gw = new McpGateway({ policies: [], transport: new InMemoryTransportSink() });
    registerReadTool(gw);
    const result = gw.invoke({
      toolName: "fs.read",
      arguments: {},
      provenance: makeProvenance(),
    });
    expect(result.ok).toBe(false);
    expect(result.record.decision).toBe("deny");
    expect(result.record.reasonCode).toBe("no-matching-policy");
  });
});

describe("ToolRegistry standalone", () => {
  it("stores and retrieves descriptors", () => {
    const reg = new ToolRegistry();
    reg.register({ name: "a", classification: "read", sideEffects: [], schemaRef: "a", execute: () => ({}) });
    expect(reg.get("a")!.name).toBe("a");
    expect(reg.list()).toHaveLength(1);
  });
});
