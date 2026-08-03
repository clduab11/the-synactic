import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ReliefWeb was removed 2026-08-03 (owner decision). The two tests that covered
// its request-body filter and appname resolution went with it, along with the
// afterEach that saved/restored RELIEFWEB_APPNAME — nothing else in this file
// touches process.env.
import {
  collectDisasterSourceResults,
  findCountryCodeByCoordinates,
  isClimateNaturalEvent,
  mapNaturalEvent,
  toRedisDisaster,
} from '../scripts/seed-climate-disasters.mjs';

describe('seed-climate-disasters helpers', () => {
  it('accepts climate events from known sources and rejects unrecognized ones', () => {
    assert.equal(isClimateNaturalEvent({ category: 'floods', sourceName: 'GDACS', id: 'gdacs-FL-123' }), true);
    assert.equal(isClimateNaturalEvent({ category: 'wildfires', sourceName: 'NASA FIRMS', id: 'EONET_1' }), true);
    assert.equal(isClimateNaturalEvent({ category: 'wildfires', sourceName: 'Volcanic Ash Advisory', id: 'EONET_2' }), true);
    assert.equal(isClimateNaturalEvent({ category: 'volcanoes', sourceName: '', id: 'EONET_3' }), true);
    assert.equal(isClimateNaturalEvent({ category: 'severeStorms', sourceName: 'NHC', stormName: 'Alfred', id: 'nhc-AL01-1' }), false);
    assert.equal(isClimateNaturalEvent({ category: 'floods', sourceName: '', id: '' }), false);
  });

  it('preserves supported natural-event provenance and rejects unsupported rows', () => {
    const firmsEvent = mapNaturalEvent({
      id: 'EONET_3',
      category: 'wildfires',
      title: 'Wildfire near Santa Clarita',
      description: '',
      sourceName: 'NASA FIRMS',
      sourceUrl: 'https://firms.modaps.eosdis.nasa.gov/',
      magnitude: 350,
      date: 1_700_000_000_000,
      lat: 34.4,
      lon: -118.5,
    });
    assert.equal(firmsEvent.source, 'NASA FIRMS');
    assert.equal(firmsEvent.severity, 'orange');

    const gdacsEvent = mapNaturalEvent({
      id: 'gdacs-TC-123',
      category: 'severeStorms',
      title: '\u{1F534} Cyclone Jude',
      description: 'Landfall expected',
      sourceName: 'GDACS',
      sourceUrl: 'https://www.gdacs.org/',
      stormName: 'Jude',
      stormCategory: 4,
      date: 1_700_000_000_000,
      lat: -18.9,
      lon: 36.2,
    });
    assert.equal(gdacsEvent.source, 'GDACS');
    assert.equal(gdacsEvent.severity, 'red');

    // NHC severe storms are filtered by isClimateNaturalEvent (GDACS-only),
    // not by mapNaturalEvent. mapNaturalEvent accepts any known source.
    assert.equal(
      isClimateNaturalEvent({ category: 'severeStorms', sourceName: 'NHC', stormName: 'Alfred', id: 'nhc-AL01-1' }),
      false,
    );
  });

  it('maps EONET-sourced volcano and drought events through the full pipeline', () => {
    const volcanoEvent = mapNaturalEvent({
      id: 'EONET_5001',
      category: 'volcanoes',
      title: 'Etna eruption',
      sourceName: 'SIVolcano',
      sourceUrl: 'https://volcano.si.edu/',
      date: 1_700_000_000_000,
      lat: 37.75,
      lon: 14.99,
    });
    assert.ok(volcanoEvent, 'EONET volcano should not be dropped');
    assert.equal(volcanoEvent.type, 'volcano');
    assert.equal(volcanoEvent.source, 'EONET');

    const droughtEvent = mapNaturalEvent({
      id: 'EONET_5002',
      category: 'drought',
      title: 'East Africa drought',
      sourceName: 'FEWS NET',
      sourceUrl: 'https://fews.net/',
      date: 1_700_000_000_000,
      lat: 1.0,
      lon: 38.0,
    });
    assert.ok(droughtEvent, 'EONET drought should not be dropped');
    assert.equal(droughtEvent.type, 'drought');

    const eonetFlood = mapNaturalEvent({
      id: 'EONET_5003',
      category: 'floods',
      title: 'Flooding in Bangladesh',
      sourceName: '',
      sourceUrl: 'https://eonet.gsfc.nasa.gov/',
      date: 1_700_000_000_000,
      lat: 23.8,
      lon: 90.4,
    });
    assert.ok(eonetFlood, 'EONET flood should not be dropped');
    assert.equal(eonetFlood.type, 'flood');
    assert.equal(eonetFlood.source, 'EONET');
  });

  it('derives country codes from coordinates when natural-event text lacks a country', () => {
    assert.equal(findCountryCodeByCoordinates(35.6762, 139.6503), 'JP');

    const gdacsEvent = mapNaturalEvent({
      id: 'gdacs-TC-456',
      category: 'severeStorms',
      title: '\u{1F7E0} Tropical Cyclone',
      description: '',
      sourceName: 'GDACS',
      sourceUrl: 'https://www.gdacs.org/',
      date: 1_700_000_000_000,
      lat: 35.6762,
      lon: 139.6503,
    });
    assert.equal(gdacsEvent.countryCode, 'JP');
    assert.equal(gdacsEvent.country, 'Japan');
  });

  it('fails hard on config errors even when other sources succeed (missing credential)', () => {
    // Source-agnostic on purpose: this asserts the isConfigError CONTRACT, not
    // any one provider. It used to be phrased around RELIEFWEB_APPNAME, which
    // was removed 2026-08-03 — the contract it guards outlived that source.
    const configErr = new Error('SOME_REQUIRED_CREDENTIAL is required');
    configErr.isConfigError = true;

    assert.throws(() => collectDisasterSourceResults([
      { status: 'fulfilled', value: [{ id: 'nat-1', source: 'GDACS', type: 'flood', name: 'Floods', country: 'Japan', countryCode: 'JP', lat: 35.6, lng: 139.7, severity: 'high', startedAt: 1_700_000_000_000, status: 'alert', affectedPopulation: 0, sourceUrl: '' }] },
      { status: 'rejected', reason: configErr },
    ]), { message: /SOME_REQUIRED_CREDENTIAL/ });
  });

  it('fails hard on config errors even when other sources succeed (rejected appname)', () => {
    const rejectErr = new Error('HTTP 403 appname not in approved appname list');
    rejectErr.isConfigError = true;

    assert.throws(() => collectDisasterSourceResults([
      { status: 'fulfilled', value: [{ id: 'nat-1', source: 'GDACS', type: 'flood', name: 'Floods', country: 'Japan', countryCode: 'JP', lat: 35.6, lng: 139.7, severity: 'high', startedAt: 1_700_000_000_000, status: 'alert', affectedPopulation: 0, sourceUrl: '' }] },
      { status: 'rejected', reason: rejectErr },
    ]), { message: /HTTP 403/ });
  });

  it('keeps successful source payloads when another source fails', () => {
    const merged = collectDisasterSourceResults([
      { status: 'fulfilled', value: [{ id: 'gdacs-1', source: 'GDACS', type: 'flood', name: 'Floods', country: 'Japan', countryCode: 'JP', lat: 35.6, lng: 139.7, severity: 'high', startedAt: 1_700_000_000_000, status: 'alert', affectedPopulation: 0, sourceUrl: 'https://gdacs.org/' }] },
      { status: 'rejected', reason: new Error('natural cache unavailable') },
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].source, 'GDACS');
  });

  it('emits the required camelCase Redis output shape', () => {
    const row = toRedisDisaster({
      id: 'gdacs-TC-123',
      type: 'cyclone',
      name: 'Cyclone Jude',
      country: 'Japan',
      countryCode: 'JP',
      lat: 35.6,
      lng: 139.7,
      severity: 'red',
      startedAt: 1_700_000_000_000,
      status: 'alert',
      affectedPopulation: 42,
      source: 'GDACS',
      sourceUrl: 'https://www.gdacs.org/',
    });

    assert.deepEqual(Object.keys(row), [
      'id',
      'type',
      'name',
      'country',
      'countryCode',
      'lat',
      'lng',
      'severity',
      'startedAt',
      'status',
      'affectedPopulation',
      'source',
      'sourceUrl',
    ]);
    assert.equal(row.countryCode, 'JP');
    assert.equal(row.startedAt, 1_700_000_000_000);
    assert.equal(row.affectedPopulation, 42);
    assert.equal(row.sourceUrl, 'https://www.gdacs.org/');
  });
});
