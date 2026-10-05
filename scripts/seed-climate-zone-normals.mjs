#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { loadEnvFile, runSeed, sleep } from './_seed-utils.mjs';
import { CLIMATE_ZONES, MIN_CLIMATE_ZONE_COUNT, hasRequiredClimateZones } from './_climate-zones.mjs';
import { OPEN_METEO_DEADLINE_CODE, chunkItems, fetchOpenMeteoArchiveBatch } from './_open-meteo-archive.mjs';

loadEnvFile(import.meta.url);

export const CLIMATE_ZONE_NORMALS_KEY = 'climate:zone-normals:v1';
// Keep the previous baseline available across monthly cron gaps; health.js enforces freshness separately.
const NORMALS_TTL = 95 * 24 * 60 * 60; // 95 days = >3x a 31-day monthly interval
const NORMALS_START = '1991-01-01';
const NORMALS_END = '2020-12-31';
const NORMALS_START_YEAR = 1991;
const NORMALS_END_YEAR = 2020;
const NORMALS_BATCH_SIZE = 2;
const NORMALS_BATCH_DELAY_MS = 3_000;
export const NORMALS_FETCH_PHASE_SOFT_DEADLINE_MS = 225_000;

function createNormalsFailure(message, deadlineExhausted) {
  const error = new Error(message);
  if (deadlineExhausted) {
    error.code = OPEN_METEO_DEADLINE_CODE;
    error.nonRetryable = true;
  }
  return error;
}

// ─── NASA POWER — PRIMARY source ────────────────────────────────────────────
//
// WHY THE RE-SOURCE. This seeder used to ask Open-Meteo's ERA5 archive for 30
// YEARS of DAILY data per zone (1991-01-01 .. 2020-12-31 x 25 zones ≈ 274k
// daily records). That single request pattern is what exhausted Open-Meteo's
// free-tier per-IP quota, and the previous "fix" was a Decodo proxy cascade
// that re-entered from a different egress IP to get around the throttle —
// forbidden by CONTEXT.md boundary 2 v9. The sanctioned remedy is re-sourcing,
// so the normals now come from NASA POWER: public domain (US Government work),
// no API key, no per-IP quota gate.
//
// WHY THE `monthly` ENDPOINT AND NOT `climatology`. POWER does publish a
// ready-made climatology endpoint, but it was probed on 2026-08-03 and its
// header reports "20-year ... Climatologies (January 2001 - December 2020)" —
// a 2001-2020 window, NOT the WMO 1991-2020 baseline this dataset is defined
// against. docs/climate-variant-full.md is explicit that the full 1991-2020
// period must be used and that a shorter proxy window is not acceptable, and
// seed-climate-anomalies computes its deltas against these means, so silently
// shifting the baseline by a decade would corrupt every downstream anomaly.
// The `monthly` endpoint accepts start=1991&end=2020 and returns one value per
// calendar month per year (390 keys = 30 years x 13, where the trailing "13"
// is POWER's ANNUAL aggregate), from which the true 1991-2020 monthly normal
// is a plain mean. One request per zone, no daily records at all.
//
// UNITS (verified against the probe): T2M is degrees C, matching Open-Meteo's
// temperature_2m_mean. PRECTOTCORR is mm/day, matching the semantics of the
// Open-Meteo path, whose precipMean is the mean of DAILY precipitation_sum
// values — seed-climate-anomalies.mjs subtracts precipMean from a mean of
// daily sums, so both sources must be (and are) mm/day.
const POWER_MONTHLY_URL = 'https://power.larc.nasa.gov/api/temporal/monthly/point';
// Honest declared bot UA — see the boundary-2 note in _open-meteo-archive.mjs.
const POWER_UA = 'the-synactic/2.10 (+https://github.com/clduab11/the-synactic)';
const POWER_TIMEOUT_MS = 60_000;
const POWER_MAX_RETRIES = 2;
const POWER_RETRY_BASE_MS = 3_000;
// Deliberate pacing between zones. POWER publishes no per-IP quota we are
// aware of, but 25 sequential requests should still be gentle on it.
const POWER_ZONE_DELAY_MS = 1_500;
const POWER_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

// POWER's documented sentinel for "no data" is fill_value: -999 (present in
// the response header). Letting one through would publish a -999 degrees C
// "normal" and poison every downstream anomaly delta, so it is dropped at
// parse time rather than averaged in.
const POWER_FILL_VALUE = -999;
const POWER_FILL_EPSILON = 1; // treat anything <= -998 as the fill sentinel

// Plausibility band. This is a garbage/sentinel guard, not a climatological
// claim: it exists so a fill value, a unit swap, or a malformed payload fails
// the zone loudly instead of being written as a baseline. The bounds are
// deliberately far outside any real 30-year monthly normal.
const MIN_PLAUSIBLE_TEMP_C = -90;
const MAX_PLAUSIBLE_TEMP_C = 60;
const MIN_PLAUSIBLE_PRECIP_MM_DAY = 0;
const MAX_PLAUSIBLE_PRECIP_MM_DAY = 500;

// A month's normal is published under the label `referencePeriod: '1991-2020'`,
// so it has to actually be a 1991-2020 normal. Sentinel-dropping removes
// month-years, and without a floor a single surviving year would be averaged to
// one number and shipped wearing a 30-year label — a silent lie that
// seed-climate-anomalies would then subtract from every observation.
// WMO practice for a standard normal is at least 80% of the period present;
// 24 of 30 years is that threshold. A month below it yields no value, which
// fails the zone's 12-month completeness gate, which routes the zone to the
// Open-Meteo fallback and records a reason instead of publishing the thin mean.
const MIN_YEARS_PER_MONTH_NORMAL = 24;

// Source attribution published with the payload.
export const CLIMATE_NORMALS_SOURCES = Object.freeze([
  Object.freeze({
    id: 'nasa-power',
    role: 'primary',
    name: 'NASA POWER (Prediction Of Worldwide Energy Resources)',
    dataset: 'MERRA-2 monthly, 1991-2020',
    url: 'https://power.larc.nasa.gov/',
    licence: 'Public domain (US Government work); no API key required',
  }),
  Object.freeze({
    id: 'open-meteo-archive',
    role: 'fallback',
    name: 'Open-Meteo ERA5 archive',
    dataset: 'ERA5 daily, 1991-01-01..2020-12-31',
    url: 'https://open-meteo.com/',
    licence: 'CC-BY-4.0 (Open-Meteo, ERA5/Copernicus)',
  }),
]);

function round(value, decimals = 2) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function isPlausibleNormal(tempMean, precipMean) {
  return Number.isFinite(tempMean)
    && Number.isFinite(precipMean)
    && tempMean >= MIN_PLAUSIBLE_TEMP_C
    && tempMean <= MAX_PLAUSIBLE_TEMP_C
    && precipMean >= MIN_PLAUSIBLE_PRECIP_MM_DAY
    && precipMean <= MAX_PLAUSIBLE_PRECIP_MM_DAY;
}

function isPowerFillValue(value) {
  return !Number.isFinite(value) || value <= POWER_FILL_VALUE + POWER_FILL_EPSILON;
}

/**
 * Reduce a NASA POWER `temporal/monthly/point` payload to 12 monthly normals.
 *
 * POWER keys each value as `YYYYMM`, and additionally emits `YYYY13` for the
 * ANNUAL aggregate — including it would drag a 13th pseudo-month into the set
 * and skew nothing visibly while quietly being wrong, so it is filtered by the
 * explicit 1..12 month check below.
 */
export function parsePowerMonthlyNormals(payload, opts = {}) {
  const { startYear = NORMALS_START_YEAR, endYear = NORMALS_END_YEAR } = opts;
  const parameter = payload?.properties?.parameter;
  const temps = parameter?.T2M;
  const precips = parameter?.PRECTOTCORR;
  if (!temps || !precips) return [];

  const byMonth = new Map();
  for (let month = 1; month <= 12; month++) {
    byMonth.set(month, { temps: [], precips: [] });
  }

  for (const key of Object.keys(temps)) {
    if (!/^\d{6}$/.test(key)) continue;
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(4, 6));
    if (!Number.isInteger(month) || month < 1 || month > 12) continue; // drops the YYYY13 annual row
    if (!Number.isInteger(year) || year < startYear || year > endYear) continue;

    const temp = Number(temps[key]);
    const precip = Number(precips[key]);
    // Sentinel / missing on EITHER parameter drops the whole month-year, so a
    // month's temp mean and precip mean always cover the same set of years.
    if (isPowerFillValue(temp) || isPowerFillValue(precip)) continue;
    if (precip < MIN_PLAUSIBLE_PRECIP_MM_DAY) continue;

    const bucket = byMonth.get(month);
    bucket.temps.push(temp);
    bucket.precips.push(precip);
  }

  return Array.from(byMonth.entries())
    .map(([month, bucket]) => {
      if (bucket.temps.length === 0 || bucket.precips.length === 0) return null;
      // Coverage floor, not just non-emptiness — see MIN_YEARS_PER_MONTH_NORMAL.
      // temps and precips are pushed together, so one length check covers both.
      if (bucket.temps.length < MIN_YEARS_PER_MONTH_NORMAL) return null;
      const tempMean = round(average(bucket.temps));
      const precipMean = round(average(bucket.precips));
      if (!isPlausibleNormal(tempMean, precipMean)) return null;
      return { month, tempMean, precipMean };
    })
    .filter((entry) => entry != null);
}

// Exported so the URL construction + retry/throw behavior can be exercised
// directly (both by tests and by a read-only live smoke) without running the
// full seeder, which needs Redis.
export async function fetchPowerZone(zone) {
  const params = new URLSearchParams({
    parameters: 'T2M,PRECTOTCORR',
    community: 'AG',
    longitude: String(zone.lon),
    latitude: String(zone.lat),
    start: String(NORMALS_START_YEAR),
    end: String(NORMALS_END_YEAR),
    format: 'JSON',
  });
  const url = `${POWER_MONTHLY_URL}?${params.toString()}`;

  let lastStatus = null;
  let lastTransportError = null;

  for (let attempt = 0; attempt <= POWER_MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': POWER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(POWER_TIMEOUT_MS),
      });
      if (resp.ok) return await resp.json();
      lastStatus = resp.status;
      // Non-retryable (4xx other than 429): stop immediately, no point burning
      // the budget on a request POWER will keep refusing.
      if (!POWER_RETRYABLE_STATUSES.has(resp.status)) break;
    } catch (err) {
      lastTransportError = err;
    }

    if (attempt < POWER_MAX_RETRIES) {
      await sleep(POWER_RETRY_BASE_MS * 2 ** attempt);
    }
  }

  const detail = lastStatus != null
    ? `last upstream status: HTTP ${lastStatus}`
    : `last upstream status: none (transport error: ${lastTransportError?.message ?? 'unknown'})`;
  const cause = lastTransportError ?? (lastStatus != null ? new Error(`HTTP ${lastStatus}`) : null);
  throw new Error(
    `NASA POWER retries exhausted for ${zone.name} — ${detail}`,
    cause ? { cause } : undefined,
  );
}

export function computeMonthlyNormals(daily) {
  const dailyBucketByYearMonth = new Map();
  for (let month = 1; month <= 12; month++) {
    dailyBucketByYearMonth.set(month, new Map());
  }

  const times = daily?.time ?? [];
  const temps = daily?.temperature_2m_mean ?? [];
  const precips = daily?.precipitation_sum ?? [];

  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    const temp = temps[i];
    const precip = precips[i];
    if (typeof time !== 'string' || temp == null || precip == null) continue;
    const year = Number(time.slice(0, 4));
    const month = Number(time.slice(5, 7));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const bucket = dailyBucketByYearMonth.get(month);
    const existing = bucket.get(key);
    if (existing) {
      existing.temps.push(Number(temp));
      existing.precips.push(Number(precip));
      continue;
    }
    bucket.set(key, {
      temps: [Number(temp)],
      precips: [Number(precip)],
    });
  }

  return Array.from(dailyBucketByYearMonth.entries())
    .map(([month, bucket]) => {
      const monthlyMeans = Array.from(bucket.values())
        .map((entry) => ({
          tempMean: average(entry.temps),
          precipMean: average(entry.precips),
        }))
        .filter((entry) => Number.isFinite(entry.tempMean) && Number.isFinite(entry.precipMean));

      if (monthlyMeans.length === 0) return null;

      return {
        month,
        tempMean: round(average(monthlyMeans.map((entry) => entry.tempMean))),
        precipMean: round(average(monthlyMeans.map((entry) => entry.precipMean))),
      };
    })
    .filter((entry) => entry != null && Number.isFinite(entry.tempMean) && Number.isFinite(entry.precipMean));
}

export function buildZoneNormalsFromBatch(zones, batchPayloads) {
  return zones.flatMap((zone, index) => {
    const data = batchPayloads[index];
    const months = computeMonthlyNormals(data?.daily);
    if (months.length !== 12) {
      console.warn(`  [CLIMATE_NORMALS] Open-Meteo normals incomplete for ${zone.name}: expected 12 months, got ${months.length}`);
      return [];
    }

    return [{
      zone: zone.name,
      location: { latitude: zone.lat, longitude: zone.lon },
      months,
    }];
  });
}

export async function fetchClimateZoneNormals({
  runStartedAtMs = Date.now(),
  _now = Date.now,
  _sleep = sleep,
  _fetchArchiveBatch = fetchOpenMeteoArchiveBatch,
} = {}) {
  const normals = [];
  // Honesty contract: every zone that fails records a concrete reason here and
  // the reasons are published with the payload. A failure is never swallowed
  // into a bare count.
  const failures = [];

  // ─── Primary: NASA POWER, one request per zone ───────────────────────────
  for (const zone of CLIMATE_ZONES) {
    try {
      const payload = await fetchPowerZone(zone);
      const months = parsePowerMonthlyNormals(payload);
      if (months.length !== 12) {
        throw new Error(`incomplete normals: expected 12 months, got ${months.length}`);
      }
      normals.push({
        zone: zone.name,
        location: { latitude: zone.lat, longitude: zone.lon },
        months,
        source: 'nasa-power',
      });
    } catch (err) {
      const reason = err?.message ?? String(err);
      console.warn(`  [CLIMATE_NORMALS] NASA POWER failed for ${zone.name}: ${reason}`);
      failures.push({ zone: zone.name, source: 'nasa-power', reason });
    }
    await sleep(POWER_ZONE_DELAY_MS);
  }

  // ─── Fallback: Open-Meteo ERA5 archive, ONLY for zones POWER could not
  // serve. This runs over the direct, honestly-identified path only — the
  // proxy cascade is gone (see _open-meteo-archive.mjs). Scoping it to the
  // missing zones also means the 30-years-of-daily request that exhausted the
  // quota in the first place now fires for a handful of zones at worst,
  // instead of all 25 on every run.
  const missingZones = CLIMATE_ZONES.filter(
    (zone) => !normals.some((entry) => entry.zone === zone.name),
  );

  // The fallback shares the run's soft fetch-phase deadline (upstream's
  // NORMALS_FETCH_PHASE_SOFT_DEADLINE_MS): once it is spent the remaining
  // batches are recorded as failures instead of pushing the run past the
  // seeder's wall-clock budget.
  const deadlineAtMs = runStartedAtMs + NORMALS_FETCH_PHASE_SOFT_DEADLINE_MS;
  let deadlineExhausted = false;

  if (missingZones.length > 0) {
    console.log(`  [CLIMATE_NORMALS] falling back to Open-Meteo for ${missingZones.length} zone(s): ${missingZones.map((z) => z.name).join(', ')}`);

    const batches = chunkItems(missingZones, NORMALS_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      if (deadlineExhausted || _now() >= deadlineAtMs) {
        deadlineExhausted = true;
        for (const zone of batch) {
          failures.push({ zone: zone.name, source: 'open-meteo-archive', reason: 'fetch-phase deadline exhausted before this batch' });
        }
        continue;
      }
      try {
        const payloads = await _fetchArchiveBatch(batch, {
          startDate: NORMALS_START,
          endDate: NORMALS_END,
          daily: ['temperature_2m_mean', 'precipitation_sum'],
          timeoutMs: 30_000,
          maxRetries: 4,
          retryBaseMs: 5_000,
          deadlineAtMs,
          _now,
          _sleep,
          label: `normals batch (${batch.map((zone) => zone.name).join(', ')})`,
        });
        for (const entry of buildZoneNormalsFromBatch(batch, payloads)) {
          normals.push({ ...entry, source: 'open-meteo-archive' });
        }
      } catch (err) {
        const reason = err?.message ?? String(err);
        console.log(`  [CLIMATE_NORMALS] ${reason}`);
        if (err?.code === OPEN_METEO_DEADLINE_CODE) deadlineExhausted = true;
        for (const zone of batch) {
          failures.push({ zone: zone.name, source: 'open-meteo-archive', reason });
        }
      }
      if (batchIndex < batches.length - 1) {
        const remainingMs = deadlineAtMs - _now();
        if (remainingMs <= 0) { deadlineExhausted = true; continue; }
        await _sleep(Math.min(NORMALS_BATCH_DELAY_MS, remainingMs));
      }
    }
  }

  const stillMissing = CLIMATE_ZONES
    .map((zone) => zone.name)
    .filter((name) => !normals.some((entry) => entry.zone === name));

  if (normals.length < MIN_CLIMATE_ZONE_COUNT) {
    throw createNormalsFailure(
      `Only ${normals.length}/${CLIMATE_ZONES.length} zones returned normals (${failures.length} errors; missing: ${stillMissing.join(', ') || 'none'})`,
      deadlineExhausted,
    );
  }
  if (!hasRequiredClimateZones(normals, (zone) => zone.zone)) {
    throw createNormalsFailure('Missing one or more required climate-specific zone normals', deadlineExhausted);
  }

  return {
    referencePeriod: '1991-2020',
    fetchedAt: _now(),
    sources: CLIMATE_NORMALS_SOURCES,
    failures,
    normals,
  };
}

function validate(data) {
  return Array.isArray(data?.normals)
    && data.normals.length >= MIN_CLIMATE_ZONE_COUNT
    && hasRequiredClimateZones(data.normals, (zone) => zone.zone)
    && data.normals.every((zone) => Array.isArray(zone?.months) && zone.months.length === 12);
}

// Contract opt-in: records = number of climate zones with 1991-2020 normals.
// Custom shape `{referencePeriod, fetchedAt, normals[]}` — computeRecordCount
// auto-detect historically missed this, causing the phantom EMPTY_DATA symptom
// documented in the plan's discrepancy class 1.
export function declareRecords(data) {
  return Array.isArray(data?.normals) ? data.normals.length : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runSeed('climate', 'zone-normals', CLIMATE_ZONE_NORMALS_KEY, fetchClimateZoneNormals, {
    validateFn: validate,
    ttlSeconds: NORMALS_TTL,
    // Bumped with the re-source: the baseline now comes from NASA POWER
    // (MERRA-2 monthly) rather than the Open-Meteo ERA5 daily archive. Same
    // WMO 1991-2020 window, different provider — consumers reading seed-meta
    // must be able to see that the underlying source changed.
    sourceVersion: 'nasa-power-monthly-wmo-1991-2020-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 89280, // matches api/health.js SEED_META (monthly cron on 1st; 62d window)
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
