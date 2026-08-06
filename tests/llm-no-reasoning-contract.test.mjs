import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as rawReadFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CRLF-normalize before ANY regex — this checkout has a CRLF working tree and a
// pattern that matches nothing would make these assertions pass VACUOUSLY.
function read(p) {
  return rawReadFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// EVERY transport with a local-LLM leg is listed here. llm-chain.cjs and
// server/_shared/llm.ts were missing from the original pin and regressed to
// think:false alone — which LM Studio ignores (re-measured 2026-08-06 on
// qwen3.5-4b-uncensored-hauhaucs: a 400-token budget went 100% to reasoning
// with EMPTY content). startMarker/endMarker isolate each file's ollama leg.
const SITES = [
  { label: 'seed-insights', path: resolve(__dirname, '../scripts/seed-insights.mjs'), startMarker: "name: 'ollama'", endMarker: "name: 'openrouter'" },
  { label: 'ais-relay', path: resolve(__dirname, '../scripts/ais-relay.cjs'), startMarker: "name: 'ollama'", endMarker: "name: 'openrouter'" },
  { label: 'llm-chain', path: resolve(__dirname, '../scripts/lib/llm-chain.cjs'), startMarker: "name: 'ollama'", endMarker: "name: 'groq'" },
  { label: 'server/llm', path: resolve(__dirname, '../server/_shared/llm.ts'), startMarker: "provider === 'ollama'", endMarker: "provider === 'groq'" },
];

/**
 * Isolate the `ollama` provider entry — the ONLY leg that talks to the
 * operator's local server. The cloud legs use different, provider-specific
 * suppression shapes and are deliberately not covered here.
 */
function ollamaProviderBlock(source, label, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start > -1, `${label}: could not locate the ollama provider entry`);
  // Stop at the next provider so we never read a sibling's extraBody.
  const nextProvider = source.indexOf(endMarker, start);
  const end = nextProvider > -1 ? nextProvider : start + 4000;
  const block = source.slice(start, end);
  assert.ok(block.includes('extraBody'), `${label}: ollama entry has no extraBody`);
  return block;
}

describe('local LLM no-reasoning contract (session 11)', () => {
  // WHY THIS EXISTS. A reasoning-enabled model on the local leg does not fail
  // loudly — it spends the whole max_tokens budget thinking and returns an
  // EMPTY STRING with a 200 status. Measured 2026-08-04 on qwen3.5-4b via LM
  // Studio: with no suppression, a 120-token call produced 479 chars of
  // reasoning and ZERO output characters. The relay's classify budget is
  // titles.length * 40, so a short batch hits exactly that. A silent wrong
  // answer is the failure mode this repo least wants, so the suppression keys
  // are a contract, not a tuning knob.

  for (const { label, path, startMarker, endMarker } of SITES) {
    const block = ollamaProviderBlock(read(path), label, startMarker, endMarker);

    it(`${label}: sends reasoning_effort:'none' (the key that actually works on LM Studio)`, () => {
      assert.match(
        block,
        /reasoning_effort:\s*'none'/,
        `${label}: without this the local leg returns empty strings instead of answers`,
      );
    });

    it(`${label}: sends think:false for a real Ollama server`, () => {
      assert.match(block, /think:\s*false/);
    });

    it(`${label}: sends chat_template_kwargs.enable_thinking:false for vLLM/SGLang hosts`, () => {
      assert.match(block, /chat_template_kwargs:\s*\{\s*enable_thinking:\s*false\s*\}/);
    });
  }

  it('seed-insights still strips <think> blocks from the visible answer', () => {
    // Belt-and-braces for a model that emits inline think tags in `content`
    // rather than a separate reasoning field — the request-side flags cannot
    // catch that case.
    const src = read(SITES[0].path);
    assert.match(src, /<think>\[\\s\\S\]\*\?<\\\/think>|<think>/,
      'the <think> stripping fallback disappeared');
  });
});
