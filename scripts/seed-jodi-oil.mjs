#!/usr/bin/env node

import { createRequire } from 'node:module';

import {
  loadEnvFile,
  getRedisCredentials,
  acquireLockSafely,
  releaseLock,
  extendExistingTtl,
  logSeedResult,
  withRetry,
  readSeedSnapshot,
} from './_seed-utils.mjs';
import {
  assessChinaJodiCoverage,
  hasFiniteMeasurementAtPaths,
} from './shared/jodi-content-age.mjs';

loadEnvFile(import.meta.url);
const require = createRequire(import.meta.url);
const JODI_MEASUREMENT_FIELDS = require('./shared/jodi-measurement-fields.json');

export const CANONICAL_KEY = 'energy:jodi-oil:v1:_countries';
export const COUNTRY_KEY_PREFIX = 'energy:jodi-oil:v1:';
export const JODI_TTL = 3_024_000; // 35 days
const META_KEY = 'seed-meta:energy:jodi-oil';
const LOCK_DOMAIN = 'energy:jodi-oil';
const LOCK_TTL_MS = 10 * 60 * 1000;
const MIN_VALID_COUNTRIES = 40;
const ANOMALY_DEMAND_KBD = 10_000;

const JODI_BASE = 'https://www.jodidata.org/_resources/files/downloads/oil-data/annual-csv/';

// Honest declared bot UA (CONTEXT.md boundary 2 v9). [VERIFIED probe
// 2026-08-03] JODI answers this UA with HTTP 206 on ranged GETs of every
// annual-csv file below, so the browser-impersonation UA this seeder used to
// send was buying nothing and is gone.
const JODI_UA = 'the-synactic/2.10 (+https://github.com/clduab11/the-synactic)';

// Every annual CSV starts with this column list; used to reject an HTML error
// page served with a 200 before it is mistaken for a valid (empty) payload.
const CSV_HEADER_PREFIX = 'REF_AREA,TIME_PERIOD,';

const SECONDARY_PRODUCTS = {
  GASOLINE: 'gasoline',
  GASDIES: 'diesel',
  JETKERO: 'jet',
  RESFUEL: 'fuelOil',
  LPG: 'lpg',
};

function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

export function parseCsv(text) {
  const lines = text.split('\n');
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = splitCsvLine(line);
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = parts[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

export function parseObsValue(raw) {
  if (!raw || raw === '-' || raw === 'x' || raw.toLowerCase() === 'na') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

export function extractCountryData(allRows, iso2) {
  const rows = allRows.filter(r => r.REF_AREA === iso2 && r.UNIT_MEASURE === 'KBD');

  const byMonth = new Map();
  for (const r of rows) {
    const month = r.TIME_PERIOD;
    if (!month) continue;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(r);
  }

  const sortedMonths = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));

  let dataMonth = null;
  for (const month of sortedMonths) {
    const monthRows = byMonth.get(month);
    const hasValidCode = monthRows.some(r => r.ASSESSMENT_CODE === '1' || r.ASSESSMENT_CODE === '2');
    if (!hasValidCode) continue;
    // Require at least one valid secondary-product row so a failed secondary
    // download (crude-only month) never becomes the chosen dataMonth.
    const hasSecondaryData = monthRows.some(
      r => (r.ASSESSMENT_CODE === '1' || r.ASSESSMENT_CODE === '2') && r.ENERGY_PRODUCT in SECONDARY_PRODUCTS,
    );
    if (hasSecondaryData) {
      dataMonth = month;
      break;
    }
  }

  if (!dataMonth) return null;

  const monthRows = byMonth.get(dataMonth) || [];

  function pickVal(product, flow, isAnomalyCapped) {
    const r = monthRows.find(row => row.ENERGY_PRODUCT === product && row.FLOW_BREAKDOWN === flow);
    if (!r) return null;
    const code = r.ASSESSMENT_CODE;
    if (code === '3') return null;
    const val = parseObsValue(r.OBS_VALUE);
    if (val === null) return null;
    if (isAnomalyCapped && iso2 !== 'US' && flow === 'TOTDEMO' && val > ANOMALY_DEMAND_KBD) return null;
    return val;
  }

  const seededAt = new Date().toISOString();

  const secondaryProducts = {};
  for (const [prodCode, prodName] of Object.entries(SECONDARY_PRODUCTS)) {
    secondaryProducts[prodName] = {
      demandKbd:    pickVal(prodCode, 'TOTDEMO',  true),
      refOutputKbd: pickVal(prodCode, 'REFGROUT', false),
      importsKbd:   pickVal(prodCode, 'TOTIMPSB', false),
      exportsKbd:   pickVal(prodCode, 'TOTEXPSB', false),
    };
  }

  let crudeProductionKbd = null;
  let crudeRefineryIntakeKbd = null;
  let crudeImportsKbd = null;
  let crudeExportsKbd = null;

  for (const prodCode of ['CRUDEOIL', 'TOTCRUDE']) {
    if (crudeProductionKbd === null) {
      crudeProductionKbd = pickVal(prodCode, 'INDPROD', false);
    }
    if (crudeRefineryIntakeKbd === null) {
      crudeRefineryIntakeKbd = pickVal(prodCode, 'REFINOBS', false);
    }
    if (crudeImportsKbd === null) {
      crudeImportsKbd = pickVal(prodCode, 'TOTIMPSB', false);
    }
    if (crudeExportsKbd === null) {
      crudeExportsKbd = pickVal(prodCode, 'TOTEXPSB', false);
    }
  }

  return {
    iso2,
    dataMonth,
    ...secondaryProducts,
    crude: {
      productionKbd:     crudeProductionKbd,
      refineryIntakeKbd: crudeRefineryIntakeKbd,
      importsKbd:        crudeImportsKbd,
      exportsKbd:        crudeExportsKbd,
    },
    seededAt,
  };
}

export function buildAllCountries(allRows) {
  const countries = new Set(allRows.filter(r => r.REF_AREA && r.UNIT_MEASURE === 'KBD').map(r => r.REF_AREA));
  const results = [];
  for (const iso2 of countries) {
    const data = extractCountryData(allRows, iso2);
    if (data) results.push(data);
  }
  return results;
}

export function validateCoverage(countries) {
  return countries.length >= MIN_VALID_COUNTRIES;
}

function hasOilMeasurements(record) {
  return hasFiniteMeasurementAtPaths(record, JODI_MEASUREMENT_FIELDS.oil);
}

export function assessChinaOilCoverage(countries, now = new Date()) {
  return assessChinaJodiCoverage(countries, now, hasOilMeasurements);
}

/**
 * JODI publishes each annual CSV under two different filenames depending on
 * whether the year is still open:
 *   - year still being published : <dataset>/<dataset>year<YYYY>.csv
 *   - year closed / archived     : <dataset>/<YYYY>.csv
 *
 * [VERIFIED probe 2026-08-03, ranged GET, honest UA]
 *   primary/primaryyear2026.csv     -> HTTP 206, 3,963,616 B, TIME_PERIOD 2026-01
 *   primary/2026.csv                -> HTTP 404
 *   secondary/secondaryyear2026.csv -> HTTP 206, 9,001,018 B, TIME_PERIOD 2026-01
 *   primary/2025.csv                -> HTTP 206, 11,598,300 B
 *   primary/primaryyear2025.csv     -> HTTP 404
 * Both shapes carry the identical 7-column header, so the parser is unchanged.
 *
 * The two shapes are mutually exclusive per year, and the flip happens at some
 * point after year-end that we do not control — so each year gets BOTH
 * candidates, ordered most-likely-first. Building only the archived shape (the
 * old behaviour) missed the entire current year of publications, which is what
 * pushed the downstream 6-month data-age gate into blocking publishes.
 *
 * @param {'primary'|'secondary'} dataset
 * @param {number} year
 * @param {boolean} isCurrentYear
 * @returns {string[]} base-relative paths, most-likely-first
 */
export function jodiCsvCandidates(dataset, year, isCurrentYear) {
  const inProgress = `${dataset}/${dataset}year${year}.csv`;
  const archived = `${dataset}/${year}.csv`;
  return isCurrentYear ? [inProgress, archived] : [archived, inProgress];
}

/**
 * Reject a payload that is not a JODI annual CSV (e.g. an HTML error page
 * returned with HTTP 200). CRLF-safe: only the header prefix is compared.
 */
export function assertParseableCsv(text, label) {
  let head = String(text ?? '');
  // Strip a leading BOM by code point — a literal U+FEFF in source is fragile.
  if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1);
  head = head.trimStart().slice(0, 200);
  if (!head.startsWith(CSV_HEADER_PREFIX)) {
    const err = new Error(`JODI CSV payload not parseable (no "${CSV_HEADER_PREFIX}..." header) for ${label}`);
    // A 200 that is not CSV means this candidate is the wrong shape (a landing
    // page, an error document), so the sweep may advance to the next name —
    // unlike an upstream refusal, which must abort. See fetchCsvWithFallback.
    err.unparseable = true;
    throw err;
  }
  return text;
}

async function fetchCsv(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': JODI_UA, Accept: 'text/csv,text/plain,*/*' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const err = new Error(`JODI CSV fetch failed: HTTP ${resp.status} for ${url}`);
    // Only a 404 means "this filename shape is not the live one for that year",
    // and only a 404 may advance to the next candidate. Every other 4xx is the
    // upstream refusing or throttling US: advancing on those would fire an
    // immediate zero-delay second GET at the same host, which is the
    // retry-through-a-429 posture boundary 2 v9 forbids. Mark 404 alone as
    // candidate-advancing; the rest abort the sweep.
    if (resp.status === 404) err.notFound = true;
    else if (resp.status >= 400 && resp.status < 500) err.nonRetryable = true;
    throw err;
  }
  return resp.text();
}

/**
 * Fetch one (dataset, year) annual CSV, trying each published filename shape
 * in order until one returns a parseable payload. Returns '' when every
 * candidate fails — matching the previous per-file soft-fail contract, so
 * mergeSourceRows still decides whether the run has enough to proceed. Every
 * candidate's failure reason is logged, never swallowed.
 */
async function fetchCsvWithFallback(dataset, year, isCurrentYear) {
  const candidates = jodiCsvCandidates(dataset, year, isCurrentYear);
  const failures = [];
  for (const rel of candidates) {
    try {
      const text = await withRetry(() => fetchCsv(`${JODI_BASE}${rel}`), 2, 2000);
      assertParseableCsv(text, rel);
      console.log(`  ${rel}: ${(text.length / 1024 / 1024).toFixed(1)} MB`);
      return text;
    } catch (e) {
      failures.push(`${rel}: ${e.message}`);
      // Advance only when this filename shape genuinely does not exist, or the
      // body was not parseable CSV. A 403/429/5xx means the host is refusing or
      // throttling — back off by aborting the sweep rather than immediately
      // asking the same host for the next name.
      if (!e.notFound && !e.unparseable) {
        console.warn(`  ${dataset} ${year} sweep aborted at ${rel} — upstream refused (${e.message}); not advancing to remaining candidates`);
        throw e;
      }
    }
  }
  console.warn(`  ${dataset} ${year} unavailable — all ${candidates.length} filename candidates failed: ${failures.join(' | ')}`);
  return '';
}

export function mergeSourceRows(primaryCurrent, primaryPrior, secondaryCurrent, secondaryPrior) {
  if (!secondaryCurrent && !secondaryPrior) {
    throw new Error('Both secondary JODI CSV files failed to download; product-level data unavailable');
  }
  const allRows = [
    ...(primaryCurrent ? parseCsv(primaryCurrent) : []),
    ...(primaryPrior ? parseCsv(primaryPrior) : []),
    ...(secondaryCurrent ? parseCsv(secondaryCurrent) : []),
    ...(secondaryPrior ? parseCsv(secondaryPrior) : []),
  ];
  return allRows.filter(r => r.UNIT_MEASURE === 'KBD');
}

async function fetchAllRows() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const priorYear = currentYear - 1;

  const [primaryCurrent, primaryPrior, secondaryCurrent, secondaryPrior] = await Promise.all([
    fetchCsvWithFallback('primary', currentYear, true),
    fetchCsvWithFallback('primary', priorYear, false),
    fetchCsvWithFallback('secondary', currentYear, true),
    fetchCsvWithFallback('secondary', priorYear, false),
  ]);

  return mergeSourceRows(primaryCurrent, primaryPrior, secondaryCurrent, secondaryPrior);
}

async function redisPipeline(commands) {
  const { url, token } = getRedisCredentials();
  const resp = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Redis pipeline failed: HTTP ${resp.status} — ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export function formatCoverageFailureReason({ hasGlobalCoverage, countryCount, chinaCoverage }) {
  const reasons = [];
  if (!hasGlobalCoverage) {
    reasons.push(`only ${countryCount} countries, need >=${MIN_VALID_COUNTRIES}`);
  }
  if (!chinaCoverage.ok) {
    reasons.push(`China JODI oil coverage failed: ${chinaCoverage.reason} (dataMonth=${chinaCoverage.dataMonth ?? 'missing'})`);
  }
  return reasons.join('; ');
}

async function main() {
  const startedAt = Date.now();
  const runId = `jodi-oil:${startedAt}`;

  console.log('=== energy:jodi-oil Seed ===');
  console.log(`  Run ID: ${runId}`);
  console.log(`  Key prefix: ${COUNTRY_KEY_PREFIX}`);

  const lock = await acquireLockSafely(LOCK_DOMAIN, runId, LOCK_TTL_MS, { label: LOCK_DOMAIN });
  if (lock.skipped) return;
  if (!lock.locked) {
    console.log('  SKIPPED: another seed run in progress');
    return;
  }

  try {
    console.log('  Fetching JODI CSV data (4 files)...');
    const allRows = await withRetry(fetchAllRows, 2, 3000);

    if (!allRows.length) {
      throw new Error('No KBD rows parsed from JODI CSV files');
    }

    console.log(`  Parsed ${allRows.length} KBD rows`);

    const countries = buildAllCountries(allRows);
    console.log(`  Built ${countries.length} country payloads`);

    const chinaCoverage = assessChinaOilCoverage(countries);
    const hasGlobalCoverage = validateCoverage(countries);
    if (!hasGlobalCoverage || !chinaCoverage.ok) {
      const reason = formatCoverageFailureReason({
        hasGlobalCoverage,
        countryCount: countries.length,
        chinaCoverage,
      });
      console.error(`  COVERAGE GATE FAILED: ${reason}`);
      const prevIso2List = await readSeedSnapshot(CANONICAL_KEY).catch(() => null);
      const prevCountryKeys = Array.isArray(prevIso2List)
        ? prevIso2List.map(iso2 => `${COUNTRY_KEY_PREFIX}${iso2}`)
        : countries.map(c => `${COUNTRY_KEY_PREFIX}${c.iso2}`);
      await extendExistingTtl([CANONICAL_KEY, META_KEY, ...prevCountryKeys], JODI_TTL);
      return;
    }

    const iso2List = countries.map(c => c.iso2);
    const metaPayload = { fetchedAt: Date.now(), recordCount: countries.length, chinaDataMonth: chinaCoverage.dataMonth };

    const commands = [];
    for (const payload of countries) {
      commands.push(['SET', `${COUNTRY_KEY_PREFIX}${payload.iso2}`, JSON.stringify(payload), 'EX', JODI_TTL]);
    }
    commands.push(['SET', CANONICAL_KEY, JSON.stringify(iso2List), 'EX', JODI_TTL]);
    commands.push(['SET', META_KEY, JSON.stringify(metaPayload), 'EX', JODI_TTL]);

    const results = await redisPipeline(commands);
    const failures = results.filter(r => r?.error || r?.result === 'ERR');
    if (failures.length > 0) {
      throw new Error(`Redis pipeline: ${failures.length}/${commands.length} commands failed`);
    }

    logSeedResult('energy', countries.length, Date.now() - startedAt, { source: 'jodi-oil' });
    console.log(`  Seeded ${countries.length} countries`);
    console.log(`\n=== Done (${Date.now() - startedAt}ms) ===`);
  } catch (err) {
    console.error(`  SEED FAILED: ${err.message}`);
    const prevIso2List = await readSeedSnapshot(CANONICAL_KEY).catch(() => null);
    const prevCountryKeys = Array.isArray(prevIso2List)
      ? prevIso2List.map(iso2 => `${COUNTRY_KEY_PREFIX}${iso2}`)
      : [];
    await extendExistingTtl([CANONICAL_KEY, META_KEY, ...prevCountryKeys], JODI_TTL).catch(() => {});
    throw err;
  } finally {
    await releaseLock(LOCK_DOMAIN, runId);
  }
}

const isMain = process.argv[1]?.endsWith('seed-jodi-oil.mjs');
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
