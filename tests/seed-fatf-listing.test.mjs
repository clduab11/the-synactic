// Pin the HM Treasury / GOV.UK Content API sourcing of the FATF grey + black
// lists: child-notice resolution, heading-scoped list extraction, the
// UK-sanctions over-collection trap, publication-date inference, the sanity
// bands, validate(), and the boundary-2 (v9) fetch posture.
//
// The two REAL fixtures under tests/fixtures/ are verbatim GOV.UK Content API
// responses captured 2026-08-03 (June 2026 plenary notice). They are the
// regression surface for any future parser change — the previous suite used
// synthetic-only FATF HTML and let a 100-unmatched-candidate failure ship.
//
// Historical note: this seeder used to fetch fatf-gafi.org through a spoofed
// Chrome UA + a Decodo residential proxy + Wayback, purely to get past a
// Cloudflare managed challenge. That chain violated CONTEXT.md boundary 2 and
// never landed a payload. The tests that pinned it are gone with it; the
// `no forbidden fetch measures` block below is what stops it coming back.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildNameLookup,
  extractHeadingSection,
  extractFirstListItems,
  extractListedCountries,
  resolveCountryNames,
  resolveLatestNotice,
  resolvePublicationDate,
  fetchGovUkJson,
  fetchFatfListings,
  validate,
  SYNACTIC_UA,
  ATTRIBUTION,
  GREY_HEADING_FRAGMENT,
  BLACK_HEADING_FRAGMENT,
  HMT_NOTICE_BASE_PATH,
} from '../scripts/seed-fatf-listing.mjs';

const __testDir = dirname(fileURLToPath(import.meta.url));
const fixtureJson = (name) => JSON.parse(readFileSync(resolve(__testDir, 'fixtures', name), 'utf8'));

const SERIES_FIXTURE = fixtureJson('hmt-fatf-notice-series-2026-06.json');
const NOTICE_FIXTURE = fixtureJson('hmt-fatf-notice-2026-06.json');
const BODY = NOTICE_FIXTURE.details.body;

// June 2026 plenary, as republished by HM Treasury.
const EXPECTED_GREY = [
  'AO', // Angola
  'BA', // Bosnia and Herzegovina
  'BG', // Bulgaria
  'BO', // Bolivia
  'CD', // Democratic Republic of the Congo
  'CI', // Cote d'Ivoire
  'CM', // Cameroon
  'HT', // Haiti
  'IQ', // Iraq
  'KE', // Kenya
  'KW', // Kuwait
  'LA', // Lao PDR
  'LB', // Lebanon
  'MC', // Monaco
  'NP', // Nepal
  'PG', // Papua New Guinea
  'SS', // South Sudan
  'SY', // Syria
  'VE', // Venezuela
  'VG', // British Virgin Islands
  'VN', // Vietnam
  'YE', // Yemen
];
const EXPECTED_BLACK = ['IR', 'KP', 'MM'];

// A fetchJsonFn seam that serves the two real fixtures by base_path.
function fixtureFetcher({ onCall } = {}) {
  return async (basePath) => {
    onCall?.(basePath);
    if (basePath === HMT_NOTICE_BASE_PATH) return SERIES_FIXTURE;
    if (basePath === NOTICE_FIXTURE.base_path) return NOTICE_FIXTURE;
    throw new Error(`unexpected base_path in test: ${basePath}`);
  };
}

describe('resolveLatestNotice — GOV.UK series -> current notice', () => {
  it('REAL FIXTURE: resolves the child notice base_path, title and timestamp', () => {
    const notice = resolveLatestNotice(SERIES_FIXTURE);
    assert.equal(notice.basePath, SERIES_FIXTURE.links.children[0].base_path);
    assert.match(notice.title, /Money Laundering Advisory Notice/);
    assert.match(notice.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('picks the NEWEST child, not document order (a stale-first array must not win)', () => {
    // The CDX `limit` lesson in miniature: never assume an upstream array is
    // ordered newest-first. Here document order is deliberately oldest-first.
    const doc = {
      links: {
        children: [
          { base_path: '/old', title: 'February 2026', public_updated_at: '2026-02-24T09:00:00Z' },
          { base_path: '/new', title: 'June 2026', public_updated_at: '2026-06-22T09:00:07Z' },
        ],
      },
    };
    assert.equal(resolveLatestNotice(doc).basePath, '/new');
  });

  it('falls back to first_published_at when public_updated_at is absent', () => {
    const doc = {
      links: {
        children: [
          { base_path: '/a', first_published_at: '2026-02-24T09:00:00Z' },
          { base_path: '/b', first_published_at: '2026-06-22T09:00:00Z' },
        ],
      },
    };
    assert.equal(resolveLatestNotice(doc).basePath, '/b');
  });

  it('keeps document order as the tiebreak when timestamps are equal or missing', () => {
    const doc = { links: { children: [{ base_path: '/first' }, { base_path: '/second' }] } };
    assert.equal(resolveLatestNotice(doc).basePath, '/first');
  });

  it('throws loudly when links.children is missing (structural change, not an empty list)', () => {
    assert.throws(() => resolveLatestNotice({ links: {} }), /no links\.children/);
    assert.throws(() => resolveLatestNotice({}), /no links\.children/);
  });

  it('throws when children exist but none carry a base_path', () => {
    assert.throws(
      () => resolveLatestNotice({ links: { children: [{ title: 'no path' }] } }),
      /none carry a base_path/,
    );
  });
});

describe('extractHeadingSection — heading-scoped, prose-immune', () => {
  it('REAL FIXTURE: scopes to the heading, stopping at the next heading of any level', () => {
    const grey = extractHeadingSection(BODY, GREY_HEADING_FRAGMENT);
    assert.ok(grey, 'grey-list heading section must be found');
    // Grey section runs h4 -> next h4. It must contain Angola and must NOT
    // contain the black-list entries that live in the following section.
    assert.match(grey, /Angola/);
    assert.doesNotMatch(grey, /Myanmar/, 'grey section must stop at the black-list h4');
  });

  it('REAL FIXTURE: ignores the same phrases when they appear in blockquote / prose', () => {
    // The notice quotes both list names inside a <blockquote> and again in a
    // narrative <p>, well before the h4 headings. A body-wide text scan would
    // anchor on those and slice the wrong region.
    const black = extractHeadingSection(BODY, BLACK_HEADING_FRAGMENT);
    assert.ok(black, 'black-list heading section must be found');
    assert.match(black, /Myanmar/, 'must land on the h4 section, not the earlier blockquote');
    assert.doesNotMatch(black, /Angola/, 'must not reach back into the grey-list section');
  });

  it('returns null when no heading matches (caller turns this into a loud failure)', () => {
    assert.equal(extractHeadingSection('<p>call for action</p>', BLACK_HEADING_FRAGMENT), null,
      'a paragraph containing the phrase is not a heading match');
    assert.equal(extractHeadingSection('<h4>Something else</h4><ul><li>X</li></ul>', 'call for action'), null);
    assert.equal(extractHeadingSection('', 'call for action'), null);
  });

  it('runs to end-of-document when the matched heading is last', () => {
    const section = extractHeadingSection('<h2>Intro</h2><p>x</p><h4>Call for Action</h4><ul><li>Iran</li></ul>', 'call for action');
    assert.match(section, /<li>Iran<\/li>/);
  });
});

describe('extractFirstListItems — the UK-sanctions over-collection trap', () => {
  it('REAL FIXTURE: black-list section yields exactly the 3 FATF jurisdictions, NOT the trailing sanctions list', () => {
    // THE TRAP: a second <ul> follows the black-list h4 — "Of these
    // jurisdictions, the following are also subject to financial sanctions
    // measures..." — listing 9 countries that overlap the grey list. Taking
    // every <li> in the section would promote DRC, Haiti, South Sudan, Syria,
    // Venezuela and Yemen from grey to black.
    const section = extractHeadingSection(BODY, BLACK_HEADING_FRAGMENT);
    const items = extractFirstListItems(section);
    assert.equal(items.length, 3, `expected 3 items; got ${items.length}: ${items.join(' | ')}`);
    assert.match(items[0], /Democratic People/);
    assert.deepEqual(items.slice(1), ['Iran', 'Myanmar']);
    // Positive confirmation that the trap really is present in the fixture —
    // otherwise this test would pass vacuously against a fixture that lost it.
    assert.equal((section.match(/<ul\b/gi) || []).length, 2,
      'fixture must still contain the trailing UK-sanctions <ul>; if it does not, this test proves nothing');
    assert.match(section, /also subject to financial sanctions measures/,
      'fixture must still contain the sanctions-list preamble');
  });

  it('REAL FIXTURE: grey-list section yields all 22 jurisdictions', () => {
    const items = extractFirstListItems(extractHeadingSection(BODY, GREY_HEADING_FRAGMENT));
    assert.equal(items.length, 22, `expected 22 items; got ${items.length}`);
    assert.equal(items[0], 'Angola');
    assert.equal(items.at(-1), 'Yemen');
  });

  it('returns null when the section has no <ul>', () => {
    assert.equal(extractFirstListItems('<p>no list here</p>'), null);
    assert.equal(extractFirstListItems(''), null);
    assert.equal(extractFirstListItems(null), null);
  });

  it('strips tags before decoding entities (a publisher-escaped &lt;note&gt; stays literal)', () => {
    const items = extractFirstListItems('<ul><li>XSS via &amp;lt;script&amp;gt; in template</li></ul>');
    assert.deepEqual(items, ['XSS via &lt;script&gt; in template']);
  });

  it('drops empty <li> rather than emitting blank candidates', () => {
    assert.deepEqual(extractFirstListItems('<ul><li>Iran</li><li>  </li><li>Myanmar</li></ul>'), ['Iran', 'Myanmar']);
  });
});

describe('extractListedCountries — end-to-end name resolution against the real notice', () => {
  it('REAL FIXTURE: grey list resolves to all 22 ISO2 codes with ZERO unmatched candidates', () => {
    const { listed, unmatchedCandidates } = extractListedCountries(BODY, buildNameLookup(), GREY_HEADING_FRAGMENT);
    assert.deepEqual([...listed].sort(), EXPECTED_GREY,
      `got ${[...listed].sort().join(',')}`);
    assert.equal(unmatchedCandidates.size, 0,
      `zero unmatched expected; got: ${[...unmatchedCandidates].join(', ')}`);
  });

  it('REAL FIXTURE: black list resolves to exactly DPRK, Iran, Myanmar with ZERO unmatched', () => {
    const { listed, unmatchedCandidates } = extractListedCountries(BODY, buildNameLookup(), BLACK_HEADING_FRAGMENT);
    assert.deepEqual([...listed].sort(), EXPECTED_BLACK, `got ${[...listed].sort().join(',')}`);
    assert.equal(unmatchedCandidates.size, 0, `got: ${[...unmatchedCandidates].join(', ')}`);
  });

  it('REAL FIXTURE: none of the grey-list-only sanctions entries leak into the black list', () => {
    // The overlap set between the trailing UK-sanctions <ul> and the grey
    // list. If the trap ever reopens, these show up as black.
    const { listed } = extractListedCountries(BODY, buildNameLookup(), BLACK_HEADING_FRAGMENT);
    for (const iso of ['CD', 'HT', 'SS', 'SY', 'VE', 'YE']) {
      assert.ok(!listed.has(iso), `${iso} is grey-listed + UK-sanctioned; it must NOT appear as black`);
    }
  });

  it('throws when the heading is missing (structural change fails loudly, not silently empty)', () => {
    assert.throws(
      () => extractListedCountries('<h2>Unrelated</h2><ul><li>Iran</li></ul>', buildNameLookup(), BLACK_HEADING_FRAGMENT),
      /no heading containing "call for action"/,
    );
  });

  it('throws when the heading exists but its section has no list', () => {
    assert.throws(
      () => extractListedCountries('<h4>Call for Action</h4><p>coming soon</p>', buildNameLookup(), BLACK_HEADING_FRAGMENT),
      /contains no <ul> list items/,
    );
  });
});

describe('resolveCountryNames — typographic apostrophes and unmatched surfacing', () => {
  const lookup = buildNameLookup();

  it("resolves GOV.UK's U+2019 apostrophe forms", () => {
    // GOV.UK govspeak emits the typographic right single quote, not ASCII '.
    const { listed, unmatchedCandidates } = resolveCountryNames(
      ['Côte d’Ivoire', 'Democratic People’s Republic of Korea'],
      lookup,
    );
    assert.deepEqual([...listed].sort(), ['CI', 'KP']);
    assert.equal(unmatchedCandidates.size, 0);
  });

  it('surfaces genuinely unknown names instead of dropping them', () => {
    const { listed, unmatchedCandidates } = resolveCountryNames(['Iran', 'Atlantis'], lookup);
    assert.deepEqual([...listed], ['IR']);
    assert.deepEqual([...unmatchedCandidates], ['Atlantis']);
  });

  it('handles an empty/absent name list without throwing', () => {
    assert.equal(resolveCountryNames(undefined, lookup).listed.size, 0);
    assert.equal(resolveCountryNames([], lookup).unmatchedCandidates.size, 0);
  });
});

describe('buildNameLookup — country-names.json shape parity', () => {
  it('reads the flat {name: ISO2} JSON shape and produces a populated lookup', () => {
    const lookup = buildNameLookup();
    assert.ok(lookup.size > 200, `expected ~250+ entries; got ${lookup.size}`);
    assert.equal(lookup.get('iran'), 'IR');
    assert.equal(lookup.get('myanmar'), 'MM');
    assert.equal(lookup.get('algeria'), 'DZ');
  });

  it('includes the aliases the HM Treasury renderings need', () => {
    const lookup = buildNameLookup();
    assert.equal(lookup.get('cote divoire'), 'CI');
    assert.equal(lookup.get('british virgin islands'), 'VG');
    assert.equal(lookup.get('lao pdr'), 'LA');
    assert.equal(lookup.get('democratic peoples republic of korea'), 'KP');
    assert.equal(lookup.get('bosnia and herzegovina'), 'BA');
  });

  it('handles non-string values defensively', () => {
    const lookup = buildNameLookup({ iran: 'IR', malformed: { not: 'a string' }, myanmar: 'MM' });
    assert.equal(lookup.get('iran'), 'IR');
    assert.equal(lookup.get('myanmar'), 'MM');
    assert.equal(lookup.has('malformed'), false);
  });
});

describe('resolvePublicationDate — FATF statement date, not the HMT publish date', () => {
  it('REAL FIXTURE: extracts the FATF plenary statement date (2026-06-19), not 2026-06-22', () => {
    assert.equal(resolvePublicationDate(BODY, NOTICE_FIXTURE.public_updated_at), '2026-06-19');
  });

  it('REAL FIXTURE: does NOT pick up the earlier "On 25 March 2026, HM Treasury laid" sentence', () => {
    // A naive "first Month YYYY in the body" scan returns 2026-03 here,
    // because the amendment-regulations paragraph precedes the FATF
    // statement. Confirm positively that the trap sentence is in the fixture.
    assert.match(BODY, /25 March 2026, HM Treasury laid/,
      'fixture must still contain the decoy date sentence; otherwise this test proves nothing');
    assert.equal(resolvePublicationDate(BODY, null), '2026-06-19');
  });

  it('zero-pads single-digit days', () => {
    assert.equal(resolvePublicationDate('<p>On 4 February 2027, the FATF published its lists.</p>', null), '2027-02-04');
  });

  it('falls back to the GOV.UK notice timestamp when the statement sentence is missing', () => {
    assert.equal(resolvePublicationDate('<p>no statement sentence</p>', '2026-06-22T09:00:07Z'), '2026-06-22');
  });

  it('falls back to today when neither signal is present', () => {
    assert.match(resolvePublicationDate('<p>nothing</p>', null), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(resolvePublicationDate('<p>nothing</p>', 'not-a-date'), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('fetchFatfListings — payload assembly and sanity bands', () => {
  it('REAL FIXTURES: produces the June 2026 payload (3 black / 22 grey, zero unmatched)', async () => {
    const calls = [];
    const data = await fetchFatfListings({ fetchJsonFn: fixtureFetcher({ onCall: (p) => calls.push(p) }) });
    assert.deepEqual(calls, [HMT_NOTICE_BASE_PATH, NOTICE_FIXTURE.base_path],
      'exactly two GETs: the series document, then the resolved child notice');
    assert.deepEqual(data.counts, { black: 3, gray: 22 });
    assert.deepEqual(data.unmatchedCandidates, []);
    assert.equal(data.publicationDate, '2026-06-19');
    assert.deepEqual(
      Object.entries(data.listings).filter(([, s]) => s === 'black').map(([k]) => k).sort(),
      EXPECTED_BLACK,
    );
    assert.deepEqual(
      Object.entries(data.listings).filter(([, s]) => s === 'gray').map(([k]) => k).sort(),
      EXPECTED_GREY,
    );
    assert.equal(validate(data), true);
  });

  it('carries HM Treasury (OGL v3.0) attribution AND FATF as the ultimate source', async () => {
    const data = await fetchFatfListings({ fetchJsonFn: fixtureFetcher() });
    assert.match(data.attribution, /Open Government Licence v3\.0/);
    assert.equal(data.attribution, ATTRIBUTION);
    const retrieved = data.sources.find((s) => s.role === 'retrieved');
    const ultimate = data.sources.find((s) => s.role === 'ultimate-source');
    assert.ok(retrieved, 'sources[] must record what was actually fetched');
    assert.match(retrieved.publisher, /HM Treasury/);
    assert.equal(retrieved.licence, 'Open Government Licence v3.0');
    assert.match(retrieved.licenceUrl, /nationalarchives\.gov\.uk\/doc\/open-government-licence\/version\/3/);
    assert.match(retrieved.url, /^https:\/\/www\.gov\.uk\//);
    assert.equal(retrieved.apiUrl, `https://www.gov.uk/api/content${NOTICE_FIXTURE.base_path}`);
    assert.ok(ultimate, 'sources[] must name FATF as the originating authority');
    assert.match(ultimate.publisher, /Financial Action Task Force/);
  });

  it('throws when details.body is missing (200 + plausible JSON != valid payload)', async () => {
    const fetchJsonFn = async (basePath) =>
      basePath === HMT_NOTICE_BASE_PATH ? SERIES_FIXTURE : { base_path: basePath, details: {} };
    await assert.rejects(fetchFatfListings({ fetchJsonFn }), /has no details\.body/);
  });

  it('black-list band rejects an over-collected list (the sanctions-<ul> trap, simulated)', async () => {
    // If the "first <ul> only" scoping ever regressed, the black-list section
    // would yield the 9-entry UK-sanctions list. Assert the band catches it
    // rather than silently reclassifying six grey jurisdictions.
    const body = `
      <h4>Jurisdictions under Increased Monitoring</h4>
      <ul>${['Angola','Bolivia','Bulgaria','Cameroon','Haiti','Iraq','Kenya','Kuwait','Lebanon','Monaco','Nepal','Syria','Venezuela','Yemen'].map((n) => `<li>${n}</li>`).join('')}</ul>
      <h4>High-Risk Jurisdictions subject to a Call for Action</h4>
      <ul>${['Iran','Myanmar','Haiti','Syria','Venezuela','Yemen','Kenya','Kuwait','Lebanon'].map((n) => `<li>${n}</li>`).join('')}</ul>
    `;
    const fetchJsonFn = async (basePath) =>
      basePath === HMT_NOTICE_BASE_PATH ? SERIES_FIXTURE : { base_path: basePath, details: { body } };
    await assert.rejects(fetchFatfListings({ fetchJsonFn }), /black-list count 9 outside expected 1-6 band/);
  });

  it('grey-list band rejects a truncated list', async () => {
    const body = `
      <h4>Jurisdictions under Increased Monitoring</h4>
      <ul><li>Angola</li><li>Bolivia</li><li>Bulgaria</li></ul>
      <h4>High-Risk Jurisdictions subject to a Call for Action</h4>
      <ul><li>Iran</li><li>Myanmar</li></ul>
    `;
    const fetchJsonFn = async (basePath) =>
      basePath === HMT_NOTICE_BASE_PATH ? SERIES_FIXTURE : { base_path: basePath, details: { body } };
    await assert.rejects(fetchFatfListings({ fetchJsonFn }), /grey-list count 3 outside expected 12-40 band/);
  });

  it('rejects the seed when more than 2 country names fail to resolve (never silently drops)', async () => {
    const grey = ['Angola','Bolivia','Bulgaria','Cameroon','Haiti','Iraq','Kenya','Kuwait','Lebanon','Monaco','Nepal','Syria','Venezuela','Yemen'];
    const body = `
      <h4>Jurisdictions under Increased Monitoring</h4>
      <ul>${[...grey, 'Atlantis', 'Wakanda', 'Genovia'].map((n) => `<li>${n}</li>`).join('')}</ul>
      <h4>High-Risk Jurisdictions subject to a Call for Action</h4>
      <ul><li>Iran</li><li>Myanmar</li></ul>
    `;
    const fetchJsonFn = async (basePath) =>
      basePath === HMT_NOTICE_BASE_PATH ? SERIES_FIXTURE : { base_path: basePath, details: { body } };
    await assert.rejects(
      fetchFatfListings({ fetchJsonFn }),
      /3 unmatched country-name candidates .*Atlantis, Wakanda, Genovia/s,
    );
  });
});

describe('fetchGovUkJson — boundary-2 (v9) fetch posture', () => {
  it('sends the honest declared bot UA and asks for JSON', async () => {
    let seen;
    const fetchFn = async (url, opts) => {
      seen = { url, opts };
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json; charset=utf-8']]),
        text: async () => '{"ok":true}',
      };
    };
    const out = await fetchGovUkJson(HMT_NOTICE_BASE_PATH, { fetchFn });
    assert.deepEqual(out, { ok: true });
    assert.equal(seen.url, `https://www.gov.uk/api/content${HMT_NOTICE_BASE_PATH}`);
    assert.equal(seen.opts.headers['User-Agent'], SYNACTIC_UA);
    assert.equal(seen.opts.headers.Accept, 'application/json');
    assert.match(SYNACTIC_UA, /^the-synactic\/[\d.]+ \(\+https:\/\/github\.com\//,
      'UA must be an honest, attributable bot identifier');
    assert.doesNotMatch(SYNACTIC_UA, /Mozilla|AppleWebKit|Chrome|Safari|Gecko/,
      'UA must not impersonate a browser (CONTEXT.md boundary 2)');
  });

  it('surfaces HTTP 429 as a terminal failure — exactly ONE request, no retry through the refusal', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return { ok: false, status: 429, headers: new Map(), text: async () => '' };
    };
    await assert.rejects(
      fetchGovUkJson(HMT_NOTICE_BASE_PATH, { fetchFn }),
      /HTTP 429 \(rate limited\)\. Not retried by design/,
    );
    assert.equal(calls, 1, 'a 429 is the publisher declining; re-issuing the request is forbidden');
  });

  it('rejects a 200 that is not JSON (200 + plausible bytes != valid payload)', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/html; charset=utf-8']]),
      text: async () => '<html><body>CDN error page</body></html>',
    });
    await assert.rejects(fetchGovUkJson(HMT_NOTICE_BASE_PATH, { fetchFn }), /expected JSON, got content-type="text\/html/);
  });

  it('reports a malformed JSON body with a bounded preview instead of throwing a bare SyntaxError', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => '{ not json',
    });
    await assert.rejects(fetchGovUkJson(HMT_NOTICE_BASE_PATH, { fetchFn }), /JSON parse failed.*firstChars=/s);
  });

  it('reports non-429 HTTP failures with the status code', async () => {
    const fetchFn = async () => ({ ok: false, status: 503, headers: new Map(), text: async () => '' });
    await assert.rejects(fetchGovUkJson(HMT_NOTICE_BASE_PATH, { fetchFn }), /HTTP 503/);
  });

  it('unwraps transport errors (err.cause) into an operator-actionable message', async () => {
    const fetchFn = async () => {
      const err = new TypeError('fetch failed');
      err.cause = Object.assign(new Error('getaddrinfo ENOTFOUND www.gov.uk'), { code: 'ENOTFOUND' });
      throw err;
    };
    await assert.rejects(fetchGovUkJson(HMT_NOTICE_BASE_PATH, { fetchFn }), /request failed.*ENOTFOUND/s);
  });
});

describe('validate', () => {
  it('rejects payload missing the listings field', () => {
    assert.equal(validate({}), false);
  });

  it('rejects payload with no black-listed jurisdiction (DPRK has been on call-for-action since 2011)', () => {
    const onlyGrey = {};
    for (let i = 0; i < 15; i++) onlyGrey[`X${i.toString().padStart(2, '0')}`] = 'gray';
    assert.equal(validate({ listings: onlyGrey }), false);
  });

  it('rejects payload with too few grey-listed jurisdictions (parser likely failed)', () => {
    const listings = { KP: 'black' };
    for (let i = 0; i < 10; i++) listings[`X${i.toString().padStart(2, '0')}`] = 'gray';
    assert.equal(validate({ listings }), false);
  });

  it('accepts payload with at least 1 black + 12 grey', () => {
    const listings = { KP: 'black' };
    for (let i = 0; i < 14; i++) listings[`X${i.toString().padStart(2, '0')}`] = 'gray';
    assert.equal(validate({ listings }), true);
  });
});

describe('no forbidden fetch measures may return to this seeder', () => {
  // Source-shape guard. The deleted chain was: CHROME_UA -> Decodo residential
  // CONNECT proxy -> Wayback (also CHROME_UA + proxy), all aimed at defeating
  // Cloudflare's managed challenge on fatf-gafi.org. CONTEXT.md boundary 2
  // (v9) forbids every one of those measures. Re-sourcing was the remedy.
  //
  // CRLF: this checkout materializes CRLF working-tree files. Normalize before
  // matching or these regexes silently match nothing and the guard passes
  // vacuously.
  const seederSrc = readFileSync(resolve(__testDir, '../scripts/seed-fatf-listing.mjs'), 'utf8')
    .replace(/\r\n/g, '\n');

  // Strip comments so the historical explanation at the top of the file (which
  // legitimately names CHROME_UA, Decodo and Wayback) cannot mask real code.
  const seederCode = seederSrc
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  it('the guard is operating on real, non-empty code (anti-vacuous-pass check)', () => {
    assert.ok(seederSrc.length > 4000, `seeder source looks truncated: len=${seederSrc.length}`);
    assert.ok(seederCode.length > 1500, `comment-stripped code looks truncated: len=${seederCode.length}`);
    assert.match(seederCode, /export async function fetchGovUkJson/, 'strip step must not have eaten the code');
  });

  it('imports nothing from _seed-utils beyond loadEnvFile / runSeed / describeErr', () => {
    const importLine = /^import \{([^}]*)\} from '\.\/_seed-utils\.mjs';$/m.exec(seederCode);
    assert.ok(importLine, 'expected exactly one named import from _seed-utils.mjs');
    const named = importLine[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(named, ['describeErr', 'loadEnvFile', 'runSeed']);
  });

  it('contains no browser-impersonation User-Agent', () => {
    assert.doesNotMatch(seederCode, /CHROME_UA/, 'CHROME_UA must not be used here');
    assert.doesNotMatch(seederCode, /Mozilla\/5\.0/, 'no hardcoded browser UA string');
  });

  it('contains no proxy / IP-rotation machinery', () => {
    for (const forbidden of ['httpsProxyFetchRaw', 'resolveProxyForConnect', 'PROXY_URL', 'decodo', 'Decodo']) {
      assert.ok(!seederCode.includes(forbidden), `${forbidden} must not appear in seeder code`);
    }
  });

  it('makes no Wayback / archive.org request', () => {
    assert.doesNotMatch(seederCode, /web\.archive\.org|fetchViaWayback|WAYBACK_/);
  });

  it('sends exactly one User-Agent, and it is the honest declared bot UA', () => {
    const uaLines = seederCode.split('\n').filter((l) => l.includes("'User-Agent'"));
    assert.equal(uaLines.length, 1, `expected one User-Agent header site; got ${uaLines.length}`);
    assert.match(uaLines[0], /'User-Agent': SYNACTIC_UA/);
    assert.match(
      seederCode,
      /SYNACTIC_UA = 'the-synactic\/2\.10 \(\+https:\/\/github\.com\/clduab11\/the-synactic\)'/,
      'the mandated boundary-2 honest UA string',
    );
  });

  it('only ever fetches www.gov.uk', () => {
    const hosts = new Set(
      [...seederCode.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()),
    );
    // fatf-gafi.org and nationalarchives.gov.uk appear only inside the
    // attribution metadata (sources[] / licenceUrl) — never fetched. Pin the
    // full set so a new outbound host cannot slip in unnoticed.
    assert.deepEqual([...hosts].sort(), [
      'github.com',
      'www.fatf-gafi.org',
      'www.gov.uk',
      'www.nationalarchives.gov.uk',
    ]);
    assert.match(seederCode, /const GOVUK_ORIGIN = 'https:\/\/www\.gov\.uk'/);
    // The only fetch call site must build its URL from the GOV.UK API base.
    assert.match(seederCode, /const url = `\$\{GOVUK_CONTENT_API\}\$\{basePath\}`/);
  });
});
