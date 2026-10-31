import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  LOCALES,
  baselinePathFor,
  classifyKeys,
  expectedKeysForLocale,
  findPluralBases,
  flatten,
  getPluralCategories,
  localesRootFor,
} from '../scripts/translate-locales.mjs';

const LOCALES_DIR = localesRootFor(false);
const BASELINE_PATH = baselinePathFor(false);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const enFlat = flatten(readJson(`${LOCALES_DIR}/en.json`));
const REFRESH_HINT =
  'Run the app translation pass, then regenerate zh-TW: ' +
  'ANTHROPIC_API_KEY=... node scripts/translate-locales.mjs && npm run locales:zh-tw';

const NEW_TRANSLATED_KEYS = [
  ...['upcomingForecast', 'currentForecast', 'expiredForecast', 'validFrom', 'validUntil']
    .map(key => `popups.${key}`),
  'countryBrief.chips.normalPrecautions',
  'popups.militaryFlight.climbRate',
  'popups.militaryFlight.manufacturer',
  'popups.militaryFlight.owner',
  'popups.militaryFlight.builtYear',
  'popups.militaryCluster.showLess',
  'preferences.panelFontScale',
  'preferences.followGlobalFontScale',
  ...['waiting', 'offline', 'updated', 'saved', 'savedOffline', 'emptySaved', 'localSignals']
    .map(key => `components.correlation.${key}`),
];

// Current English-identity counts plus three values of reviewable headroom.
// A translation improvement should lower its locale's ceiling. A legitimate
// English product term may raise one explicitly, but bulk placeholder copies
// must not pass only because their keys exist.
const ENGLISH_CEILING = {
  // the-synactic fork (CONTEXT.md v10): fork-local keys (DEFCON, panel focus
  // views, trader header, MCP preset hints, widget toasts) ship as English
  // placeholders in every locale by design on a private, English-operated
  // self-host. Each ceiling is that locale's current English-identical count
  // plus the same three values of reviewable headroom upstream uses.
  ar: 409, bg: 296, cs: 352, de: 251, el: 407, es: 221,
  fa: 2493, fr: 487, hi: 210, hr: 341, hu: 312, it: 313,
  ja: 434, ko: 295, nl: 569, pl: 508, pt: 511, ro: 448,
  ru: 146, sv: 536, sw: 450, th: 362, tr: 452, uk: 181,
  vi: 252, zh: 133, 'zh-TW': 133,
};

function lookup(value, dotted) {
  return dotted.split('.').reduce((current, part) => current?.[part], value);
}

describe('app locale freshness', () => {
  it('tracks every shipped app locale', () => {
    const shipped = readdirSync(LOCALES_DIR)
      .filter((name) => name.endsWith('.json') && !['en.json', 'en.shell.json'].includes(name))
      .map((name) => name.replace(/\.json$/, ''))
      .sort();
    assert.deepEqual(shipped, [...LOCALES].sort());
  });

  it('keeps the English provenance baseline in step with en.json', () => {
    assert.ok(existsSync(BASELINE_PATH), `${BASELINE_PATH} is missing. ${REFRESH_HINT}`);
    const baseline = readJson(BASELINE_PATH);
    const drifted = Object.keys(enFlat).filter((key) => baseline[key] !== enFlat[key]);
    const dropped = Object.keys(baseline).filter((key) => !(key in enFlat));
    assert.deepEqual({ drifted, dropped }, { drifted: [], dropped: [] }, REFRESH_HINT);
  });

  it('ships every locale complete and free of stale or orphaned values', () => {
    const baseline = readJson(BASELINE_PATH);
    const pluralBases = findPluralBases(enFlat);
    const baselinePlurals = findPluralBases(baseline);
    const problems = [];

    for (const locale of LOCALES) {
      const categories = getPluralCategories(locale);
      const result = classifyKeys(
        flatten(readJson(`${LOCALES_DIR}/${locale}.json`)),
        expectedKeysForLocale(enFlat, pluralBases, categories),
        expectedKeysForLocale(baseline, baselinePlurals, categories),
        true,
      );
      if (result.missing.length || result.stale.length || result.orphan.length) {
        problems.push(
          `${locale}: ${result.missing.length} missing, ${result.stale.length} stale, ` +
          `${result.orphan.length} orphaned`,
        );
      }
    }

    assert.deepEqual(problems, [], REFRESH_HINT);
  });

  it('does not persist new labels as English placeholders', () => {
    const en = readJson(`${LOCALES_DIR}/en.json`);
    const placeholders = [];
    for (const locale of LOCALES) {
      const translated = readJson(`${LOCALES_DIR}/${locale}.json`);
      for (const key of NEW_TRANSLATED_KEYS) {
        if (lookup(translated, key) === lookup(en, key)) placeholders.push(`${locale}:${key}`);
      }
    }
    assert.deepEqual(placeholders, [], 'translate these labels instead of copying English values');
  });

  it('does not let a locale drift toward untranslated English', () => {
    const overBudget = [];
    for (const locale of LOCALES) {
      const flat = flatten(readJson(`${LOCALES_DIR}/${locale}.json`));
      const identical = Object.keys(flat).filter((key) => key in enFlat && flat[key] === enFlat[key]);
      const ceiling = ENGLISH_CEILING[locale];
      if (ceiling === undefined || identical.length > ceiling) {
        overBudget.push(`${locale}: ${identical.length} English-identical values, ceiling ${ceiling ?? 'missing'}`);
      }
    }
    assert.deepEqual(overBudget, []);
  });
});
