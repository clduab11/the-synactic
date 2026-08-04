#!/usr/bin/env node
//
// FATF — black & grey AML/CFT listings
// Canonical key: economic:fatf-listing:v1
//
// FATF publishes two listings 3x per year (after each plenary):
//   - "High-Risk Jurisdictions subject to a Call for Action" (the "black list")
//   - "Jurisdictions under Increased Monitoring"             (the "grey list")
//
// ── WHY THIS SEEDER NO LONGER TALKS TO fatf-gafi.org ────────────────────
//
// The previous implementation fetched https://www.fatf-gafi.org/... through
// a three-tier chain: a spoofed Chrome User-Agent, then a Decodo residential
// CONNECT proxy, then Wayback (also via Chrome UA + residential proxy). Every
// one of those tiers existed for a single purpose: to get past Cloudflare's
// managed challenge on fatf-gafi.org. Browser impersonation and residential-IP
// rotation aimed at defeating an anti-bot product are the exact measures
// CONTEXT.md boundary 2 (v9) forbids — we do not try to make a party who
// declined us believe we are someone else.
//
// It also never worked: the canonical key was never populated locally, and the
// production diagnostic was ~111 false-positive country candidates parsed out
// of a challenge page / gzip garbage rather than a real payload.
//
// The approved remedy under boundary 2 is re-sourcing to a different sanctioned
// endpoint. HM Treasury republishes the FULL FATF enumeration after every
// plenary in its "Money Laundering Advisory Notice: High Risk Third Countries",
// available as structured JSON from the public GOV.UK Content API under the
// Open Government Licence v3.0. No challenge, no login, no rate-limit games —
// an honest declared bot UA gets a 200.
//
// Retrieval (2 GETs, both to www.gov.uk):
//   1. GET /api/content<HMT_NOTICE_BASE_PATH>        -> the notice "series"
//   2. links.children[] -> newest child's base_path  -> the current notice
//   3. GET /api/content<base_path>                   -> details.body (HTML)
//   4. Parse two h4-scoped <ul> lists out of details.body.
//
// PARSER TRAP (the reason for heading-scoped extraction): a THIRD <ul> follows
// the black-list h4 inside the same section — "Of these jurisdictions, the
// following are also subject to financial sanctions measures...". That is a
// UK-specific sanctions list, NOT a FATF list, and it overlaps the grey list
// (DRC, Haiti, South Sudan, Syria, Venezuela, Yemen). Collecting every <li>
// after the h4 would silently promote six grey-listed countries to black.
// Extraction is therefore scoped to each heading's own section AND to the
// FIRST <ul> within it.
//
// Cadence: monthly cron (catches an FATF plenary update within 30 days of
// HM Treasury republishing it). Cache TTL 90d so a transient parse or fetch
// failure doesn't drop the full listing.

import { loadEnvFile, runSeed, describeErr } from './_seed-utils.mjs';
import { decodeHtmlEntities } from './_html-entities.mjs';
import countryNames from './shared/country-names.json' with { type: 'json' };

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'economic:fatf-listing:v1';
const CACHE_TTL = 90 * 24 * 3600; // 90 days; FATF plenary is 3x per year

// CONTEXT.md boundary 2 (v9): an honest, attributable, declared bot UA is the
// correct posture. Deliberately NOT `CHROME_UA` from _seed-utils.mjs — that
// constant exists for endpoints that were never trying to exclude us, and
// sending it here is what made the old chain a boundary violation.
//
// `_seed-utils.mjs` also exports a `HONEST_UA`, but it is owned by another
// change-boundary and carries an older version/contact form. The string below
// is the one mandated for boundary-2 re-sourcing work.
export const SYNACTIC_UA = 'the-synactic/2.10 (+https://github.com/clduab11/the-synactic)';

const GOVUK_ORIGIN = 'https://www.gov.uk';
const GOVUK_CONTENT_API = `${GOVUK_ORIGIN}/api/content`;
// The stable "series" document. Its links.children[] holds the current notice;
// hardcoding a dated notice path would silently miss the next plenary.
const HMT_NOTICE_BASE_PATH =
  '/government/publications/money-laundering-advisory-notice-high-risk-third-countries--2';

// GOV.UK is a CDN-fronted static JSON API; p99 is well under a second. 15s is
// generous. Two sequential GETs => 30s worst case, comfortably inside
// seed-bundle-macro.mjs's 300_000 ms FATF-Listing section budget.
const FETCH_TIMEOUT_MS = 15_000;

// Heading fragments used to scope <li> extraction. Matched case-insensitively
// against heading TEXT only (never body prose) — both phrases also appear in
// a <blockquote> and in narrative <p> earlier in the same document, which is
// precisely why the scan is restricted to <h1>..<h6>.
const GREY_HEADING_FRAGMENT = 'increased monitoring';
const BLACK_HEADING_FRAGMENT = 'call for action';

// Attribution. HM Treasury content on GOV.UK is Crown copyright released under
// the Open Government Licence v3.0, which requires an attribution statement.
// FATF is recorded as the ultimate source because HM Treasury is republishing,
// not originating, the enumeration.
const HMT_SOURCE = Object.freeze({
  role: 'retrieved',
  publisher: 'HM Treasury (GOV.UK Content API)',
  name: 'Money Laundering Advisory Notice: High Risk Third Countries',
  url: `${GOVUK_ORIGIN}${HMT_NOTICE_BASE_PATH}`,
  licence: 'Open Government Licence v3.0',
  licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
});
const FATF_SOURCE = Object.freeze({
  role: 'ultimate-source',
  publisher: 'Financial Action Task Force (FATF/GAFI)',
  name: 'High-Risk and Other Monitored Jurisdictions',
  url: 'https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html',
  note: 'FATF originates both lists at each plenary; HM Treasury republishes the full enumeration under OGL v3.0. Not fetched by this seeder.',
});
export const ATTRIBUTION =
  'Contains public sector information licensed under the Open Government Licence v3.0. ' +
  'Republished by HM Treasury (GOV.UK); ultimate source: Financial Action Task Force (FATF).';

// Build a name -> ISO2 lookup from country-names.json. The JSON's actual shape
// is `{ "name": "ISO2" }` (flat string-to-string map, ~300 entries covering
// canonical names + common variants). Unchanged by the re-source: HM Treasury
// renders the same jurisdiction names FATF does, and all 25 entries of the
// June 2026 notice resolve against this map with zero unmatched candidates
// [VERIFIED probe 2026-08-03].
export function buildNameLookup(json = countryNames) {
  const lookup = new Map();
  for (const [name, iso2] of Object.entries(json)) {
    if (typeof iso2 !== 'string') continue;
    lookup.set(normalizeName(name), iso2);
  }
  return lookup;
}

function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // Strip apostrophes BEFORE the alphanumeric filter, so "People's" ->
    // "peoples" not "people s". GOV.UK govspeak emits the typographic
    // U+2019 (e.g. "Democratic People's Republic of Korea", "Cote d'Ivoire"),
    // so the smart-quote forms must be in this class.
    .replace(/['‘’ʼ`]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * GET a GOV.UK Content API document.
 *
 * Boundary 2 (v9) posture, in code:
 *   - one honest declared bot UA, no browser impersonation;
 *   - no proxy, no IP rotation;
 *   - HTTP 429 is the publisher declining. We surface it and stop. We do NOT
 *     retry through it, back off into it, or re-issue from another address.
 *     The 90d cache TTL plus `maxStaleMin` covers the gap; a rate-limited run
 *     records a failure reason rather than swallowing one.
 *
 * `fetchFn` is a test seam; production uses global fetch untouched.
 */
export async function fetchGovUkJson(basePath, { fetchFn = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const url = `${GOVUK_CONTENT_API}${basePath}`;
  let resp;
  try {
    resp = await fetchFn(url, {
      headers: { 'User-Agent': SYNACTIC_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`GOV.UK Content API ${url}: request failed (${describeErr(err)})`);
  }
  if (resp?.status === 429) {
    const err = new Error(
      `GOV.UK Content API ${url}: HTTP 429 (rate limited). Not retried by design — ` +
        'CONTEXT.md boundary 2 forbids retrying through a refusal. Previous payload remains under cache TTL.',
    );
    // The flag is what actually stops the retry — runSeed wraps this call in
    // withRetry, which re-issues on any error that is not tagged. Saying "not
    // retried by design" in the message alone left four GETs going into the
    // refusal with 1s/2s/4s backoff while the log claimed otherwise.
    err.nonRetryable = true;
    throw err;
  }
  if (!resp?.ok) {
    const err = new Error(`GOV.UK Content API ${url}: HTTP ${resp?.status ?? 'no-response'}`);
    // A 4xx here is GOV.UK refusing or the document being gone; neither is
    // cured by asking again immediately. 5xx stays retryable — that is a
    // transient fault on their side, not a refusal aimed at us.
    if (resp?.status >= 400 && resp?.status < 500) err.nonRetryable = true;
    throw err;
  }
  // "HTTP 200 + plausible bytes != valid payload" — a CDN error page or an
  // HTML redirect interstitial would otherwise parse as a body-less document
  // and surface downstream as an empty listing.
  const contentType = getHeader(resp.headers, 'content-type') ?? '';
  const text = await resp.text();
  if (!/\bjson\b/i.test(contentType)) {
    throw new Error(
      `GOV.UK Content API ${url}: expected JSON, got content-type="${contentType}" ` +
        `(len=${text.length}, firstChars=${JSON.stringify(text.slice(0, 120))})`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `GOV.UK Content API ${url}: JSON parse failed (${describeErr(err)}); ` +
        `len=${text.length} firstChars=${JSON.stringify(text.slice(0, 120))}`,
    );
  }
}

// Header access that works for both a real fetch Headers object and the plain
// objects / Maps used by tests.
function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * Pick the current notice from the series document's links.children[].
 *
 * GOV.UK returns a single child today, and the brief's rule is "children[0]".
 * We keep document order as the tiebreak but sort by publication timestamp
 * first: an array whose order is not contractually newest-first is exactly the
 * shape that silently serves a stale list (cf. the Wayback CDX `limit` lesson
 * — ascending order + "take the first" = oldest capture). Sorting costs
 * nothing and makes the newest-wins property explicit.
 *
 * Returns `{ basePath, title, updatedAt }`. Throws — never returns null — so a
 * structural change at GOV.UK fails loudly instead of seeding an empty list.
 */
export function resolveLatestNotice(seriesDoc) {
  const children = seriesDoc?.links?.children;
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error(
      `GOV.UK series ${HMT_NOTICE_BASE_PATH} has no links.children[] — HM Treasury may have restructured the publication`,
    );
  }
  const ranked = children
    .map((child, order) => ({
      basePath: typeof child?.base_path === 'string' ? child.base_path : null,
      title: typeof child?.title === 'string' ? child.title : '',
      updatedAt:
        typeof child?.public_updated_at === 'string'
          ? child.public_updated_at
          : typeof child?.first_published_at === 'string'
            ? child.first_published_at
            : null,
      order,
    }))
    .filter((child) => child.basePath);
  if (ranked.length === 0) {
    throw new Error(
      `GOV.UK series ${HMT_NOTICE_BASE_PATH}: ${children.length} children but none carry a base_path`,
    );
  }
  ranked.sort((a, b) => {
    const at = Date.parse(a.updatedAt ?? '') || 0;
    const bt = Date.parse(b.updatedAt ?? '') || 0;
    if (bt !== at) return bt - at;
    return a.order - b.order;
  });
  if (ranked.length > 1) {
    console.warn(
      `[fatf-listing] GOV.UK series returned ${ranked.length} children; using newest ` +
        `${ranked[0].basePath} (${ranked[0].updatedAt ?? 'no timestamp'}). Others: ` +
        ranked.slice(1).map((c) => `${c.basePath}(${c.updatedAt ?? 'no timestamp'})`).join(', '),
    );
  }
  const { basePath, title, updatedAt } = ranked[0];
  return { basePath, title, updatedAt };
}

/**
 * Return the HTML that belongs to the heading whose text contains
 * `headingFragment`: everything after that heading's close tag, up to the start
 * of the NEXT heading of any level (or end of document).
 *
 * Only <h1>..<h6> text is searched, never body prose — both list phrases also
 * appear in a <blockquote> and in narrative paragraphs earlier in the notice.
 *
 * Returns null when no heading matches (caller turns that into a loud failure).
 */
export function extractHeadingSection(html, headingFragment) {
  if (typeof html !== 'string' || html.length === 0) return null;
  const headingRe = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  const headings = [];
  let m;
  while ((m = headingRe.exec(html)) !== null) {
    headings.push({ text: stripHtml(m[2]), start: m.index, end: headingRe.lastIndex });
  }
  const needle = headingFragment.toLowerCase();
  const matches = headings.filter((h) => h.text.toLowerCase().includes(needle));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.warn(
      `[fatf-listing] ${matches.length} headings match "${headingFragment}"; using the first ` +
        `("${matches[0].text}"). Others: ${matches.slice(1).map((h) => `"${h.text}"`).join(', ')}`,
    );
  }
  const hit = matches[0];
  const next = headings.find((h) => h.start >= hit.end);
  return html.slice(hit.end, next ? next.start : html.length);
}

/**
 * Return the <li> texts of the FIRST <ul> inside `sectionHtml`.
 *
 * "First" is load-bearing, not incidental: the black-list section also carries
 * a trailing UK financial-sanctions <ul> that overlaps the grey list. Taking
 * every <li> in the section would promote six grey-listed jurisdictions to
 * black. See the PARSER TRAP note at the top of this file.
 *
 * GOV.UK govspeak renders these as flat, un-nested lists; the non-greedy
 * </ul> match is safe against that shape. If HM Treasury ever nests a list,
 * this under-collects — and the sanity bands below turn that into a loud
 * failure rather than a quiet wrong answer.
 *
 * Returns null when the section contains no <ul> at all.
 */
export function extractFirstListItems(sectionHtml) {
  if (typeof sectionHtml !== 'string' || sectionHtml.length === 0) return null;
  const ul = /<ul\b[^>]*>([\s\S]*?)<\/ul\s*>/i.exec(sectionHtml);
  if (!ul) return null;
  const items = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi;
  let m;
  while ((m = liRe.exec(ul[1])) !== null) {
    // Strip tags BEFORE decoding entities: decoding first would turn a
    // publisher-escaped literal like `&lt;note&gt;` into `<note>`, which
    // stripHtml would then erase.
    const text = decodeHtmlEntities(stripHtml(m[1]));
    if (text) items.push(text);
  }
  return items;
}

/**
 * Resolve raw jurisdiction names to ISO2 via the shared country-names lookup.
 *
 * Unresolvable names are surfaced as `unmatchedCandidates` rather than dropped
 * — a silently dropped country falls back to "compliant" downstream and
 * materially shifts its financialSystemExposure score.
 */
export function resolveCountryNames(names, nameLookup) {
  const listed = new Set();
  const unmatchedCandidates = new Set();
  for (const name of names ?? []) {
    const iso2 = nameLookup.get(normalizeName(name));
    if (iso2) listed.add(iso2);
    else unmatchedCandidates.add(name);
  }
  return { listed, unmatchedCandidates };
}

/**
 * Compose the three steps for one list: heading section -> first <ul> ->
 * ISO2 resolution. Throws when the heading or its list is missing, because a
 * missing section is a structural upstream change, not an empty list.
 *
 * Returns `{ listed, unmatchedCandidates, names }`.
 */
export function extractListedCountries(bodyHtml, nameLookup, headingFragment) {
  const section = extractHeadingSection(bodyHtml, headingFragment);
  if (section === null) {
    throw new Error(
      `HM Treasury notice has no heading containing "${headingFragment}" — ` +
        `notice structure changed. ${previewBodyForDiagnostic(bodyHtml)}`,
    );
  }
  const names = extractFirstListItems(section);
  if (names === null || names.length === 0) {
    throw new Error(
      `HM Treasury notice section "${headingFragment}" contains no <ul> list items — ` +
        `notice structure changed. sectionLen=${section.length} ${previewBodyForDiagnostic(bodyHtml)}`,
    );
  }
  return { ...resolveCountryNames(names, nameLookup), names };
}

/**
 * Date of the FATF plenary statement this notice reproduces.
 *
 * Preference order, and why:
 *   1. The notice's own sentence "On 19 June 2026, the FATF published ..." —
 *      the FATF publication date, which is what `publicationDate` has always
 *      meant to downstream consumers.
 *   2. GOV.UK's public_updated_at for the notice — HM Treasury's republication
 *      date, typically a few days after the plenary.
 *   3. Today.
 *
 * Deliberately NOT a generic "first Month YYYY in the body" scan: this body
 * mentions "On 25 March 2026, HM Treasury laid ... the amendment regulations"
 * BEFORE the FATF statement, so a naive scan returns the wrong date
 * [VERIFIED probe 2026-08-03 — naive scan yields 2026-03, correct is 2026-06-19].
 */
const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};
const FATF_STATEMENT_DATE_RE = new RegExp(
  `\\bon\\s+(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})\\s+(20\\d{2})\\s*,?\\s+the\\s+FATF\\b`,
  'i',
);

export function resolvePublicationDate(bodyHtml, noticeUpdatedAt) {
  const stmt = FATF_STATEMENT_DATE_RE.exec(stripHtml(bodyHtml ?? ''));
  if (stmt) {
    const [, day, month, year] = stmt;
    return `${year}-${MONTHS[month.toLowerCase()]}-${day.padStart(2, '0')}`;
  }
  const parsed = Date.parse(noticeUpdatedAt ?? '');
  if (Number.isFinite(parsed) && parsed > 0) {
    console.warn(
      '[fatf-listing] could not locate the "On <date>, the FATF published" sentence; ' +
        `falling back to the GOV.UK notice timestamp ${noticeUpdatedAt}`,
    );
    return new Date(parsed).toISOString().slice(0, 10);
  }
  console.warn(
    '[fatf-listing] no FATF statement date and no GOV.UK notice timestamp; falling back to today',
  );
  return new Date().toISOString().slice(0, 10);
}

// On a sanity-check failure, surface enough about the body that ops can tell at
// a glance whether the fetch returned the real notice, a different GOV.UK
// document, or something empty. Bounded so log lines stay readable.
export function previewBodyForDiagnostic(html) {
  if (typeof html !== 'string' || html.length === 0) return 'body=<empty>';
  const headings = [];
  const headingRe = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = headingRe.exec(html)) !== null && headings.length < 12) {
    headings.push(stripHtml(m[2]));
  }
  const ulCount = (html.match(/<ul\b/gi) || []).length;
  const liCount = (html.match(/<li\b/gi) || []).length;
  return `body=len:${html.length} ul:${ulCount} li:${liCount} headings:${JSON.stringify(headings)}`;
}

export async function fetchFatfListings({ fetchJsonFn = fetchGovUkJson } = {}) {
  const seriesDoc = await fetchJsonFn(HMT_NOTICE_BASE_PATH);
  const notice = resolveLatestNotice(seriesDoc);
  const noticeDoc = await fetchJsonFn(notice.basePath);

  const body = noticeDoc?.details?.body;
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new Error(
      `HM Treasury notice ${notice.basePath} has no details.body ` +
        `(details keys: ${Object.keys(noticeDoc?.details ?? {}).join(',') || 'none'})`,
    );
  }

  const nameLookup = buildNameLookup();
  const greyResult = extractListedCountries(body, nameLookup, GREY_HEADING_FRAGMENT);
  const blackResult = extractListedCountries(body, nameLookup, BLACK_HEADING_FRAGMENT);

  const listings = {};
  for (const iso2 of blackResult.listed) listings[iso2] = 'black';
  for (const iso2 of greyResult.listed) {
    if (!listings[iso2]) listings[iso2] = 'gray';
  }

  // Surface unmatched country-name candidates so ops can extend
  // shared/country-names.json when a new jurisdiction or spelling appears.
  // Reject the seed if too many are missing — silent drops would re-classify
  // the missed countries as "compliant" (the downstream default) and
  // materially shift their financialSystemExposure score under a fresh
  // seed-meta. Per memory `feedback_url_200_but_wrong_content_type_silent_zero`:
  // "HTTP 200 + plausible bytes != valid payload."
  const unmatched = [...new Set([...blackResult.unmatchedCandidates, ...greyResult.unmatchedCandidates])];
  if (unmatched.length > 0) {
    console.warn(
      `[fatf-listing] ${unmatched.length} country-name candidates not found in shared/country-names.json: ` +
        `${unmatched.join(', ')}. Extend the aliases map if any of these are real country names.`,
    );
  }
  if (unmatched.length > 2) {
    console.warn(`[fatf-listing] diagnostic: ${previewBodyForDiagnostic(body)}`);
    const msg =
      `FATF parser found ${unmatched.length} unmatched country-name candidates (max 2 tolerated): ` +
      `${unmatched.join(', ')}. Previous valid payload remains under cache TTL — extend ` +
      'shared/country-names.json or fix the parser before next plenary.';
    console.warn(`[fatf-listing] parser sanity-check failed: ${msg}`);
    throw new Error(msg);
  }

  // Sanity-check: FATF black list typically has 1-3 jurisdictions
  // (DPRK, Iran, Myanmar as of 2026); grey list typically has 15-25.
  // If we're way outside this band, the parser likely failed.
  //
  // The black-list band is also the backstop for the trailing UK-sanctions
  // <ul>: mis-scoping picks up 9 entries and trips the >6 ceiling instead of
  // silently reclassifying six grey jurisdictions as black.
  const blackCount = Object.values(listings).filter((s) => s === 'black').length;
  const grayCount = Object.values(listings).filter((s) => s === 'gray').length;
  if (blackCount === 0 || blackCount > 6) {
    const msg = `FATF black-list count ${blackCount} outside expected 1-6 band; parser likely failed`;
    console.warn(`[fatf-listing] parser sanity-check failed: ${msg}; previous valid payload remains under cache TTL`);
    console.warn(`[fatf-listing] diagnostic: ${previewBodyForDiagnostic(body)}`);
    throw new Error(msg);
  }
  if (grayCount < 12 || grayCount > 40) {
    const msg = `FATF grey-list count ${grayCount} outside expected 12-40 band; parser likely failed (historical band has been 15+ since 2020)`;
    console.warn(`[fatf-listing] parser sanity-check failed: ${msg}; previous valid payload remains under cache TTL`);
    console.warn(`[fatf-listing] diagnostic: ${previewBodyForDiagnostic(body)}`);
    throw new Error(msg);
  }

  return {
    listings,
    publicationDate: resolvePublicationDate(body, notice.updatedAt),
    counts: { black: blackCount, gray: grayCount },
    unmatchedCandidates: unmatched,
    attribution: ATTRIBUTION,
    sources: [
      {
        ...HMT_SOURCE,
        url: `${GOVUK_ORIGIN}${notice.basePath}`,
        apiUrl: `${GOVUK_CONTENT_API}${notice.basePath}`,
        noticeTitle: notice.title,
        noticeUpdatedAt: notice.updatedAt,
      },
      FATF_SOURCE,
    ],
    seededAt: new Date().toISOString(),
  };
}

export function validate(data) {
  if (typeof data?.listings !== 'object') return false;
  const counts = Object.values(data.listings);
  // At least 1 black-listed jurisdiction (DPRK has been on every FATF
  // call-for-action list since 2011) and at least 12 gray-listed.
  // Historical FATF grey-list size has been 15+ since 2020; floor of 12
  // catches a real upstream regression while absorbing list churn during
  // a plenary cycle.
  return counts.filter((s) => s === 'black').length >= 1 && counts.filter((s) => s === 'gray').length >= 12;
}

export function declareRecords(data) {
  return Object.keys(data?.listings || {}).length;
}

export {
  CANONICAL_KEY,
  CACHE_TTL,
  HMT_NOTICE_BASE_PATH,
  GOVUK_CONTENT_API,
  GREY_HEADING_FRAGMENT,
  BLACK_HEADING_FRAGMENT,
};

if (process.argv[1]?.endsWith('seed-fatf-listing.mjs')) {
  runSeed('economic', 'fatf-listing', CANONICAL_KEY, fetchFatfListings, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: `fatf-${new Date().getFullYear()}`,
    recordCount: (data) => Object.keys(data?.listings ?? {}).length,
    emptyDataIsFailure: true,
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 60480, // 42 days, > 1 plenary cycle
  }).catch((err) => {
    const _cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + _cause);
    process.exit(1);
  });
}
