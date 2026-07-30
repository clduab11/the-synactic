// MCP Gateway — in-process tool mediation with policy + envelope integration
export { McpGateway } from "./gateway.js";
export type { GatewayConfig, InvokeToolInput, InvokeToolResult, InvokeToolSuccess, InvokeToolDenied } from "./gateway.js";

export { ToolRegistry } from "./registry.js";
export type { ToolDescriptor } from "./registry.js";

export { InMemoryTransportSink, NoOpTransportSink } from "./transport.js";
export type { TransportSink } from "./transport.js";

export { GatewayError, GatewayErrorCodes } from "./errors.js";
