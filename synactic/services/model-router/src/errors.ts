export class RouterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RouterError";
  }
}

export const RouterErrorCodes = {
  ModelNotAllowed: "model-not-allowed",
  ProviderNotFound: "provider-not-found",
  MaxTokensExceeded: "max-tokens-exceeded",
  SecretInMetadata: "secret-in-metadata",
  Timeout: "timeout",
  ProviderError: "provider-error",
  InvalidResponse: "invalid-response",
  DuplicateProvider: "duplicate-provider",
  EmptyPrompt: "empty-prompt",
  InvalidMaxTokens: "invalid-max-tokens",
} as const;
