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

  // ---------------------------------------------------------------------------
  // Tier-1 batch 1 (session 03, cache tools). Teeth grounded in the
  // 2026-07-30 captures — every number below was read from the live stack,
  // not from a producer or a plan document.
  // ---------------------------------------------------------------------------

  get_security_advisories(payload, cap) {
    const inner = payload.data?.advisories;
    assert.ok(inner && typeof inner === 'object', 'data.advisories label must be present');
    // The strip is the whole point: byCountryName is a static ISO2->name
    // dictionary wearing an advisory-sounding name. Its absence proves the
    // _postFilter ran.
    assert.ok(!('byCountryName' in inner), 'byCountryName must be ABSENT (stripped by _postFilter)');
    assert.ok(Array.isArray(inner.advisories), 'advisories list must be an array');
    const recs = inner.advisories;
    for (const [i, r] of recs.entries()) {
      assert.ok(typeof r.link === 'string' && r.link.length > 0, `advisories[${i}].link must be non-empty`);
      // The unservable hosted similarity contract must never silently re-enter.
      for (const k of ['similarity', 'score', 'rank', 'embedding']) {
        assert.ok(!(k in r), `advisories[${i}].${k} must be ABSENT (cosine contract is unservable locally)`);
      }
    }
    if (cap.args?.limit === 0) {
      assert.ok(recs.length >= 200, `uncapped capture must carry the full corpus (got ${recs.length})`);
      // Observed 2026-07-30: 154 ISO2 + 67 empty-string (unmapped WHO/ECDC
      // notices). Empty is legal; a NON-ISO2 non-empty value is drift.
      const nonEmpty = recs.filter((r) => r.country !== '');
      assert.ok(nonEmpty.length >= 100, `expected >=100 country-mapped advisories (got ${nonEmpty.length})`);
      for (const r of nonEmpty) {
        assert.match(r.country, /^[A-Z]{2}$/, `non-empty country must be ISO2 (got "${r.country}")`);
      }
      const dates = recs.map((r) => Date.parse(r.pubDate)).filter(Number.isFinite);
      const spanDays = (Math.max(...dates) - Math.min(...dates)) / 86_400_000;
      assert.ok(spanDays > 700, `pubDate span must exceed 700 days (got ${Math.round(spanDays)})`);
    } else {
      // Default capture pins the cap and the budget headroom.
      assert.ok(recs.length <= 50, `default capture must respect limit=50 (got ${recs.length})`);
      const tool = __testing__.TOOL_REGISTRY.find((t) => t.name === 'get_security_advisories');
      const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      assert.ok(bytes < tool._outputBudgetBytes,
        `default response (${bytes}B) must fit _outputBudgetBytes (${tool._outputBudgetBytes}B)`);
    }
  },

  get_sovereign_stress_screen(payload, cap) {
    const d = payload.data;
    for (const label of ['fiscal-space', 'reserve-adequacy', 'external-debt', 'fuel-stocks', 'sovereign-wealth', 'wb-external-debt']) {
      assert.ok(d[label] && typeof d[label] === 'object', `${label} label must be present`);
    }
    // An 8-country dataset must never read as global coverage.
    assert.ok(Object.keys(d['sovereign-wealth'].countries ?? {}).length <= 10,
      'sovereign-wealth is a single-digit-country dataset — a larger map means the source changed and the description must be re-verified');
    if (cap.args?.limit === 0) {
      const us = d['fiscal-space'].countries?.US;
      assert.ok(us, 'uncapped fiscal-space must carry US');
      // debtSustainabilityGapPct is DERIVED (not a published series) — gapYear
      // must travel beside it so a consumer can see the vintage of the claim.
      assert.equal(typeof us.debtSustainabilityGapPct, 'number', 'US.debtSustainabilityGapPct must be a number');
      assert.ok('gapYear' in us, 'US.gapYear must accompany the derived gap');
      // Vintage skew is real and must stay visible: IMF fiscal vintages lead
      // reserve-adequacy vintages. Equality here would mean someone flattened
      // the year fields — the exact failure the per-dataset year exists for.
      const trReserve = d['reserve-adequacy'].countries?.TR;
      const trFiscal = d['fiscal-space'].countries?.TR;
      assert.ok(trReserve && trFiscal, 'uncapped capture must carry TR in both datasets');
      assert.ok(trFiscal.year > trReserve.year,
        `fiscal-space vintage (${trFiscal.year}) must lead reserve-adequacy vintage (${trReserve.year})`);
      assert.ok(Object.keys(d['fiscal-space'].countries).length >= 150,
        'uncapped fiscal-space must be broad-coverage (>=150 countries)');
    } else {
      // Default capture pins the per-dataset cap.
      for (const label of ['fiscal-space', 'reserve-adequacy', 'external-debt', 'wb-external-debt']) {
        assert.ok(Object.keys(d[label].countries ?? {}).length <= 40,
          `default ${label} map must respect the 40-entry cap`);
      }
    }
  },

  get_rates_fx_credit_pressure(payload) {
    const d = payload.data;
    for (const label of ['policy', 'eer', 'credit', 'bis-lbs']) {
      assert.ok(d[label] && typeof d[label] === 'object', `${label} label must be present`);
    }
    const eerRows = d.eer.rates;
    assert.ok(Array.isArray(eerRows) && eerRows.length >= 10, 'eer.rates must carry the panel');
    const realPopulated = eerRows.filter((r) => typeof r.realEer === 'number' && r.realEer !== 0);
    assert.ok(realPopulated.length >= 10, `realEer must be populated on >=10 rows (got ${realPopulated.length})`);
    // XM (euro area) is deliberately non-ISO — the schema must never grow an
    // ISO-3166 alpha-2 pattern that would reject it.
    assert.ok(d.policy.rates.some((r) => r.countryCode === 'XM'), 'policy.rates must contain the XM euro-area aggregate');
  },

  get_financial_conditions_regime(payload) {
    const d = payload.data;
    const ms = d['macro-signals'];
    assert.ok(ms, 'macro-signals label must be present');
    assert.equal(ms.unavailable, false, 'macro-signals.unavailable must be false on a seeded stack');
    assert.ok(ms.bullishCount <= ms.totalCount, 'bullishCount must not exceed totalCount');
    // 1 of 7 signals carries no numeric evidence — pin it so the schema can
    // never start promising numbers it does not have.
    assert.deepEqual(Object.keys(ms.signals.priceMomentum), ['status'],
      'priceMomentum must carry ONLY status (no numeric evidence exists for it)');
    assert.ok(Array.isArray(d['fsi-eu'].history) && d['fsi-eu'].history.length <= 60,
      'fsi-eu.history must respect the default history cap');
  },

  get_stablecoin_stress(payload) {
    const d = payload.data;
    const sc = d.stablecoins;
    assert.ok(sc, 'stablecoins label must be present');
    // Guards the "sample aggregate presented as market total" error: the
    // summary must be computed over exactly the set that ships.
    assert.equal(sc.summary.coinCount, sc.stablecoins.length,
      'summary.coinCount must equal the shipped list length');
    for (const [i, coin] of sc.stablecoins.entries()) {
      assert.ok(!('image' in coin), `stablecoins[${i}].image must be ABSENT (remote CDN URL, stripped)`);
    }
    assert.equal(d['crypto-sectors'].sectors.length, 8, 'crypto-sectors must carry exactly 8 sectors');
  },

  // ---------------------------------------------------------------------------
  // Tier-1 batch 2 (session 04, RPC tools).
  // ---------------------------------------------------------------------------

  get_chokepoint_history(payload, cap) {
    if (cap.args?.chokepoint_id === 'bogus') {
      // Wrapper-level rejection: the route's own bad-id answer is
      // byte-identical to relay-down, so the tool must never let a bad id
      // through to it.
      assert.equal(typeof payload.error, 'string', 'bad id must produce a result-level error');
      assert.ok(payload.error.includes('hormuz_strait'), 'the error must enumerate valid ids');
      assert.ok(!('history' in payload), 'a rejected call must carry NO history field');
      return;
    }
    assert.equal(payload.chokepointId, cap.args.chokepoint_id, 'chokepointId must echo the request');
    assert.ok(Array.isArray(payload.history) && payload.history.length >= 150,
      `history must be deep (>=150 daily rows, got ${payload.history?.length})`);
    // The relay-down signature is fetchedAt "0" + empty history — a healthy
    // capture must be distinguishable from it.
    assert.equal(typeof payload.fetchedAt, 'string', 'fetchedAt must be a string');
    assert.notEqual(payload.fetchedAt, '0', 'healthy capture must not carry the relay-down signature');
    const dates = payload.history.map((h) => h.date);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] > dates[i - 1], `history dates must be strictly ascending (${dates[i - 1]} -> ${dates[i]})`);
    }
    assert.ok(payload.history.some((h) => h.total !== 0), 'at least one row must carry non-zero total');
    const row = payload.history[0];
    for (const k of ['date', 'container', 'dryBulk', 'generalCargo', 'roro', 'tanker', 'cargo', 'other', 'total', 'capContainer', 'capDryBulk', 'capGeneralCargo', 'capRoro', 'capTanker']) {
      assert.ok(k in row, `history rows must carry ${k}`);
    }
  },

  get_regional_snapshot(payload) {
    const s = payload.snapshot;
    assert.ok(s, 'snapshot must be present (the wrapper converts the empty-{} route answer to a result error)');
    // The self-discount trio is the tool's honesty surface — required, not decorative.
    assert.ok(Array.isArray(s.meta.missingInputs) && s.meta.missingInputs.length >= 1,
      'meta.missingInputs must be present and non-empty on this deployment');
    assert.ok(Array.isArray(s.meta.staleInputs), 'meta.staleInputs must be an array');
    assert.ok(typeof s.meta.snapshotConfidence === 'number' && s.meta.snapshotConfidence > 0 && s.meta.snapshotConfidence <= 1,
      'meta.snapshotConfidence must be a (0,1] number');
    assert.ok(typeof s.regime.label === 'string' && s.regime.label.length > 0, 'regime.label must be non-empty');
    // Husk pins: these fields are deliberately UNDECLARED in the schema.
    // If a producer starts filling them, these assertions fail — that is the
    // signal to promote them into the declared contract, not a bug.
    assert.equal(s.narrative?.situation?.text, '', 'narrative.situation.text must remain an empty husk');
    assert.deepEqual(s.leverageEdges, [], 'leverageEdges must remain an empty husk');
    assert.deepEqual(s.transmissionPaths, [], 'transmissionPaths must remain an empty husk');
    assert.deepEqual(s.triggers?.active, [], 'triggers.active must remain an empty husk');
    assert.deepEqual(s.triggers?.watching, [], 'triggers.watching must remain an empty husk');
  },

  get_gold_intelligence(payload) {
    assert.equal(payload.unavailable, false, 'unavailable must be false on a seeded stack');
    // The healthy-unenriched pair: updatedAt '' while unavailable false is
    // VALID (enrichment key unseeded by design). A consumer treating '' as an
    // error would misread a healthy response — this pin keeps that documented
    // semantic true. If gold-extended gets seeded, update this tooth AND the
    // manifest note together.
    assert.equal(payload.updatedAt, '', 'updatedAt must be the empty string while gold-extended is unseeded');
    assert.ok(payload.goldPrice > 0, 'goldPrice must be positive');
    // The numeric-as-string trap, pinned from the wire.
    assert.equal(typeof payload.cot.managedMoney.longPositions, 'string', 'COT longPositions must be a STRING');
    assert.equal(typeof payload.cot.openInterest, 'string', 'COT openInterest must be a STRING');
    assert.equal(payload.crossCurrencyPrices.length, 6, 'crossCurrencyPrices must carry all 6 FX legs');
    assert.equal(typeof payload.goldSilverRatio, 'number', 'goldSilverRatio must be present');
    for (const k of ['session', 'returns', 'range52w']) {
      assert.ok(!(k in payload), `${k} must be ABSENT while gold-extended is unseeded`);
    }
    assert.equal(payload.cbReserves.totalTonnes, 0, 'cbReserves.totalTonnes is 0 on this deployment (producer gap — update on producer fix)');
    assert.ok(payload.cbReserves.topHolders.length >= 5, 'cbReserves.topHolders must be populated despite the zero total');
  },

  // get_population_exposure validator removed at the 2026-08 upstream sync:
  // the fork wrapper it asserted was retired in favour of upstream's
  // analysis-tools implementation (different output shape). See the manifest's
  // `pending` entry — recapture + new teeth against the upstream tool, and
  // re-verify the Null-Island (0,0)→Nigeria guard before trusting it.

  classify_event_keyword(payload, cap) {
    const c = payload.classification;
    assert.ok(c, 'classification must always be present (terminal fallback means never null)');
    // Executed values, not observed samples — the classifier is deterministic.
    const expected = {
      'Russia launches invasion of northern Ukraine':
        { level: 'critical', category: 'conflict', severity: 100, confidence: 0.9, source: 'keyword' },
      'Ransomware attack cripples German hospital network':
        { level: 'high', category: 'cyber', severity: 75, confidence: 0.8, source: 'keyword' },
    }[cap.args?.title];
    assert.ok(expected, `no expectation registered for title "${cap.args?.title}" — add one when adding captures`);
    assert.deepEqual(c, expected, 'deterministic classifier must reproduce the executed values exactly');
    // The hosted contract's husk fields must never re-enter.
    for (const k of ['subcategory', 'analysis', 'entities']) {
      assert.ok(!(k in c) && !(k in payload), `${k} must be ABSENT (hosted-contract husk)`);
    }
  },
};

describe('MCP oracle contract coverage (real captures, presence/absence teeth)', () => {
  const { captures, pending } = collectCaptures();

  it('oracle captures exist for the schema-corrected tools and all ten Tier-1 tools', (t) => {
    if (captures.length === 0) {
      t.skip('no oracle captures yet — run scripts/capture-mcp-fixture.mjs --dir oracle/<date> (see tests/fixtures/oracle/README.md)');
      return;
    }
    const tools = new Set(captures.map((c) => c.tool));
    const pendingTools = new Map(pending.map((p) => [p.tool, p.reason]));
    for (const required of [
      // Session-02 schema-corrected trio.
      'get_country_risk', 'get_conflict_events', 'get_country_brief',
      // Tier-1 batch 1 (session 03, cache).
      'get_security_advisories', 'get_sovereign_stress_screen', 'get_rates_fx_credit_pressure',
      'get_financial_conditions_regime', 'get_stablecoin_stress',
      // Tier-1 batch 2 (session 04, rpc).
      'get_chokepoint_history', 'get_regional_snapshot', 'get_gold_intelligence',
      'get_population_exposure', 'classify_event_keyword',
    ]) {
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

// -----------------------------------------------------------------------------
// Declared-schema absence teeth — these guard the SCHEMAS, not the payloads.
// The one-directional validator lets a declared-but-never-filled field ride
// green forever, so the only defence against husk fields re-entering the
// contract is asserting they are not declared. Each entry names the reason.
// -----------------------------------------------------------------------------
describe('MCP declared-schema absence teeth (husk fields must stay undeclared)', () => {
  const tool = (name) => {
    const t = __testing__.TOOL_REGISTRY.find((entry) => entry.name === name);
    assert.ok(t, `${name} must be registered`);
    return t;
  };

  it('get_rates_fx_credit_pressure does not declare nominalEer (0 on 12/12 live rows)', () => {
    assert.ok(!JSON.stringify(tool('get_rates_fx_credit_pressure').outputSchema).includes('nominalEer'),
      'nominalEer is a dead field — declaring it invites a nominal/real spread computed from zeros');
  });

  it('get_financial_conditions_regime declares no enum on verdict/status (free-text producer vocabulary)', () => {
    const schema = JSON.stringify(tool('get_financial_conditions_regime').outputSchema);
    assert.ok(!/"verdict":\{[^}]*"enum"/.test(schema),
      'verdict is free text with inconsistent casing — an enum would reject live values');
  });

  it('get_gold_intelligence does not declare the gold-extended husks (session/returns/range52w/drivers)', () => {
    const schema = JSON.stringify(tool('get_gold_intelligence').outputSchema);
    for (const k of ['"session"', '"returns"', '"range52w"', '"drivers"']) {
      assert.ok(!schema.includes(k), `${k} must stay undeclared while market:gold-extended:v1 is unseeded`);
    }
  });

  it('get_regional_snapshot does not declare the producer husks (narrative/leverageEdges/transmissionPaths/mobility/triggers)', () => {
    const schema = JSON.stringify(tool('get_regional_snapshot').outputSchema);
    for (const k of ['"narrative"', '"leverageEdges"', '"transmissionPaths"', '"mobility"', '"triggers"']) {
      assert.ok(!schema.includes(k), `${k} must stay undeclared — empty on all 8 regions`);
    }
  });

  it('classify_event_keyword does not declare the hosted-contract husks (subcategory/analysis/entities)', () => {
    const schema = JSON.stringify(tool('classify_event_keyword').outputSchema);
    for (const k of ['"subcategory"', '"analysis"', '"entities"']) {
      assert.ok(!schema.includes(k), `${k} must stay undeclared — the local proto hardcodes it to a husk`);
    }
  });

  it('get_security_advisories does not declare byCountryName (stripped) or the unservable similarity contract', () => {
    const schema = JSON.stringify(tool('get_security_advisories').outputSchema);
    for (const k of ['byCountryName', '"similarity"', '"embedding"', '"rank"']) {
      assert.ok(!schema.includes(k), `${k} must stay undeclared`);
    }
  });
});
