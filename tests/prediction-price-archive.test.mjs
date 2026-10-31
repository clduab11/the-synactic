import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { __testing__ as health } from '../api/health.js';

import {
  ARCHIVE_SCHEMA_VERSION,
  ARCHIVE_WINDOW_MS,
  MAX_COVERAGE_WINDOWS,
  PRICE_ARCHIVE_ACTIVATION_KEY,
  PRICE_ARCHIVE_COVERAGE_KEY,
  archiveObjectKey,
  archiveWindowStart,
  buildArchiveObject,
  detectCoverageGaps,
  parseGammaArchiveRows,
  parseKalshiArchiveRows,
  updateCoverage,
} from '../scripts/_prediction-price-archive.mjs';
import {
  runArchiveCycle,
  storeArchiveObjectToFs,
} from '../scripts/seed-prediction-price-archive.mjs';

// Field shapes below mirror live API probes of 2026-08-28 (Kalshi
// trade-api/v2 events?with_nested_markets, Polymarket Gamma /events):
// Kalshi publishes every numeric as a decimal STRING (*_dollars 0-1 prices,
// *_fp fixed-point counts); Gamma mixes numbers (bestBid/bestAsk/volumeNum,
// nullable) with JSON-ENCODED-STRING arrays (outcomes/outcomePrices).
const OBSERVED_AT = Date.UTC(2026, 7, 28, 4, 7, 11);
const INGESTED_AT = OBSERVED_AT + 1_500;
const META = { observedAt: OBSERVED_AT, ingestedAt: INGESTED_AT };

function kalshiEvent(overrides = {}) {
  return {
    event_ticker: 'KXEXAMPLE',
    title: 'Example geopolitical event?',
    markets: [
      {
        ticker: 'KXEXAMPLE-26DEC31',
        event_ticker: 'KXEXAMPLE',
        market_type: 'binary',
        status: 'active',
        title: 'Example geopolitical event?',
        yes_sub_title: 'Yes side',
        yes_bid_dollars: '0.1100',
        yes_ask_dollars: '0.1200',
        last_price_dollars: '0.1200',
        volume_fp: '117840.87',
        volume_24h_fp: '512.00',
        open_interest_fp: '40174.04',
        yes_bid_size_fp: '99.25',
        yes_ask_size_fp: '280.39',
        close_time: '2026-12-31T23:59:00Z',
      },
    ],
    ...overrides,
  };
}

function gammaEvent(overrides = {}) {
  return {
    id: '99001',
    slug: 'example-event',
    title: 'Example event',
    markets: [
      {
        id: '521028',
        conditionId: '0x69eecc28',
        slug: 'china-x-india-military-clash',
        question: 'China x India military clash by June 30?',
        outcomes: '["Yes", "No"]',
        outcomePrices: '["0.03", "0.97"]',
        bestBid: 0.02,
        bestAsk: 0.04,
        lastTradePrice: 0.03,
        volumeNum: 37693.17,
        endDate: '2026-07-01T03:59:00Z',
        closed: false,
        active: true,
      },
    ],
    ...overrides,
  };
}

describe('parseKalshiArchiveRows', () => {
  it('extracts every field the archive contract names, venue-native units', () => {
    const rows = parseKalshiArchiveRows({ events: [kalshiEvent()] }, META);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.venue, 'kalshi');
    assert.equal(row.marketId, 'KXEXAMPLE-26DEC31');
    assert.equal(row.eventId, 'KXEXAMPLE');
    assert.equal(row.yesBid, 0.11);
    assert.equal(row.yesAsk, 0.12);
    assert.equal(row.last, 0.12);
    assert.equal(row.volume, 117840.87);
    assert.equal(row.volume24h, 512);
    assert.equal(row.openInterest, 40174.04);
    assert.equal(row.closeTime, '2026-12-31T23:59:00Z');
    assert.equal(row.status, 'active');
    assert.equal(row.marketType, 'binary');
    assert.equal(row.observedAt, OBSERVED_AT);
    assert.equal(row.ingestedAt, INGESTED_AT);
  });

  it('archives the unclipped universe: extreme prices and zero volume survive', () => {
    const event = kalshiEvent();
    event.markets[0].yes_bid_dollars = '0.9800';
    event.markets[0].yes_ask_dollars = '0.9900';
    event.markets[0].last_price_dollars = '0.9900';
    event.markets[0].volume_fp = '0.00';
    const rows = parseKalshiArchiveRows({ events: [event] }, META);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].last, 0.99);
    assert.equal(rows[0].volume, 0);
  });

  it('archives non-binary and non-active markets rather than dropping them', () => {
    const event = kalshiEvent();
    event.markets[0].market_type = 'scalar';
    event.markets[0].status = 'closed';
    const rows = parseKalshiArchiveRows({ events: [event] }, META);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].marketType, 'scalar');
    assert.equal(rows[0].status, 'closed');
  });

  it('maps unreadable numerics to null, never 0 and never a default', () => {
    const event = kalshiEvent();
    event.markets[0].yes_bid_dollars = '';
    event.markets[0].yes_ask_dollars = '0.12oops';
    event.markets[0].last_price_dollars = undefined;
    event.markets[0].open_interest_fp = 'n/a';
    const [row] = parseKalshiArchiveRows({ events: [event] }, META);
    assert.equal(row.yesBid, null);
    assert.equal(row.yesAsk, null);
    assert.equal(row.last, null);
    assert.equal(row.openInterest, null);
    // volume was left valid and must still parse
    assert.equal(row.volume, 117840.87);
  });

  it('skips markets with no ticker (unaddressable rows cannot be archived honestly)', () => {
    const event = kalshiEvent();
    delete event.markets[0].ticker;
    assert.equal(parseKalshiArchiveRows({ events: [event] }, META).length, 0);
  });

  it('returns [] for a malformed payload instead of throwing', () => {
    assert.deepEqual(parseKalshiArchiveRows(null, META), []);
    assert.deepEqual(parseKalshiArchiveRows({ events: 'nope' }, META), []);
  });
});

describe('parseGammaArchiveRows', () => {
  it('extracts fields, unwrapping the JSON-encoded-string arrays', () => {
    const rows = parseGammaArchiveRows([gammaEvent()], META);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.venue, 'polymarket');
    assert.equal(row.marketId, '521028');
    assert.equal(row.slug, 'china-x-india-military-clash');
    assert.equal(row.eventId, 'example-event');
    assert.equal(row.yesBid, 0.02);
    assert.equal(row.yesAsk, 0.04);
    assert.equal(row.last, 0.03);
    assert.equal(row.markYes, 0.03); // outcomePrices Yes entry
    assert.equal(row.volume, 37693.17);
    assert.equal(row.openInterest, null); // Gamma exposes no OI — null, never fabricated
    assert.equal(row.closeTime, '2026-07-01T03:59:00Z');
  });

  it('keeps a non-binary market row with markYes null when no Yes outcome exists', () => {
    const event = gammaEvent();
    event.markets[0].outcomes = '["Alice", "Bob", "Carol"]';
    event.markets[0].outcomePrices = '["0.2", "0.3", "0.5"]';
    const [row] = parseGammaArchiveRows([event], META);
    assert.equal(row.markYes, null);
    assert.equal(row.yesBid, 0.02); // venue quote fields still archived
  });

  it('null bestBid stays null; malformed outcomePrices yields null markYes', () => {
    const event = gammaEvent();
    event.markets[0].bestBid = null;
    event.markets[0].outcomePrices = '[not json';
    const [row] = parseGammaArchiveRows([event], META);
    assert.equal(row.yesBid, null);
    assert.equal(row.markYes, null);
  });

  it('skips markets with no id and tolerates malformed payloads', () => {
    const event = gammaEvent();
    delete event.markets[0].id;
    delete event.markets[0].conditionId;
    assert.equal(parseGammaArchiveRows([event], META).length, 0);
    assert.deepEqual(parseGammaArchiveRows('nope', META), []);
  });
});

describe('window and object keys', () => {
  it('floors observation time to a 30-minute window', () => {
    const start = archiveWindowStart(OBSERVED_AT);
    assert.equal(start % ARCHIVE_WINDOW_MS, 0);
    assert.ok(start <= OBSERVED_AT && OBSERVED_AT < start + ARCHIVE_WINDOW_MS);
  });

  it('is deterministic per (venue, window): a re-run upserts instead of duplicating', () => {
    const a = archiveObjectKey('kalshi', archiveWindowStart(OBSERVED_AT));
    const b = archiveObjectKey('kalshi', archiveWindowStart(OBSERVED_AT + 60_000));
    assert.equal(a, b);
    const nextWindow = archiveObjectKey('kalshi', archiveWindowStart(OBSERVED_AT + ARCHIVE_WINDOW_MS));
    assert.notEqual(a, nextWindow);
  });

  it('partitions by UTC date and venue under the versioned prefix', () => {
    const key = archiveObjectKey('polymarket', Date.UTC(2026, 7, 28, 4, 0, 0));
    assert.equal(key, 'seed-data/prediction-price-archive/v1/polymarket/2026/08/28/0400.json.gz');
  });
});

describe('buildArchiveObject', () => {
  it('retains the raw payloads verbatim next to parsed rows, with both timestamps', () => {
    const raw = [{ events: [kalshiEvent()] }];
    const rows = parseKalshiArchiveRows(raw[0], META);
    const obj = buildArchiveObject({
      venue: 'kalshi',
      windowStart: archiveWindowStart(OBSERVED_AT),
      observedAt: OBSERVED_AT,
      ingestedAt: INGESTED_AT,
      requestSpec: { endpoint: 'events', params: { status: 'open' } },
      rawPayloads: raw,
      rows,
    });
    assert.equal(obj.schemaVersion, ARCHIVE_SCHEMA_VERSION);
    assert.equal(obj.rowCount, 1);
    assert.deepEqual(obj.raw, raw);
    assert.equal(obj.observedAt, OBSERVED_AT);
    assert.equal(obj.ingestedAt, INGESTED_AT);
    assert.deepEqual(obj.requestSpec.params, { status: 'open' });
  });

  it('an empty venue response is archived, not dropped — absence is data (survivorship)', () => {
    const obj = buildArchiveObject({
      venue: 'kalshi',
      windowStart: archiveWindowStart(OBSERVED_AT),
      observedAt: OBSERVED_AT,
      ingestedAt: INGESTED_AT,
      requestSpec: {},
      rawPayloads: [{ events: [] }],
      rows: [],
    });
    assert.equal(obj.rowCount, 0);
    assert.equal(obj.suspectEmpty, true);
  });
});

describe('coverage index', () => {
  const window0 = archiveWindowStart(OBSERVED_AT);

  it('upserts per (venue, window) — a re-run replaces, never duplicates', () => {
    const first = updateCoverage(null, [
      { venue: 'kalshi', windowStart: window0, objectKey: 'k', rowCount: 5 },
    ], OBSERVED_AT);
    const second = updateCoverage(first, [
      { venue: 'kalshi', windowStart: window0, objectKey: 'k', rowCount: 7 },
    ], OBSERVED_AT + 1000);
    assert.equal(second.windows.length, 1);
    assert.equal(second.windows[0].rowCount, 7);
    assert.equal(second.updatedAt, OBSERVED_AT + 1000);
  });

  it('caps retained windows at MAX_COVERAGE_WINDOWS keeping the newest', () => {
    let coverage = null;
    for (let i = 0; i < MAX_COVERAGE_WINDOWS + 10; i += 1) {
      coverage = updateCoverage(coverage, [
        { venue: 'kalshi', windowStart: window0 + i * ARCHIVE_WINDOW_MS, objectKey: `k${i}`, rowCount: 1 },
      ], OBSERVED_AT);
    }
    assert.equal(coverage.windows.length, MAX_COVERAGE_WINDOWS);
    assert.equal(
      coverage.windows.at(-1).windowStart,
      window0 + (MAX_COVERAGE_WINDOWS + 9) * ARCHIVE_WINDOW_MS,
    );
  });

  it('rebuilds from a malformed prior value rather than throwing or trusting it', () => {
    const coverage = updateCoverage({ windows: 'garbage' }, [
      { venue: 'kalshi', windowStart: window0, objectKey: 'k', rowCount: 1 },
    ], OBSERVED_AT);
    assert.equal(coverage.windows.length, 1);
    assert.equal(coverage.rebuilt, true);
  });

  it('detectCoverageGaps names every missing window in the asked range — the backtest refusal input', () => {
    const coverage = updateCoverage(null, [
      { venue: 'kalshi', windowStart: window0, objectKey: 'a', rowCount: 1 },
      { venue: 'kalshi', windowStart: window0 + 2 * ARCHIVE_WINDOW_MS, objectKey: 'c', rowCount: 1 },
    ], OBSERVED_AT);
    const gaps = detectCoverageGaps(coverage, 'kalshi', window0, window0 + 3 * ARCHIVE_WINDOW_MS);
    assert.deepEqual(gaps, [window0 + ARCHIVE_WINDOW_MS]);
    // A venue with no coverage at all is ALL gaps, not zero gaps.
    const none = detectCoverageGaps(coverage, 'polymarket', window0, window0 + ARCHIVE_WINDOW_MS);
    assert.equal(none.length, 1);
  });
});

describe('runArchiveCycle (injected I/O)', () => {
  const kalshiPayload = { events: [kalshiEvent()] };
  const gammaPayload = [gammaEvent()];

  function makeDeps(overrides = {}) {
    const stored = [];
    const redisWrites = [];
    const markerSets = { count: 0 };
    return {
      stored,
      redisWrites,
      markerSets,
      deps: {
        fetchKalshi: async () => ({ payloads: [kalshiPayload], observedAt: OBSERVED_AT }),
        fetchGamma: async () => ({ payloads: [gammaPayload], observedAt: OBSERVED_AT }),
        storeObject: async (key, object) => { stored.push({ key, object }); },
        readCoverage: async () => null,
        writeRedisJson: async (key, value) => { redisWrites.push({ key, value }); },
        setActivationMarker: async () => { markerSets.count += 1; },
        now: () => INGESTED_AT,
        ...overrides,
      },
    };
  }

  it('dedupes parsed rows by (venue, marketId) — overlapping tag payloads collapse; raw keeps both', async () => {
    const { stored, deps } = makeDeps({
      // The same gamma event arrives via two tag payloads (tags overlap
      // heavily in production: 33 tags produced 14.5k rows for far fewer
      // unique markets on the first live run).
      fetchGamma: async () => ({ payloads: [gammaPayload, gammaPayload], observedAt: OBSERVED_AT }),
    });
    const result = await runArchiveCycle(deps);
    const gammaObject = stored.find((s) => s.object.venue === 'polymarket').object;
    assert.equal(gammaObject.rowCount, 1);
    assert.equal(gammaObject.raw.length, 2); // raw payloads stay verbatim
    assert.equal(result.exitCode, 0);
  });

  it('happy path: one object per venue, coverage and seed-meta written, exit 0', async () => {
    const { stored, redisWrites, deps } = makeDeps();
    const result = await runArchiveCycle(deps);
    assert.equal(result.exitCode, 0);
    assert.equal(stored.length, 2);
    const venues = stored.map((s) => s.object.venue).sort();
    assert.deepEqual(venues, ['kalshi', 'polymarket']);
    assert.equal(result.rowCount, 2);
    const coverageWrite = redisWrites.find((w) => w.key === PRICE_ARCHIVE_COVERAGE_KEY);
    assert.ok(coverageWrite, 'coverage index must be written');
    assert.equal(coverageWrite.value.windows.length, 2);
  });

  it('one venue failing still archives the other and reports degraded (75)', async () => {
    const { stored, deps } = makeDeps({
      fetchGamma: async () => { throw new Error('gamma down'); },
    });
    const result = await runArchiveCycle(deps);
    assert.equal(result.exitCode, 75);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].object.venue, 'kalshi');
    assert.match(result.failures.join(' '), /gamma down/);
  });

  it('both venues failing is fatal — nothing was preserved', async () => {
    const { stored, deps } = makeDeps({
      fetchKalshi: async () => { throw new Error('kalshi down'); },
      fetchGamma: async () => { throw new Error('gamma down'); },
    });
    const result = await runArchiveCycle(deps);
    assert.equal(result.exitCode, 1);
    assert.equal(stored.length, 0);
  });

  it('a storage-sink failure is fatal, never a silent skip — durability IS the job', async () => {
    const { deps } = makeDeps({
      storeObject: async () => { throw new Error('sink unavailable'); },
    });
    const result = await runArchiveCycle(deps);
    assert.equal(result.exitCode, 1);
    assert.match(result.failures.join(' '), /sink unavailable/);
  });

  it('coverage/seed-meta write failures degrade (75) but do not undo archived objects', async () => {
    const { stored, deps } = makeDeps({
      writeRedisJson: async () => { throw new Error('redis blip'); },
    });
    const result = await runArchiveCycle(deps);
    assert.equal(stored.length, 2);
    assert.equal(result.exitCode, 75);
  });

  it('SETs the durable activation marker once, only after a cycle that archived a window and wrote its companions', async () => {
    const ok = makeDeps();
    assert.equal((await runArchiveCycle(ok.deps)).exitCode, 0);
    assert.equal(ok.markerSets.count, 1, 'a healthy cycle activates the probe');

    const blip = makeDeps({ writeRedisJson: async () => { throw new Error('redis blip'); } });
    await runArchiveCycle(blip.deps);
    assert.equal(blip.markerSets.count, 0, 'companions did not land, so health must not go strict yet');

    const sink = makeDeps({ storeObject: async () => { throw new Error('sink unavailable'); } });
    await runArchiveCycle(sink.deps);
    assert.equal(sink.markerSets.count, 0, 'nothing was archived, so nothing was activated');

    const markerDown = makeDeps({ setActivationMarker: async () => { throw new Error('marker SET failed'); } });
    const degraded = await runArchiveCycle(markerDown.deps);
    assert.equal(degraded.exitCode, 75, 'a failed marker write degrades the cycle; the next cycle retries it');
    assert.match(degraded.failures.join(' '), /activation marker/);
  });
});

describe('health probe registration', () => {
  it('declares the activation-marker cutover and binds it to the key the archiver SETs', () => {
    assert.equal(PRICE_ARCHIVE_ACTIVATION_KEY, 'seed-activated:prediction:price-archive');
    assert.deepEqual(health.SEED_META.predictionPriceArchive, {
      key: 'seed-meta:prediction:price-archive',
      maxStaleMin: 180,
      activationKey: PRICE_ARCHIVE_ACTIVATION_KEY,
      cutover: {
        mode: 'activation-marker',
        fromKey: null,
        issue: 1,
        activationKey: PRICE_ARCHIVE_ACTIVATION_KEY,
      },
    });
    // The validator's three wiring conditions, so a refactor cannot drop one silently.
    assert.equal(health.ON_DEMAND_KEYS.has('predictionPriceArchive'), true);
    assert.equal(health.STANDALONE_KEYS.predictionPriceArchive, 'prediction:price-archive:coverage:v1');
    assert.equal(health.ACTIVATION_MARKERS.predictionPriceArchive, PRICE_ARCHIVE_ACTIVATION_KEY);
  });
});

describe('storeArchiveObjectToFs', () => {
  it('writes the object gzipped under the key path atomically and round-trips', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-price-archive-'));
    try {
      const key = archiveObjectKey('kalshi', archiveWindowStart(OBSERVED_AT));
      await storeArchiveObjectToFs(dir, key, { hello: 'world' });
      const written = JSON.parse(gunzipSync(readFileSync(join(dir, key))).toString('utf8'));
      assert.deepEqual(written, { hello: 'world' });
      // Same key again overwrites (the upsert contract), no duplicate files.
      await storeArchiveObjectToFs(dir, key, { hello: 'again' });
      assert.equal(JSON.parse(gunzipSync(readFileSync(join(dir, key))).toString('utf8')).hello, 'again');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
