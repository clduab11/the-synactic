// Locks the NASA POWER re-source of seed-climate-zone-normals.mjs.
//
// Background: the seeder used to ask Open-Meteo's ERA5 archive for 30 YEARS of
// DAILY data per zone, which exhausted Open-Meteo's per-IP free-tier quota; the
// previous "fix" routed around that quota through a Decodo proxy cascade, which
// CONTEXT.md boundary 2 v9 forbids. The sanctioned remedy is re-sourcing, so
// the 1991-2020 normals now come from NASA POWER (public domain, no key).
//
// Two facts verified by live probe on 2026-08-03 and pinned here:
//   - POWER's `temporal/climatology` endpoint is a 2001-2020 window, NOT the
//     WMO 1991-2020 baseline this dataset is defined against. The seeder must
//     therefore use `temporal/monthly` with start=1991&end=2020.
//   - `temporal/monthly` returns 390 T2M keys for that range = 30 years x 13,
//     because POWER emits a `YYYY13` ANNUAL aggregate alongside the 12 months.
//
// No network here — the POWER payloads are fixtures shaped from the probe.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

const SEEDER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/seed-climate-zone-normals.mjs');

const { parsePowerMonthlyNormals, CLIMATE_NORMALS_SOURCES } =
  await import('../scripts/seed-climate-zone-normals.mjs');

/**
 * Reduce a source file to executable CODE for token scanning.
 *
 * The forbidden tokens are also named in the seeder's explanatory comments
 * (which exist precisely to record what was removed and why), so scanning raw
 * source would fire on prose. Strip block comments and FULL-LINE `//` comments
 * only — deliberately NOT trailing `//`, because a naive strip-from-`//` also
 * truncates string literals at `https://`, which would blind the scan to the
 * kind of proxy hostname it exists to catch.
 *
 * CRLF working tree: normalize line endings FIRST or the line split and every
 * regex below can match nothing and pass vacuously.
 */
function codeOnly(path) {
  return readFileSync(path, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/**
 * Build a POWER `temporal/monthly/point` payload.
 * `perMonth` maps calendar month -> value used for every year in the range.
 */
function powerPayload({ startYear = 1991, endYear = 2020, temp = () => 10, precip = () => 2, withAnnual = true } = {}) {
  const T2M = {};
  const PRECTOTCORR = {};
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const key = `${year}${String(month).padStart(2, '0')}`;
      T2M[key] = temp(year, month);
      PRECTOTCORR[key] = precip(year, month);
    }
    if (withAnnual) {
      // POWER's annual aggregate row. Deliberately absurd so that leaking it
      // into a monthly bucket would be unmissable.
      T2M[`${year}13`] = 999;
      PRECTOTCORR[`${year}13`] = 999;
    }
  }
  return { properties: { parameter: { T2M, PRECTOTCORR } } };
}

test('parses 12 monthly normals from a POWER monthly payload', () => {
  const months = parsePowerMonthlyNormals(powerPayload({
    temp: (_y, m) => m,          // month N -> N degrees C, every year
    precip: (_y, m) => m / 10,
  }));

  assert.equal(months.length, 12);
  assert.deepEqual(months.map((m) => m.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(months[0].tempMean, 1);
  assert.equal(months[11].tempMean, 12);
  assert.equal(months[11].precipMean, 1.2);
});

test('drops the YYYY13 ANNUAL aggregate instead of treating it as a 13th month', () => {
  const months = parsePowerMonthlyNormals(powerPayload({ temp: () => 5, precip: () => 1 }));

  assert.equal(months.length, 12, 'the annual row must not become a 13th entry');
  assert.equal(months.some((m) => m.month === 13), false);
  // 999 was the annual sentinel — if it leaked into any bucket the mean moves.
  for (const m of months) {
    assert.equal(m.tempMean, 5, `month ${m.month} mean was contaminated by the annual row`);
  }
});

test('drops POWER fill values (-999) instead of averaging them into the baseline', () => {
  // January 1991 is missing on both parameters; every other value is 20 C.
  const payload = powerPayload({ temp: () => 20, precip: () => 3 });
  payload.properties.parameter.T2M['199101'] = -999;
  payload.properties.parameter.PRECTOTCORR['199101'] = -999;

  const months = parsePowerMonthlyNormals(payload);
  const january = months.find((m) => m.month === 1);

  assert.ok(january, 'January still has 29 good years, so it must survive');
  assert.equal(january.tempMean, 20, 'a -999 fill value must not drag the normal down');
  assert.equal(january.precipMean, 3);
});

test('a fill value on ONE parameter drops that month-year from BOTH series', () => {
  // Temperature is fine in 1991-01 but precipitation is missing. Keeping the
  // temperature would leave tempMean and precipMean covering different year
  // sets for the same month.
  const payload = powerPayload({ temp: (y, m) => (y === 1991 && m === 1 ? 100 : 20), precip: () => 3 });
  payload.properties.parameter.PRECTOTCORR['199101'] = -999;

  const january = parsePowerMonthlyNormals(payload).find((m) => m.month === 1);
  assert.equal(january.tempMean, 20, 'the 100 C reading must be dropped along with its missing precip');
});

test('restricts to the 1991-2020 window even when POWER returns more years', () => {
  const payload = powerPayload({
    startYear: 1985,
    endYear: 2025,
    // Anything outside 1991-2020 is 100 C; inside it is 0 C.
    temp: (y) => (y >= 1991 && y <= 2020 ? 0 : 100),
    precip: () => 1,
  });

  const months = parsePowerMonthlyNormals(payload);
  assert.equal(months.length, 12);
  for (const m of months) {
    assert.equal(m.tempMean, 0, `month ${m.month} pulled in out-of-window years`);
  }
});

test('rejects implausible values rather than publishing them as a normal', () => {
  // A unit swap (Kelvin instead of Celsius) is the realistic failure this
  // guards: 283 K would silently become a "283 C" normal.
  const months = parsePowerMonthlyNormals(powerPayload({ temp: () => 283, precip: () => 1 }));
  assert.equal(months.length, 0, 'out-of-band temperatures must not survive parsing');
});

test('missing / malformed payloads yield no months rather than throwing', () => {
  assert.deepEqual(parsePowerMonthlyNormals(undefined), []);
  assert.deepEqual(parsePowerMonthlyNormals({}), []);
  assert.deepEqual(parsePowerMonthlyNormals({ properties: { parameter: { T2M: {} } } }), []);
});

test('NASA POWER is attributed as the primary source, Open-Meteo as fallback', () => {
  const byId = new Map(CLIMATE_NORMALS_SOURCES.map((s) => [s.id, s]));

  assert.equal(byId.get('nasa-power')?.role, 'primary');
  assert.match(byId.get('nasa-power')?.name ?? '', /NASA POWER/);
  assert.match(byId.get('nasa-power')?.licence ?? '', /[Pp]ublic domain/);
  assert.equal(byId.get('open-meteo-archive')?.role, 'fallback');
});

test('seeder CODE: POWER monthly endpoint with the WMO window, no climatology shortcut, no proxy', () => {
  const src = codeOnly(SEEDER_PATH);

  // Positive controls first — an empty read, a bad path, or an over-aggressive
  // comment strip would make every doesNotMatch below trivially true.
  assert.ok(src.length > 1000, 'seeder source failed to load — negative assertions would be vacuous');
  assert.match(src, /power\.larc\.nasa\.gov\/api\/temporal\/monthly\/point/,
    'must call the POWER monthly endpoint');
  assert.match(src, /start:\s*String\(NORMALS_START_YEAR\)/);
  assert.match(src, /NORMALS_START_YEAR\s*=\s*1991/);
  assert.match(src, /NORMALS_END_YEAR\s*=\s*2020/);
  assert.match(src, /referencePeriod:\s*'1991-2020'/,
    'the published reference period must stay the WMO 1991-2020 baseline');

  assert.doesNotMatch(src, /temporal\/climatology/,
    'the climatology endpoint is a 2001-2020 window — using it would silently shift the baseline');
  assert.doesNotMatch(src, /decodo/i);
  assert.doesNotMatch(src, /resolveProxy|httpsProxyFetchRaw|curlFetch|_PROXY_DEFAULTS/);
  assert.doesNotMatch(src, /CHROME_UA/);
});
