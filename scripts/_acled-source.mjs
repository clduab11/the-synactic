#!/usr/bin/env node
/**
 * ACLED source adapter — fixture-first by design.
 *
 * LICENSING POSTURE, ENCODED IN CODE (see CONTEXT.md):
 * Praxen does not yet hold an ACLED corporate licence. Development runs
 * against a captured fixture; live calls are opt-in and hard-bounded so an
 * integration test cannot quietly become a historical backfill.
 *
 *   ACLED_MODE=fixture   (DEFAULT) read the captured fixture, zero API traffic
 *   ACLED_MODE=live      hit the API, bounded by ACLED_MAX_RECORDS
 *
 * ACLED_MAX_RECORDS defaults to 200 and is capped at ACLED's own 5000-row
 * per-request limit. Unbounded pulls are refused, not silently allowed.
 *
 * Remove the bound only when a corporate licence is in hand — and change it
 * here, in one place, deliberately.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acledAuthHeaders } from './_acled-auth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = resolve(ROOT, 'tests/fixtures/oracle/acled/acled-events.sample.json');
const API_BASE = 'https://acleddata.com/api';

const HARD_CAP = 5000;        // ACLED's documented per-request row limit
const DEFAULT_LIMIT = 200;    // deliberately small: proves the wire, builds no corpus

export const ACLED_MODE = (process.env.ACLED_MODE ?? 'fixture').toLowerCase();

function resolveLimit() {
  const raw = process.env.ACLED_MAX_RECORDS;
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`ACLED_MAX_RECORDS must be a positive integer; got ${JSON.stringify(raw)}`);
  }
  if (n > HARD_CAP) {
    throw new Error(
      `ACLED_MAX_RECORDS=${n} exceeds the ${HARD_CAP}-row per-request limit. ` +
        'Paginating into a bulk backfill is out of scope pre-licence — see CONTEXT.md.',
    );
  }
  return n;
}

function loadFixture() {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `No ACLED fixture at ${FIXTURE_PATH}. Capture one first:\n` +
        '  ACLED_USERNAME=… ACLED_PASSWORD=… node scripts/capture-acled-fixture.mjs',
    );
  }
  const doc = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  return { ...doc, _mode: 'fixture' };
}

async function fetchLive({ country, limit, since }) {
  const params = new URLSearchParams({ _format: 'json', limit: String(limit) });
  if (country) params.set('country', country);
  if (since) params.set('event_date', since), params.set('event_date_where', '>=');

  const url = `${API_BASE}/acled/read?${params.toString()}`;
  // fetch.bind(globalThis) is BANNED in this repo (AGENTS.md).
  const res = await ((...a) => globalThis.fetch(...a))(url, { headers: await acledAuthHeaders() });

  if (!res.ok) {
    throw new Error(`ACLED read failed: HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const records = Array.isArray(json?.data) ? json.data : [];

  if (records.length > limit) {
    // Defensive: never let a server-side default exceed our own bound.
    records.length = limit;
  }

  return {
    _mode: 'live',
    _capturedAt: new Date().toISOString(),
    _request: { country: country ?? null, limit, since: since ?? null },
    count: records.length,
    data: records,
  };
}

/**
 * Fetch ACLED events. Fixture-backed unless ACLED_MODE=live.
 * @param {{country?: string, limit?: number, since?: string}} [opts]
 */
export async function getAcledEvents(opts = {}) {
  if (ACLED_MODE === 'fixture') return loadFixture();
  if (ACLED_MODE !== 'live') {
    throw new Error(`ACLED_MODE must be "fixture" or "live"; got ${JSON.stringify(ACLED_MODE)}`);
  }
  const limit = opts.limit ?? resolveLimit();
  if (limit > HARD_CAP) throw new Error(`limit ${limit} exceeds hard cap ${HARD_CAP}`);
  return fetchLive({ ...opts, limit });
}

export { FIXTURE_PATH as ACLED_FIXTURE_PATH, HARD_CAP as ACLED_HARD_CAP, DEFAULT_LIMIT as ACLED_DEFAULT_LIMIT };
