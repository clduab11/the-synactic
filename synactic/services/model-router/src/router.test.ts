import { describe, it, expect, vi } from "vitest";
import { SourceProvenanceSchema } from "@the-synactic/contracts";

import { FakeModelProvider, ModelRouter, type ModelProvider, type ModelResponse } from "./router.js";
import { RouterError } from "./errors.js";

function makeProvenance(sourceId = "test:router") {
  return SourceProvenanceSchema.parse({
    sourceId,
    sourceUri: "https://example.com/test",
    retrievedAt: "2026-01-01T00:00:00Z",
    integrityHash: null,
  });
}

function makeProvider(id: string, model: string, failRate = 0) {
  return new FakeModelProvider({
    providerId: id,
    modelId: model,
    responseTemplate: "resp-from-{model}-{call}",
    failRate,
  });
}

describe("FakeModelProvider", () => {
  it("returns deterministic responses", () => {
    const p = makeProvider("fake", "v1");
    const r1 = p.complete({ prompt: "hello" }) as ModelResponse;
    const r2 = p.complete({ prompt: "world" }) as ModelResponse;
    expect(r1.content).toContain("resp-from-v1-1");
    expect(r2.content).toContain("resp-from-v1-2");
    expect(r1.provider).toBe("fake");
    expect(p.getCallCount()).toBe(2);
  });

  it("fails deterministically by rate", () => {
    const p = makeProvider("fake", "v1", 1.0);
    expect(() => p.complete({ prompt: "x" })).toThrow();
  });

  it("supports async delay", async () => {
    const p = new FakeModelProvider({ providerId: "fake", modelId: "v1", delayMs: 10 });
    const r = (await p.complete({ prompt: "x" })) as ModelResponse;
    expect(r.content).toBeDefined();
  });
});

describe("ModelRouter routing", () => {
  it("routes to available provider", async () => {
    const router = new ModelRouter({ providers: [makeProvider("fake", "v1")] });
    const result = await router.route({ prompt: "hello", provenance: makeProvenance() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.response.provider).toBe("fake");
    expect(result.providerUsed).toBe("fake:v1");
    expect(result.envelope).not.toBeNull();
    expect(result.envelope!.type).toBe("model.routed");
  });

  it("respects model preference", async () => {
    const p1 = makeProvider("a", "m1");
    const p2 = makeProvider("b", "m2");
    const router = new ModelRouter({ providers: [p1, p2] });
    const result = await router.route({ prompt: "x", modelPreference: "b:m2", provenance: makeProvenance() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.providerUsed).toBe("b:m2");
  });

  it("denies disallowed model", async () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1")], allowList: [] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("model-not-allowed");
  });

  it("denies unknown preference", async () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1")] });
    const result = await router.route({ prompt: "x", modelPreference: "z:z", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("model-not-allowed");
  });

  it("rejects excessive maxTokens", async () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1")], defaultMaxTokens: 100 });
    const result = await router.route({ prompt: "x", maxTokens: 999, provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("max-tokens-exceeded");
  });

  it("rejects negative maxTokens", async () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1")] });
    const result = await router.route({ prompt: "x", maxTokens: -10, provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-max-tokens");
  });

  it("rejects zero maxTokens", async () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1")] });
    const result = await router.route({ prompt: "x", maxTokens: 0, provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-max-tokens");
  });

  it("rejects non-finite maxTokens", async () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1")] });
    const result = await router.route({ prompt: "x", maxTokens: Number.POSITIVE_INFINITY, provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-max-tokens");
  });

  it("times out on slow provider", async () => {
    const slow = new FakeModelProvider({ providerId: "slow", modelId: "s1", delayMs: 5000 });
    const router = new ModelRouter({ providers: [slow], defaultTimeoutMs: 50 });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("timeout");
  });

  it("captures provider errors", async () => {
    const bad = makeProvider("bad", "b1", 1.0);
    const router = new ModelRouter({ providers: [bad] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("provider-error");
  });
});

describe("ModelRouter input validation", () => {
  it("rejects empty prompt", async () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1")] });
    const result = await router.route({ prompt: "", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("empty-prompt");
  });

  it("rejects whitespace-only prompt", async () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1")] });
    const result = await router.route({ prompt: "   ", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("empty-prompt");
  });
});

describe("ModelRouter duplicate provider detection", () => {
  it("throws on duplicate provider registration", () => {
    const p1 = makeProvider("a", "m1");
    const p2 = makeProvider("a", "m1");
    expect(() => new ModelRouter({ providers: [p1, p2] })).toThrow(RouterError);
  });

  it("allows different models from same provider", () => {
    const p1 = makeProvider("a", "m1");
    const p2 = makeProvider("a", "m2");
    expect(() => new ModelRouter({ providers: [p1, p2] })).not.toThrow();
  });
});

describe("ModelRouter response validation", () => {
  it("rejects provider returning null", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return null as unknown as ModelResponse;
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });

  it("rejects provider returning undefined", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return undefined as unknown as ModelResponse;
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });

  it("rejects provider returning non-object", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return "string" as unknown as ModelResponse;
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });

  it("rejects provider returning empty content", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return { content: "", tokenCount: 0, provider: "evil", model: "e1" };
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });

  it("rejects provider returning negative tokenCount", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: -5, provider: "evil", model: "e1" };
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });

  it("rejects provider returning non-finite tokenCount", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: Number.POSITIVE_INFINITY, provider: "evil", model: "e1" };
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });

  it("rejects provider returning empty provider field", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: 10, provider: "", model: "e1" };
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });

  it("rejects provider returning empty model field", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: 10, provider: "evil", model: "" };
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });

  it("rejects provider returning array metadata", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: 10, provider: "evil", model: "e1", metadata: [] as unknown as Record<string, unknown> };
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCode).toBe("invalid-response");
  });
});

describe("ModelRouter envelope integration", () => {
  it("envelope contains prompt and response on success", async () => {
    const router = new ModelRouter({ providers: [makeProvider("f", "v1")] });
    const result = await router.route({ prompt: "say hi", provenance: makeProvenance() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    const ev = result.envelope;
    expect(ev).not.toBeNull();
    if (!ev) throw new Error();
    expect(ev.payload.prompt).toContain("say hi");
    const resp = ev.payload.response as { provider: string } | null;
    expect(resp).not.toBeNull();
    expect(resp!.provider).toBe("f");
    expect(ev.payload.errorCode).toBeNull();
  });

  it("envelope carries error on failure", async () => {
    const router = new ModelRouter({ providers: [], allowList: [] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.envelope).not.toBeNull();
    expect(result.envelope!.payload.errorCode).toBe("model-not-allowed");
  });
});

describe("ModelRouter secret guard", () => {
  it("rejects secret in response metadata using contracts guard", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: 2, provider: "evil", model: "e1", metadata: { apiKey: "sk-secret" } };
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.errorCode).toBe("secret-in-metadata");
  });

  it("rejects nested secret in response metadata", async () => {
    const evil: ModelProvider = {
      providerId: "evil",
      modelId: "e1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: 2, provider: "evil", model: "e1", metadata: { config: { password: "secret" } } };
      },
    };
    const router = new ModelRouter({ providers: [evil] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.errorCode).toBe("secret-in-metadata");
  });

  it("allows response without metadata", async () => {
    const good: ModelProvider = {
      providerId: "good",
      modelId: "g1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: 2, provider: "good", model: "g1" };
      },
    };
    const router = new ModelRouter({ providers: [good] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(true);
  });

  it("allows response with clean metadata", async () => {
    const good: ModelProvider = {
      providerId: "good",
      modelId: "g1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: 2, provider: "good", model: "g1", metadata: { requestId: "abc123" } };
      },
    };
    const router = new ModelRouter({ providers: [good] });
    const result = await router.route({ prompt: "x", provenance: makeProvenance() });
    expect(result.ok).toBe(true);
  });
});

describe("ModelRouter timeout cleanup", () => {
  it("clears timeout on successful completion", async () => {
    vi.useFakeTimers();
    const fast: ModelProvider = {
      providerId: "fast",
      modelId: "f1",
      complete(): ModelResponse {
        return { content: "ok", tokenCount: 2, provider: "fast", model: "f1" };
      },
    };
    const router = new ModelRouter({ providers: [fast], defaultTimeoutMs: 1000 });
    const resultPromise = router.route({ prompt: "x", provenance: makeProvenance() });
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.ok).toBe(true);
    vi.useRealTimers();
  });

  it("clears timeout on provider error", async () => {
    vi.useFakeTimers();
    const bad = makeProvider("bad", "b1", 1.0);
    const router = new ModelRouter({ providers: [bad], defaultTimeoutMs: 1000 });
    const resultPromise = router.route({ prompt: "x", provenance: makeProvenance() });
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.errorCode).toBe("provider-error");
    vi.useRealTimers();
  });
});

describe("ModelRouter available models", () => {
  it("lists registered keys", () => {
    const router = new ModelRouter({ providers: [makeProvider("a", "m1"), makeProvider("b", "m2")] });
    expect(router.availableModels()).toEqual(["a:m1", "b:m2"]);
  });
});
