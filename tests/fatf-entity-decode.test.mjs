// Pin the list-item entity decode in seed-fatf-listing.mjs: one pass must
// decode exactly ONE level. The old hand-rolled decoder replaced `&amp;`
// BEFORE `&lt;/&gt;`, so `&amp;lt;script&amp;gt;` (publisher-escaped literal
// text) came out as live `<script>` markup.
//
// The observable seam moved with the re-source: HM Treasury's GOV.UK notice
// renders each jurisdiction as a plain `<li>Name</li>` under an h4, not as an
// `<a href="/en/countries/detail/...">` anchor the way fatf-gafi.org did.
// Unmatched item text still surfaces via `unmatchedCandidates`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractListedCountries,
  extractFirstListItems,
  buildNameLookup,
  BLACK_HEADING_FRAGMENT,
} from '../scripts/seed-fatf-listing.mjs';

const nameLookup = buildNameLookup();

// Minimal govspeak-shaped notice body with one list item under the black-list
// heading. Goes through the full heading-scope -> first-<ul> -> decode path.
function noticeBody(...itemsHtml) {
  return `<h4 id="high-risk-jurisdictions-subject-to-a-call-for-action">High-Risk Jurisdictions subject to a Call for Action</h4>\n<ul>\n${itemsHtml
    .map((html) => `  <li>${html}</li>`)
    .join('\n')}\n</ul>`;
}

function unmatchedFor(itemHtml) {
  const { unmatchedCandidates } = extractListedCountries(
    noticeBody(itemHtml),
    nameLookup,
    BLACK_HEADING_FRAGMENT,
  );
  return [...unmatchedCandidates];
}

describe('list-item text decode: exactly one level', () => {
  it('does not double-decode &amp;lt; into live markup', () => {
    // Literal item text `&lt;script&gt;` escapes to `&amp;lt;script&amp;gt;`.
    // Replacing `&amp;` first would yield `<script>`.
    assert.deepEqual(
      unmatchedFor('XSS via &amp;lt;script&amp;gt; in template'),
      ['XSS via &lt;script&gt; in template'],
    );
  });

  it('still decodes a single level of the entities govspeak emits', () => {
    assert.deepEqual(
      unmatchedFor('A &amp; B &lt;C&gt; &#39;quoted&#39;'),
      ['A & B <C> \'quoted\''],
    );
  });

  it('decodes &amp;amp; to a single literal &amp;', () => {
    assert.deepEqual(unmatchedFor('Tom &amp;amp; Jerry'), ['Tom &amp; Jerry']);
  });

  it('preserves out-of-range numeric references instead of throwing or welding text', () => {
    assert.deepEqual(unmatchedFor('a&#999999999;b'), ['a&#999999999;b']);
  });

  it('strips inline markup before decoding, so escaped angle brackets stay literal', () => {
    // Tag-strip runs first: a real <em> wrapper is removed, but the escaped
    // sequence inside it survives as text.
    assert.deepEqual(extractFirstListItems('<ul><li><em>&amp;lt;b&amp;gt;</em></li></ul>'), ['&lt;b&gt;']);
  });

  it('round-trips a real country with an escaped apostrophe into the lookup', () => {
    const { listed, unmatchedCandidates } = extractListedCountries(
      noticeBody('C&#244;te d&#39;Ivoire'),
      nameLookup,
      BLACK_HEADING_FRAGMENT,
    );
    assert.deepEqual([...listed], ['CI']);
    assert.equal(unmatchedCandidates.size, 0);
  });

  it("round-trips GOV.UK's literal typographic apostrophe (U+2019), which govspeak emits unescaped", () => {
    const { listed, unmatchedCandidates } = extractListedCountries(
      noticeBody('Democratic People’s Republic of Korea'),
      nameLookup,
      BLACK_HEADING_FRAGMENT,
    );
    assert.deepEqual([...listed], ['KP']);
    assert.equal(unmatchedCandidates.size, 0);
  });
});
