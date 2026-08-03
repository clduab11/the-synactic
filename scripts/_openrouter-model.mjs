/**
 * OpenRouter model selection for this fork's seeders.
 *
 * WHY THIS EXISTS: upstream hardcodes `deepseek/deepseek-v4-flash` at ~8 call
 * sites. That is a PAID model. The owner's instruction for this deployment is
 * to stay on free models only, so the default here is free and the choice is
 * single-sourced instead of scattered.
 *
 * The list was taken from OpenRouter's live catalogue on 2026-08-03 by
 * filtering /api/v1/models for `pricing.prompt === 0 && pricing.completion === 0`
 * — 17 of 338 models qualified — and ranking by context window. It is NOT a
 * guess from training data, which goes stale fast for model availability.
 *
 * ⚠ Free tiers are rate-limited and models get retired. Anything reading this
 * should degrade to the next provider in its chain rather than fail the seed;
 * every consumer here already has a provider fallback (ollama -> openrouter ->
 * groq), which is the real safety net.
 *
 * Re-check the catalogue with:
 *   curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
 *     https://openrouter.ai/api/v1/models
 * and keep only entries whose prompt AND completion price are both 0 — some
 * models advertise a zero prompt price with a non-zero completion price.
 */

/**
 * Free models ranked most- to least-capable for text reasoning, skipping
 * non-chat entries (google/lyria-* are music models) and the `openrouter/free`
 * meta-router, whose backing model is not pinned and so cannot be reasoned
 * about for cost or capability.
 */
export const FREE_MODEL_CHAIN = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',   // 550B MoE, 1M ctx — the frontier-class free option
  'nvidia/nemotron-3-super-120b-a12b:free',   // 120B MoE, 262k ctx
  'google/gemma-4-31b-it:free',               // 31B, 262k ctx
  'openai/gpt-oss-20b:free',                  // 20B, 131k ctx — smallest acceptable fallback
];

/**
 * The model seeders should send to OpenRouter.
 *
 * `OPENROUTER_MODEL` overrides it, so switching models — including back to a
 * paid one if the owner ever decides to — is an env change, not a code change.
 * A bare override is honoured verbatim: this function does not force `:free`,
 * because forcing it would silently rewrite a deliberate choice.
 */
export function openrouterModel() {
  const override = process.env.OPENROUTER_MODEL?.trim();
  return override || FREE_MODEL_CHAIN[0];
}

/** True when the resolved model is a free-tier one — used for logging only. */
export function isFreeModel(model = openrouterModel()) {
  return model.endsWith(':free');
}
