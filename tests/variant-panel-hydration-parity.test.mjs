import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataLoader = readFileSync(join(root, 'src/app/data-loader.ts'), 'utf8');
const app = readFileSync(join(root, 'src/App.ts'), 'utf8');
const panels = readFileSync(join(root, 'src/config/panels.ts'), 'utf8');

// The bug this pins: the boot hydration fan-out (data-loader) and the refresh
// scheduler (App) each gated the supply-chain family on a hand-written variant
// list — full/finance/commodity/energy. When `trader` was added, whose single
// OSINT panel IS supply-chain, both lists silently excluded it: the panel
// hydrated once through the ungated viewport prime and then never refreshed,
// on trader and on no other variant.
//
// The fix is to derive membership from the panel registry, so a new variant
// cannot be missed. These tests fail if anyone reintroduces a hardcoded list.
const SUPPLY_CHAIN_FAMILY = [
  'trade-policy',
  'supply-chain',
  'china-corridors',
  'china-activity-nowcast',
];

describe('variant panel hydration parity', () => {
  it('gates the supply-chain family on the registry, not a hardcoded variant list', () => {
    for (const panelId of SUPPLY_CHAIN_FAMILY) {
      assert.ok(
        dataLoader.includes(`isPanelInVariantDefaults('${panelId}')`),
        `data-loader must gate ${panelId} hydration on the panel registry`,
      );
      assert.ok(
        app.includes(`isPanelInVariantDefaults('${panelId}')`),
        `App must gate the ${panelId} refresh on the panel registry`,
      );
    }
  });

  it('leaves no hardcoded variant enumeration around either gate', () => {
    // The exact shape that caused the bug. Matching the disjunction rather than
    // any mention of SITE_VARIANT keeps this specific: other call sites
    // legitimately branch on the variant.
    const hardcoded = /SITE_VARIANT === 'full'\s*\|\|\s*SITE_VARIANT === 'finance'\s*\|\|\s*SITE_VARIANT === 'commodity'\s*\|\|\s*SITE_VARIANT === 'energy'/;
    assert.doesNotMatch(
      dataLoader,
      hardcoded,
      'the four-variant list is what silently dropped trader — derive membership instead',
    );
    assert.doesNotMatch(
      app,
      hardcoded,
      'the four-variant list is what silently dropped trader — derive membership instead',
    );
  });

  it('keeps a panel the variant renders and the loader hydrates in agreement', () => {
    // Guard against the inverse hole: a gate that is registry-derived but whose
    // helper stops being registry-derived. isPanelInVariantDefaults must read
    // VARIANT_DEFAULTS for the ACTIVE variant, or every assertion above passes
    // vacuously while the behaviour regresses.
    assert.match(
      panels,
      /const SITE_VARIANT_DEFAULTS = new Set\(VARIANT_DEFAULTS\[SITE_VARIANT\] \?\? \[\]\);/,
      'isPanelInVariantDefaults must derive from VARIANT_DEFAULTS[SITE_VARIANT]',
    );
    assert.match(
      panels,
      /export function isPanelInVariantDefaults\(key: string\): boolean \{\s*return SITE_VARIANT_DEFAULTS\.has\(key\);/,
      'isPanelInVariantDefaults must answer from that derived set',
    );
  });
});
