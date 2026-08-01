#!/usr/bin/env node

import { loadEnvFile, CHROME_UA, runSeed, imfSdmxFetchIndicator } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

// FiscalData moved this dataset under /fiscal_service/v2/; the old
// /services/api/v1/ path now 404s, which fetchTreasury()'s catch swallowed —
// USA silently fell back to the IMF WEO *projection* instead of live actual
// debt (2026-07-30: $39.84T actual vs $43.45T projected).
const TREASURY_URL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&sort=-record_date&page[size]=1';

const CANONICAL_KEY = 'economic:national-debt:v1';
// 65 days — must exceed health.js SEED_META.nationalDebt.maxStaleMin (60d) so
// a missed monthly cron keeps the canonical payload readable through the
// STALE_SEED warn window instead of vanishing into EMPTY crit at day 35.
// writeFreshnessMetadata() uses max(7d, ttlSeconds) → meta TTL tracks this.
const CACHE_TTL = 65 * 24 * 3600;

// IMF WEO regional aggregate codes (not real sovereign countries)
const AGGREGATE_CODES = new Set([
  'ADVEC', 'EMEDE', 'EURO', 'MECA', 'OEMDC', 'WEOWORLD', 'EU',
  'AS5', 'DA', 'EDE', 'MAE', 'OAE', 'SSA', 'WE', 'EMDE', 'G20',
]);

// Overseas territories / non-sovereign entities to exclude
const TERRITORY_CODES = new Set(['ABW', 'PRI', 'WBG']);

function isAggregate(code) {
  if (!code || code.length !== 3) return true;
  return AGGREGATE_CODES.has(code) || TERRITORY_CODES.has(code) || code.endsWith('Q');
}

async function fetchTreasury() {
  const resp = await fetch(TREASURY_URL, {
    headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Treasury API: HTTP ${resp.status}`);
  const data = await resp.json();
  const record = data?.data?.[0];
  if (!record) return null;
  return {
    date: record.record_date,
    debtUsd: Number(record.tot_pub_debt_out_amt),
  };
}

function deriveWeoYear(debtPctByCountry) {
  let maxYear = 0;
  for (const byYear of Object.values(debtPctByCountry || {})) {
    for (const [yearStr, value] of Object.entries(byYear || {})) {
      const y = Number(yearStr);
      const v = Number(value);
      if (Number.isFinite(y) && y > maxYear && Number.isFinite(v) && v > 0) {
        maxYear = y;
      }
    }
  }
  return maxYear > 0 ? maxYear : null;
}

function latestYearWithValue(byYear) {
  if (!byYear) return null;
  let best = null;
  for (const [yearStr, value] of Object.entries(byYear)) {
    const y = Number(yearStr);
    const v = Number(value);
    if (Number.isFinite(y) && Number.isFinite(v) && v > 0 && (best === null || y > best)) {
      best = y;
    }
  }
  return best;
}

export function computeEntries(debtPctByCountry, gdpByCountry, deficitPctByCountry, treasuryOverride) {
  const SECONDS_PER_YEAR = 365.25 * 86400;
  const weoYear = deriveWeoYear(debtPctByCountry);
  const weoLabel = weoYear ? `IMF WEO ${weoYear}` : 'IMF WEO';
  // Baseline = Jan 1 of the vintage year so the live ticker advances from a
  // sensible anchor once a newer WEO vintage lands.
  const BASELINE_TS = Date.UTC(weoYear ?? new Date().getUTCFullYear(), 0, 1);

  const entries = [];

  for (const [iso3, debtByYear] of Object.entries(debtPctByCountry)) {
    if (isAggregate(iso3)) continue;

    const gdpByYear = gdpByCountry[iso3];
    if (!gdpByYear) continue;

    const latestDebtYear = latestYearWithValue(debtByYear);
    if (latestDebtYear === null) continue;

    const gdpYear = latestYearWithValue(gdpByYear) ?? latestDebtYear;
    const gdpLatest = Number(gdpByYear[String(gdpYear)]);
    if (!Number.isFinite(gdpLatest) || gdpLatest <= 0) continue;

    const effectiveDebtPct = Number(debtByYear[String(latestDebtYear)]);
    const prevYear = String(latestDebtYear - 1);
    const prevDebtPct = Number(debtByYear[prevYear]);
    const hasPrev = Number.isFinite(prevDebtPct) && prevDebtPct > 0;

    // IMF SDMX `NGDPD` returns GDP in RAW USD (e.g. USA 2024 = 29_298_025_000_000
    // ≈ $29.3T), not the billions the legacy WEO API published. Same class as the
    // `LP` persons-vs-millions fix in seed-imf-labor.mjs — SDMX 3.0 hands back
    // fully expanded values. The DSD does advertise `series.SCALE = "9"`, but that
    // describes how WEO *presents* the series, not a multiplier still owed here:
    // applying it inflated debtUsd/gdpUsd by 1e9 (USA read $43446021592.1T).
    // debtToGdp comes straight from GGXWDG_NGDP and both absolutes shared the
    // same bad factor, so neither the ratio nor the panel could reveal it.
    const gdpUsd = gdpLatest;
    let debtUsd = (effectiveDebtPct / 100) * gdpUsd;

    // Override USA with live Treasury data when available
    if (iso3 === 'USA' && treasuryOverride && treasuryOverride.debtUsd > 0) {
      debtUsd = treasuryOverride.debtUsd;
    }

    let annualGrowth = 0;
    if (hasPrev) {
      annualGrowth = ((effectiveDebtPct - prevDebtPct) / prevDebtPct) * 100;
    }

    const deficitByYear = deficitPctByCountry[iso3];
    const deficitPct2024 = deficitByYear ? Number(deficitByYear[String(latestDebtYear)] ?? deficitByYear[prevYear]) : NaN;
    let perSecondRate = 0;
    let perDayRate = 0;
    // Only accrue when running a deficit (GGXCNL_NGDP < 0 = net borrower).
    // Surplus countries (Norway, Kuwait, Singapore, etc.) tick at 0 — not upward.
    if (Number.isFinite(deficitPct2024) && deficitPct2024 < 0) {
      const deficitAbs = (Math.abs(deficitPct2024) / 100) * gdpUsd;
      perSecondRate = deficitAbs / SECONDS_PER_YEAR;
      perDayRate = deficitAbs / 365.25;
    }

    entries.push({
      iso3,
      debtUsd,
      gdpUsd,
      debtToGdp: effectiveDebtPct,
      annualGrowth,
      perSecondRate,
      perDayRate,
      baselineTs: BASELINE_TS,
      source: iso3 === 'USA' && treasuryOverride ? `${weoLabel} + US Treasury FiscalData` : weoLabel,
    });
  }

  entries.sort((a, b) => b.debtUsd - a.debtUsd);
  return entries;
}

// Rolling 4-year window: two historical, current, one forward. WEO publishes
// the current-year vintage mid-year and forecasts forward — this keeps the
// seed picking up newer vintages without manual edits.
export function weoYearWindow(now = new Date()) {
  const y = now.getUTCFullYear();
  return [String(y - 2), String(y - 1), String(y), String(y + 1)];
}

async function fetchNationalDebt() {
  const years = weoYearWindow();
  const [debtPctData, gdpData, deficitData, treasury] = await Promise.all([
    imfSdmxFetchIndicator('GGXWDG_NGDP', { years }),
    imfSdmxFetchIndicator('NGDPD', { years }),
    imfSdmxFetchIndicator('GGXCNL_NGDP', { years }),
    // Non-fatal: the IMF projection is a usable fallback for USA. But warn —
    // a silent null here is what let the dead v1 endpoint go unnoticed.
    fetchTreasury().catch((err) => {
      console.warn(`WARN: Treasury debt_to_penny unavailable (${err.message || err}); USA falls back to the IMF WEO projection.`);
      return null;
    }),
  ]);

  const entries = computeEntries(debtPctData, gdpData, deficitData, treasury);

  return {
    entries,
    seededAt: new Date().toISOString(),
  };
}

// Plausibility band for the largest economy's GDP. The 1e9 units bug shipped
// silently because the only check was a row count — a $33_790_035_432_000_000_000_000
// GDP passed just as happily as a real one. The largest national GDP is ~$29T, so
// anything outside [$1T, $1000T] means the source changed scale in one direction
// or the other. Fail the seed rather than overwrite good data with garbage.
const MAX_GDP_FLOOR_USD = 1e12;
const MAX_GDP_CEILING_USD = 1e15;

function validate(data) {
  if (!Array.isArray(data?.entries) || data.entries.length < 100) return false;

  const maxGdp = data.entries.reduce(
    (max, e) => (Number.isFinite(e?.gdpUsd) && e.gdpUsd > max ? e.gdpUsd : max),
    0,
  );
  if (maxGdp < MAX_GDP_FLOOR_USD || maxGdp > MAX_GDP_CEILING_USD) {
    console.error(
      `FATAL: implausible max gdpUsd=${maxGdp} (expected ${MAX_GDP_FLOOR_USD}..${MAX_GDP_CEILING_USD}). ` +
      'IMF SDMX likely changed the NGDPD scale — check units before re-seeding.',
    );
    return false;
  }
  return true;
}

// Guard: only run seed when executed directly, not when imported by tests
export function declareRecords(data) {
  return Array.isArray(data?.entries) ? data.entries.length : 0;
}

if (process.argv[1]?.endsWith('seed-national-debt.mjs')) {
  runSeed('economic', 'national-debt', CANONICAL_KEY, fetchNationalDebt, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'imf-sdmx-weo-2024',
    recordCount: (data) => data?.entries?.length ?? 0,
  
    declareRecords,
    schemaVersion: 1,
    // Matches api/health.js SEED_META.nationalDebt (60d = 2× monthly interval).
    // runSeed only validates the field is present; health.js is the actual
    // alarm source, but keeping these in sync prevents future drift.
    maxStaleMin: 86400,
  }).catch((err) => {
    const _cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + _cause);
    process.exit(1);
  });
}
