export class GatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export const GatewayErrorCodes = {
  ToolAlreadyRegistered: "tool-already-registered",
  UnknownTool: "unknown-tool",
  SecretInArguments: "secret-in-arguments",
  EventValidationFailed: "event-validation-failed",
  InvalidInput: "invalid-input",
  InvalidResult: "invalid-result",
  SecretInResult: "secret-in-result",
} as const;
