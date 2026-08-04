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
 * Free chain, ordered. Revised 2026-08-03 after LIVE inference testing — the
 * first version ranked by context length, which cannot see a provider outage
 * or a parameter conflict, and consequently shipped TWO NON-FUNCTIONAL entries:
 *
 *   - `google/gemma-4-31b-it:free` — hard 400 on every parameter variant. Its
 *     ONLY provider is Google AI Studio, which returns "API key not valid"
 *     through OpenRouter (an upstream integration failure, not our key). Proven
 *     provider-level, not model-level: pinning gemma-4-26b to the same provider
 *     reproduces it; the 26B survives only because it can fall back elsewhere.
 *   - `openai/gpt-oss-20b:free` — hard 400: "Reasoning is mandatory for this
 *     endpoint and cannot be disabled", which collides head-on with the
 *     `reasoning: {enabled:false}` these seeders send.
 *
 * Ranking below is measured, not inferred: a 24-item ground-truth test (12
 * event classifications + 12 market-direction calls) plus latency, JSON
 * validity and 30-day uptime, corroborated with vendor model cards.
 *
 * ⚠ CORRELATED FAILURE is the live risk: entries 1-3 would all be served by
 * NVIDIA's single OpenRouter endpoint. That is exactly the failure mode that
 * killed the Gemma slot, so poolside is promoted to position 3 for provider
 * diversity — it scored 19/24 against nano-omni's 20/24, which on a 12-item
 * test is noise, and decorrelation is worth more than a point of noise.
 */
export const FREE_MODEL_CHAIN = [
  // 550B-A55B. 24/24 on the ground-truth test — no other candidate beat 20/24.
  // MMLU-Pro 86.8 / GPQA 87.0 / IFBench 81.7 (NVIDIA card). 99.95% uptime.
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  // 120B-A12B. The ONLY free model whose endpoint declares both response_format
  // AND structured_outputs, so a json_object request is enforced rather than
  // silently dropped. Tightest latency measured (~2.2s, low variance).
  'nvidia/nemotron-3-super-120b-a12b:free',
  // 33B-A3B. Fastest tested (1.3-2.0s) and 100% 30-day uptime. A coding model
  // with no published general evals [OPEN], but it earns this slot empirically
  // and is the chain's ONLY non-NVIDIA provider — see the correlation note.
  'poolside/laguna-xs-2.1:free',
  // 30B-A3B. 20/24, 3/3 valid JSON, 99.55% uptime. No published benchmarks for
  // the omni variant [OPEN] — placed on measured behaviour alone.
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

/**
 * Rejected after testing — do not "restore" these without re-measuring.
 *
 *   google/gemma-4-26b-a4b-it:free   Best published profile of any candidate
 *                                    (IFEval 98.5, MMLU-Pro 82.6, best
 *                                    summarisation faithfulness on Vectara at
 *                                    5.2% hallucination) but measured 55.9s
 *                                    latency — fails every seeder budget.
 *                                    Good on paper, unusable unattended.
 *   nvidia/nemotron-3-nano-30b-a3b   Reproducibly returns {"results":[]} —
 *                                    correct schema, refuses to populate it.
 *   nvidia/nemotron-nano-9b-v2       Ignores reasoning:{enabled:false}, spends
 *                                    the budget on reasoning, returns EMPTY.
 *   nvidia/nemotron-nano-12b-v2-vl   120s timeout on first call.
 *   inclusionai/ling-3.0-flash       400 on response_format, AND its only host
 *                                    (Novita) is in this repo's own
 *                                    OPENROUTER_BLOCKED_PROVIDERS list.
 *   cohere/north-mini-code           Weakest reasoning (16/24) and the only
 *                                    candidate with is_moderated:true — a
 *                                    refusal risk on conflict/sanctions text.
 *
 * Non-chat, excluded by category: google/lyria-* (music),
 * nvidia/nemotron-3.5-content-safety (guardrail classifier), openrouter/free
 * (unpinned meta-router — cost and capability cannot be reasoned about).
 *
 * ⚠ TWO METHODOLOGY TRAPS, learned the hard way:
 *  1. "prompt and completion both 0" is NECESSARY BUT NOT SUFFICIENT. Both
 *     Lyria models report zero on both fields while their descriptions state
 *     $0.08/song and $0.04/clip — per-unit billing lives outside the pricing
 *     fields entirely. Read the description, not just the numbers.
 *  2. "Unsupported parameters are silently ignored" is NOT reliable. OpenRouter
 *     documents silent-drop as the default, but Ling and gpt-oss-20b both hard
 *     400 instead. Behaviour is provider-dependent — test, do not assume.
 *
 * RATE LIMITS: 20 requests/minute on :free variants; 1000/day on this account
 * (verified via /api/v1/key — `is_free_tier: false`, i.e. the credit-purchase
 * tier, not the 50/day one). ⚠ The daily cap is ACCOUNT-WIDE across all :free
 * models, so falling down this chain buys AVAILABILITY, never fresh quota.
 */

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
