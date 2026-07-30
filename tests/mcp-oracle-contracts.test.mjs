// Oracle contract coverage — real captured payloads vs declared outputSchema,
// WITH explicit field-presence/absence teeth.
//
// Why this test exists (task [2b], session 02):
//   tests/mcp-tool-output-contracts.test.mjs proves only that declared
//   schemas are internally self-consistent (its own header says so), and the
//   shared validator (tests/helpers/json-schema-mini.mjs) is ONE-DIRECTIONAL:
//   missing non-required declared fields AND undeclared extra payload fields
//   both pass, and no tool sets additionalProperties:false. Fixing schema
//   declarations therefore does NOT defend them — a drift like the historical
//   `score`-vs-`combinedScore` misdeclaration would re-enter silently.
//   This suite closes that gap with explicit assertions on REAL captures:
//   the authoritative fields must be PRESENT and the known-drifted fields
//   must be ABSENT, byte-for-byte from a live instance.
//
// Fixture policy (tests/fixtures/AGENTS.md): value assertions are allowed
// ONLY against tests/fixtures/oracle/<capture-date>/ — never against the
// contaminated jmespath-samples/ set. This suite reads oracle/ exclusively.
//
// Capture layout: oracle/<date>/<name>.response.json plus a sibling
// manifest.json ({ captures: [{ file, tool, args, endpoint, authClass,
// capturedAt, notes? }] }). Fixture payloads stay pristine — provenance
// lives in the manifest, not inside the capture (unlike the _fixtureNotice
// sentinel the quarantined jmespath-samples/ files carry).
//
// When no oracle captures exist yet (fresh clone), every subtest is skipped
// LOUDLY — a skip is visible in the run summary, a silent pass is not.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from './helpers/json-schema-mini.mjs';
import { __testing__ } from '../api/mcp.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORACLE_ROOT = path.join(HERE, 'fixtures', 'oracle');

const FOSSIL_COMPONENT_KEYS = ['newsActivity', 'ciiContribution', 'geoConvergence', 'militaryActivity'];
const SEMANTIC_COMPONENT_KEYS = ['unrest', 'conflict', 'security', 'news'];
const DISCLOSURE_KEYS = ['eventMultiplier', 'methodologyVersion', 'advisoryLevel', 'advisoryProvenance'];

function collectCaptures() {
  if (!existsSync(ORACLE_ROOT)) return { captures: [], pending: [] };
  const captures = [];
  const pending = [];
  for (const entry of readdirSync(ORACLE_ROOT)) {
    const dir = path.join(ORACLE_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const cap of manifest.captures ?? []) {
      captures.push({
        ...cap,
        date: entry,
        payload: JSON.parse(readFileSync(path.join(dir, cap.file), 'utf8')),
      });
    }
    for (const p of manifest.pending ?? []) pending.push({ ...p, date: entry });
  }
  return { captures, pending };
}

// Per-tool teeth. Each entry gets every capture of that tool (there may be
// several — different countries, different capture dates).
const TOOL_ASSERTIONS = {
  get_country_risk(payload, cap) {
    // Authoritative top-level fields (get-country-risk.ts return shape).
    assert.equal(typeof payload.countryCode, 'string', 'countryCode must be a string');
    assert.ok(!('country_code' in payload), 'drifted country_code must be ABSENT');
    assert.ok(!('travelAdvisory' in payload), 'drifted travelAdvisory must be ABSENT');
    assert.ok(!('sanctionsExposure' in payload), 'drifted sanctionsExposure must be ABSENT');
    assert.equal(typeof payload.advisoryLevel, 'string', 'advisoryLevel must be a string (possibly empty)');
    assert.equal(typeof payload.sanctionsActive, 'boolean', 'sanctionsActive must be boolean');
    assert.equal(typeof payload.sanctionsCount, 'number', 'sanctionsCount must be number');
    assert.equal(typeof payload.upstreamUnavailable, 'boolean', 'upstreamUnavailable must be boolean');

    if (payload.upstreamUnavailable) {
      // Cold-start / missing-snapshot shape: cii ABSENT, never null.
      assert.ok(!('cii' in payload), 'cii must be ABSENT (not null) when upstream is unavailable');
      return;
    }

    // Warm shape: cii is an OBJECT (never a number, never null).
    assert.ok(payload.cii && typeof payload.cii === 'object' && !Array.isArray(payload.cii),
      'cii must be an object on the warm path');
    assert.equal(typeof payload.cii.combinedScore, 'number', 'cii.combinedScore must be a number');
    assert.ok(!('score' in payload.cii), 'drifted cii.score must be ABSENT');

    const comps = payload.cii.components;
    assert.ok(comps && typeof comps === 'object', 'cii.components must be an object');
    for (const key of FOSSIL_COMPONENT_KEYS) {
      assert.equal(typeof comps[key], 'number', `fossil component ${key} must be PRESENT and numeric`);
    }
    for (const key of SEMANTIC_COMPONENT_KEYS) {
      assert.ok(!(key in comps), `semantic component name ${key} must be ABSENT from the wire`);
    }
    // Disclosure fields the current emitter writes (their absence was one of
    // Trap 1's three staleness axes — a capture without them is pre-current).
    for (const key of DISCLOSURE_KEYS) {
      assert.ok(key in payload.cii, `disclosure field cii.${key} must be PRESENT (capture ${cap.file})`);
    }
  },

  get_conflict_events(payload) {
    // Cache-tool envelope.
    assert.ok('cached_at' in payload, 'envelope cached_at must be PRESENT');
    assert.ok('stale' in payload, 'envelope stale must be PRESENT');
    assert.ok(payload.data && typeof payload.data === 'object', 'envelope data must be an object');

    const scores = payload.data.scores;
    assert.ok(scores && typeof scores === 'object', 'data.scores label must be PRESENT (stale CII snapshot)');
    const ciiScores = scores.ciiScores;
    assert.ok(Array.isArray(ciiScores) && ciiScores.length > 0, 'scores.ciiScores must be a non-empty array');
    for (const [i, entry] of ciiScores.entries()) {
      assert.equal(typeof entry.combinedScore, 'number', `ciiScores[${i}].combinedScore must be PRESENT`);
      assert.ok(!('score' in entry), `ciiScores[${i}]: drifted score field must be ABSENT`);
      const comps = entry.components;
      assert.ok(comps && typeof comps === 'object', `ciiScores[${i}].components must be an object`);
      for (const key of FOSSIL_COMPONENT_KEYS) {
        assert.equal(typeof comps[key], 'number', `ciiScores[${i}].components.${key} must be PRESENT`);
      }
      for (const key of SEMANTIC_COMPONENT_KEYS) {
        assert.ok(!(key in comps), `ciiScores[${i}]: semantic name ${key} must be ABSENT`);
      }
      for (const key of DISCLOSURE_KEYS) {
        assert.ok(key in entry, `ciiScores[${i}]: disclosure field ${key} must be PRESENT`);
      }
    }
  },

  get_country_brief(payload, cap) {
    // LLM-backed tool — a no-LLM self-host returns a degraded/error shape.
    // The manifest marks such captures notes:'no-llm'; only the field-naming
    // contract is asserted there.
    assert.ok(!('country_code' in payload), 'drifted country_code must be ABSENT');
    assert.ok(!('framework' in payload), 'input-only framework must be ABSENT from output');
    assert.ok(!('provider' in payload), 'undeclared provider must be ABSENT from output');
    if (cap.notes === 'no-llm') return;
    assert.equal(typeof payload.countryCode, 'string', 'countryCode must be a string');
    assert.equal(typeof payload.brief, 'string', 'brief must be a string');
    assert.ok(Array.isArray(payload.sources), 'sources must be an array');
  },
};

describe('MCP oracle contract coverage (real captures, presence/absence teeth)', () => {
  const { captures, pending } = collectCaptures();

  it('oracle captures exist for the three schema-corrected tools', (t) => {
    if (captures.length === 0) {
      t.skip('no oracle captures yet — run scripts/capture-mcp-fixture.mjs --dir oracle/<date> (see tests/fixtures/oracle/README.md)');
      return;
    }
    const tools = new Set(captures.map((c) => c.tool));
    const pendingTools = new Map(pending.map((p) => [p.tool, p.reason]));
    for (const required of ['get_country_risk', 'get_conflict_events', 'get_country_brief']) {
      if (tools.has(required)) continue;
      // A manifest `pending` entry is an explicit, reasoned deferral — visible
      // here as a diagnostic, not silently forgiven forever.
      if (pendingTools.has(required)) {
        t.diagnostic(`${required} capture PENDING: ${pendingTools.get(required)}`);
        continue;
      }
      assert.fail(`missing oracle capture for ${required} (and no manifest pending entry explains why)`);
    }
  });

  if (captures.length === 0) {
    it('per-capture assertions', (t) => t.skip('no oracle captures yet'));
    return;
  }

  for (const cap of captures) {
    describe(`${cap.date}/${cap.file} (${cap.tool})`, () => {
      it('validates against the declared outputSchema (one-directional check)', () => {
        const tool = __testing__.TOOL_REGISTRY.find((t) => t.name === cap.tool);
        assert.ok(tool, `tool ${cap.tool} not found in registry`);
        const errors = validate(tool.outputSchema, cap.payload);
        assert.deepEqual(errors, [], `capture fails declared schema:\n  ${errors.join('\n  ')}`);
      });

      const teeth = TOOL_ASSERTIONS[cap.tool];
      it('explicit presence/absence assertions', (t) => {
        if (!teeth) {
          t.skip(`no per-tool assertions defined for ${cap.tool} yet — schema validation only`);
          return;
        }
        teeth(cap.payload, cap);
      });
    });
  }
});
