import type { SourceProvenance, SynacticEvent } from "@the-synactic/contracts";
import { SourceProvenanceSchema, findSecretShapedField } from "@the-synactic/contracts";
import { createEvent } from "@the-synactic/event-envelope";

import { RouterError, RouterErrorCodes } from "./errors.js";

export interface ModelRequest {
  readonly prompt: string;
  readonly maxTokens?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface ModelResponse {
  readonly content: string;
  readonly tokenCount: number;
  readonly provider: string;
  readonly model: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ModelProvider {
  readonly providerId: string;
  readonly modelId: string;
  complete(request: ModelRequest): Promise<ModelResponse> | ModelResponse;
}

export interface FakeModelProviderConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly responseTemplate?: string;
  readonly delayMs?: number;
  readonly failRate?: number;
}

export class FakeModelProvider implements ModelProvider {
  readonly providerId: string;
  readonly modelId: string;
  private readonly template: string;
  private readonly delayMs: number;
  private readonly failRate: number;
  private callCount = 0;

  constructor(config: FakeModelProviderConfig) {
    this.providerId = config.providerId;
    this.modelId = config.modelId;
    this.template = config.responseTemplate ?? "fake-response-{call}";
    this.delayMs = config.delayMs ?? 0;
    this.failRate = Math.max(0, Math.min(1, config.failRate ?? 0));
  }

  complete(request: ModelRequest): Promise<ModelResponse> | ModelResponse {
    this.callCount += 1;
    if (Math.random() < this.failRate) {
      throw new Error(`FakeModelProvider intentional failure (call ${this.callCount})`);
    }
    const content = this.template
      .replace("{call}", String(this.callCount))
      .replace("{prompt}", request.prompt.slice(0, 40))
      .replace("{model}", this.modelId);
    const result: ModelResponse = {
      content,
      tokenCount: content.length,
      provider: this.providerId,
      model: this.modelId,
    };
    if (this.delayMs > 0) {
      return new Promise((resolve) => setTimeout(() => resolve(result), this.delayMs));
    }
    return result;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

export interface RouterConfig {
  readonly providers: readonly ModelProvider[];
  readonly allowList?: readonly string[];
  readonly defaultMaxTokens?: number;
  readonly defaultTimeoutMs?: number;
  readonly now?: () => Date;
}

export interface RouteRequestInput {
  readonly prompt: string;
  readonly modelPreference?: string;
  readonly maxTokens?: number;
  readonly provenance: SourceProvenance;
}

export interface RouteSuccess {
  readonly ok: true;
  readonly response: ModelResponse;
  readonly envelope: SynacticEvent | null;
  readonly providerUsed: string;
}

export interface RouteFailure {
  readonly ok: false;
  readonly errorCode: string;
  readonly envelope: SynacticEvent | null;
  readonly providerUsed: string | null;
}

export type RouteResult = RouteSuccess | RouteFailure;

function validateProvenance(base: SourceProvenance): SourceProvenance {
  return SourceProvenanceSchema.parse({
    sourceId: base.sourceId,
    sourceUri: base.sourceUri,
    retrievedAt: base.retrievedAt,
    integrityHash: base.integrityHash,
  });
}

function validateResponse(response: unknown): ModelResponse {
  if (response === null || response === undefined) {
    throw new RouterError(RouterErrorCodes.InvalidResponse, "Provider returned null/undefined");
  }
  if (typeof response !== "object") {
    throw new RouterError(RouterErrorCodes.InvalidResponse, "Provider response must be an object");
  }
  const r = response as Record<string, unknown>;
  if (typeof r.content !== "string" || r.content.length === 0) {
    throw new RouterError(RouterErrorCodes.InvalidResponse, "Response content must be a non-empty string");
  }
  if (typeof r.tokenCount !== "number" || r.tokenCount < 0 || !Number.isFinite(r.tokenCount)) {
    throw new RouterError(RouterErrorCodes.InvalidResponse, "tokenCount must be a non-negative finite number");
  }
  if (typeof r.provider !== "string" || r.provider.length === 0) {
    throw new RouterError(RouterErrorCodes.InvalidResponse, "provider must be a non-empty string");
  }
  if (typeof r.model !== "string" || r.model.length === 0) {
    throw new RouterError(RouterErrorCodes.InvalidResponse, "model must be a non-empty string");
  }
  if (r.metadata !== undefined && r.metadata !== null) {
    if (typeof r.metadata !== "object" || Array.isArray(r.metadata)) {
      throw new RouterError(RouterErrorCodes.InvalidResponse, "metadata must be a plain object");
    }
  }
  return response as ModelResponse;
}

function checkMetadataSecrets(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return findSecretShapedField(metadata) !== null;
}

function buildEnvelope(
  prompt: string,
  response: ModelResponse | null,
  errorCode: string | null,
  provenance: SourceProvenance,
): SynacticEvent | null {
  const res = createEvent({
    type: "model.routed",
    provenance: validateProvenance(provenance),
    payload: {
      prompt: prompt.slice(0, 500),
      response: response
        ? { content: response.content.slice(0, 500), provider: response.provider, model: response.model }
        : null,
      errorCode,
    },
  });
  return res.ok ? res.event : null;
}

export class ModelRouter {
  private readonly providers: Map<string, ModelProvider>;
  private readonly allowList: Set<string>;
  private readonly defaultMaxTokens: number;
  private readonly defaultTimeoutMs: number;
  private readonly now: () => Date;

  constructor(config: RouterConfig) {
    this.providers = new Map();
    for (const p of config.providers) {
      const key = `${p.providerId}:${p.modelId}`;
      if (this.providers.has(key)) {
        throw new RouterError(RouterErrorCodes.DuplicateProvider, `Duplicate provider: ${key}`);
      }
      this.providers.set(key, p);
    }
    this.allowList = new Set(config.allowList ?? Array.from(this.providers.keys()));
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30000;
    this.now = config.now ?? (() => new Date());
  }

  availableModels(): readonly string[] {
    return Array.from(this.providers.keys());
  }

  async route(input: RouteRequestInput): Promise<RouteResult> {
    if (!input.prompt || input.prompt.trim().length === 0) {
      const env = buildEnvelope("", null, "empty-prompt", input.provenance);
      return { ok: false, errorCode: "empty-prompt", envelope: env, providerUsed: null };
    }

    const providerKey = input.modelPreference ?? Array.from(this.providers.keys())[0];
    if (providerKey === undefined || !this.allowList.has(providerKey)) {
      const env = buildEnvelope(input.prompt, null, "model-not-allowed", input.provenance);
      return { ok: false, errorCode: "model-not-allowed", envelope: env, providerUsed: null };
    }

    const provider = this.providers.get(providerKey);
    if (provider === undefined) {
      const env = buildEnvelope(input.prompt, null, "provider-not-found", input.provenance);
      return { ok: false, errorCode: "provider-not-found", envelope: env, providerUsed: providerKey };
    }

    const maxTokens = input.maxTokens ?? this.defaultMaxTokens;
    if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
      const env = buildEnvelope(input.prompt, null, "invalid-max-tokens", input.provenance);
      return { ok: false, errorCode: "invalid-max-tokens", envelope: env, providerUsed: providerKey };
    }
    if (maxTokens > this.defaultMaxTokens * 2) {
      const env = buildEnvelope(input.prompt, null, "max-tokens-exceeded", input.provenance);
      return { ok: false, errorCode: "max-tokens-exceeded", envelope: env, providerUsed: providerKey };
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const request: ModelRequest = {
        prompt: input.prompt,
        maxTokens,
        metadata: { routedAt: this.now().toISOString(), source: "model-router" },
      };
      const responsePromise = Promise.resolve(provider.complete(request));
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new RouterError(RouterErrorCodes.Timeout, "Provider timed out")), this.defaultTimeoutMs);
      });
      const rawResponse = await Promise.race([responsePromise, timeoutPromise]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);

      const response = validateResponse(rawResponse);

      if (checkMetadataSecrets(response.metadata)) {
        const env = buildEnvelope(input.prompt, null, "secret-in-metadata", input.provenance);
        return { ok: false, errorCode: "secret-in-metadata", envelope: env, providerUsed: providerKey };
      }

      const envelope = buildEnvelope(input.prompt, response, null, input.provenance);
      return { ok: true, response, envelope, providerUsed: providerKey };
    } catch (err) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      let code: string;
      if (err instanceof RouterError) {
        code = err.code;
      } else {
        code = RouterErrorCodes.ProviderError;
      }
      const env = buildEnvelope(input.prompt, null, code, input.provenance);
      return { ok: false, errorCode: code, envelope: env, providerUsed: providerKey };
    }
  }
}
