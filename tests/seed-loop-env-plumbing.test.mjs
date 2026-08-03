/**
 * Guard: every seeder scheduled in a compose loop must actually RECEIVE the
 * env vars it reads.
 *
 * WHY THIS EXISTS. Session 09 hit the identical bug four separate times —
 * FRED/EIA, ACLED, the WORLDMONITOR_* credentials, and OPENROUTER_* — and each
 * time it presented as a broken seeder rather than as missing plumbing:
 *
 *   1. the operator adds a key to .env
 *   2. the app container gets it (its `environment:` block lists it)
 *   3. the LOOP container does NOT, because those blocks are explicit allowlists
 *   4. the seeder degrades politely to nothing, so nothing fails loudly
 *   5. a health check sits EMPTY and looks like a data problem
 *
 * Step 4 is the trap: these seeders are deliberately well-behaved about absent
 * credentials, which is right for a self-host but means a plumbing mistake is
 * SILENT. This test makes it loud.
 *
 * It is intentionally conservative — it only flags a var when the seeder cannot
 * run meaningfully without it, and it reads the compose file and the seeder
 * sources rather than maintaining a hand-written table that would rot.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// Normalize line endings before ANY regex work. This checkout is CRLF, and
// every `:\n`-style anchor below silently matches nothing against `:\r\n` —
// the parser then reports zero seeders and the guard passes vacuously, which
// is precisely the failure mode a guard must not have.
const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf-8').replace(/\r\n/g, '\n');

/** Every `seed-loop*` service block, with its scheduled seeders and env names. */
function parseLoopServices() {
  const services = [];
  const names = [...compose.matchAll(/^ {2}(seed-loop[a-z-]*):$/gm)].map((m) => m[1]);
  for (const name of names) {
    const start = compose.indexOf(`\n  ${name}:`);
    // A service block ends at the next 2-space-indented service key.
    const after = compose.slice(start + 1);
    const nextIdx = after.search(/\n {2}[a-z][a-z0-9-]*:\n/);
    const block = nextIdx === -1 ? after : after.slice(0, nextIdx);

    const commandLine = block.match(/command: \[[\s\S]*?\]\n/);
    const seeders = commandLine
      ? [...new Set([...commandLine[0].matchAll(/\bseed-[a-z0-9-]+/g)].map((m) => m[0]))]
          // The loop scaffolding itself mentions the service name in echoes.
          .filter((s) => !names.includes(s))
      : [];

    const envBlock = block.match(/\n {4}environment:\n([\s\S]*?)(?=\n {4}[a-z_]|\n {2}[a-z])/);
    const envNames = envBlock
      ? [...envBlock[1].matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1])
      : [];

    services.push({ name, seeders, envNames });
  }
  return services;
}

/**
 * Env vars a seeder cannot work without.
 *
 * Detected from source rather than listed by hand: a var is REQUIRED when the
 * script throws, exits, or hard-returns on its absence. Vars that merely enable
 * an optional leg are ignored on purpose — flagging those would make this test
 * noisy and it would get disabled, which is worse than not having it.
 */
/**
 * Only a THROW or an EXIT counts as "hard required".
 *
 * An earlier version matched any nearby "missing"/"required" prose and produced
 * a false positive on seed-resilience-scores: it warns about
 * WORLDMONITOR_API_KEY in a console.warn, but line 24 falls back to
 * WORLDMONITOR_VALID_KEYS, so the var is genuinely optional. A guard that cries
 * wolf gets disabled, so the bar is deliberately high — this looks only inside
 * `throw ...` and `process.exit(...)` statements.
 */
const FATAL_STATEMENT_RE = /(?:throw\s+new\s+\w*Error\s*\([\s\S]{0,300}?\)|process\.exit\s*\(\s*[1-9][\s\S]{0,80}?\))/g;

/** Vars supplied by the runtime rather than the operator; never flag them. */
const AMBIENT = new Set([
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'NODE_ENV', 'HOME', 'PATH',
  'REDIS_TOKEN', 'SEED_TIMEOUT', 'API_BASE_URL',
]);

function requiredEnvFor(seeder) {
  const path = resolve(ROOT, 'scripts', `${seeder}.mjs`);
  if (!existsSync(path)) return { missingScript: true, vars: [] };
  const src = readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

  const read = new Set([...src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));

  // A var with a `||` / `??` fallback is optional by construction, however
  // loudly the code complains about it elsewhere.
  const hasFallback = (name) =>
    new RegExp(`process\\.env\\.${name}\\s*(?:\\?\\?|\\|\\|)`).test(src)
    || new RegExp(`process\\.env\\.${name}[\\s\\S]{0,40}?(?:\\?\\?|\\|\\|)\\s*(?:process\\.env|['"\`])`).test(src);

  const hard = new Set();
  for (const stmt of src.match(FATAL_STATEMENT_RE) ?? []) {
    for (const m of stmt.matchAll(/\b([A-Z][A-Z0-9_]{4,})\b/g)) {
      const name = m[1];
      if (read.has(name) && !AMBIENT.has(name) && !hasFallback(name)) hard.add(name);
    }
  }
  return { missingScript: false, vars: [...hard] };
}

describe('seed loop env plumbing', () => {
  const services = parseLoopServices();

  it('finds the compose loop services and their seeders', () => {
    assert.ok(services.length >= 2, 'expected at least two seed-loop* services');
    for (const s of services) {
      assert.ok(s.seeders.length > 0, `${s.name} parsed with zero seeders — parser drift`);
    }
  });

  it('every scheduled seeder script exists', () => {
    const missing = [];
    for (const s of services) {
      for (const seeder of s.seeders) {
        if (requiredEnvFor(seeder).missingScript) missing.push(`${s.name}: scripts/${seeder}.mjs`);
      }
    }
    assert.deepEqual(missing, [], `scheduled seeders with no script:\n  ${missing.join('\n  ')}`);
  });

  for (const service of parseLoopServices()) {
    it(`${service.name} passes the env every scheduled seeder hard-requires`, () => {
      const gaps = [];
      for (const seeder of service.seeders) {
        const { missingScript, vars } = requiredEnvFor(seeder);
        if (missingScript) continue;
        for (const v of vars) {
          if (!service.envNames.includes(v)) gaps.push(`${seeder} needs ${v}`);
        }
      }
      assert.deepEqual(
        gaps, [],
        `${service.name} schedules seeders whose required env it does not pass.\n` +
        `A key in .env does NOT reach a loop container unless that service's\n` +
        `environment: block lists it — this exact gap silently emptied four\n` +
        `data layers in session 09.\n  ${gaps.join('\n  ')}`,
      );
    });
  }
});
