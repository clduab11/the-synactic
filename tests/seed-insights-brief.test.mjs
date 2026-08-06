import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBriefCluster,
  briefSystemPrompt,
  briefUserPrompt,
  splitLeadSentences,
} from '../scripts/_insights-brief.mjs';

describe('pickBriefCluster', () => {
  it('returns null for empty/non-array input', () => {
    assert.equal(pickBriefCluster([]), null);
    assert.equal(pickBriefCluster(null), null);
    assert.equal(pickBriefCluster(undefined), null);
  });

  it('returns null when every cluster is single-source', () => {
    const top = [
      { sourceCount: 3, sources: ['Reuters'], primaryTitle: 'A' },
      { sourceCount: 1, sources: ['AP News'], primaryTitle: 'B' },
    ];
    assert.equal(pickBriefCluster(top), null);
  });

  it('returns the first cluster with at least two unique sources', () => {
    const top = [
      { sourceCount: 3, sources: ['Reuters'], primaryTitle: 'A' },
      { sourceCount: 3, sources: ['Reuters', 'AP News'], primaryTitle: 'B' },
      { sourceCount: 2, sources: ['BBC World', 'Axios'], primaryTitle: 'C' },
    ];
    assert.equal(pickBriefCluster(top).primaryTitle, 'B');
  });

  it('accepts a single-cluster source when entity corroboration was established across related clusters', () => {
    const top = [
      { sourceCount: 1, sources: ['Reuters'], entityCorroboration: true, primaryTitle: 'US and Iran close deal' },
    ];
    assert.equal(pickBriefCluster(top).primaryTitle, 'US and Iran close deal');
  });

  it('skips a higher-ranked single-source rumor for a lower-ranked multi-sourced lead (regression: News24 Iran supreme leader 2026-04-23)', () => {
    const top = [
      {
        sourceCount: 1,
        sources: ['News24'],
        primaryTitle: 'Iran new supreme leader seriously wounded, delegates power to Revolutionary Guards',
        importanceScore: 350,
      },
      {
        sourceCount: 2,
        sources: ['Reuters', 'AP News'],
        primaryTitle: 'Lebanon leaders accuse Israel of war crime after journalist killed',
        importanceScore: 300,
      },
    ];
    const picked = pickBriefCluster(top);
    assert.ok(picked, 'expected a multi-source cluster to be picked');
    assert.match(picked.primaryTitle, /Lebanon/);
    assert.doesNotMatch(picked.primaryTitle, /supreme leader/);
  });

  it('treats a missing sourceCount as 1 (safe default — do not brief on unknown corroboration)', () => {
    const top = [
      { primaryTitle: 'A' }, // no sourceCount field
      { sourceCount: 2, sources: ['Reuters', 'AP News'], primaryTitle: 'B' },
    ];
    assert.equal(pickBriefCluster(top).primaryTitle, 'B');
  });

  it('tolerates a null/undefined entry without throwing', () => {
    const top = [null, undefined, { sourceCount: 2, sources: ['Reuters', 'AP News'], primaryTitle: 'A' }];
    assert.equal(pickBriefCluster(top).primaryTitle, 'A');
  });
});

describe('briefSystemPrompt', () => {
  const prompt = briefSystemPrompt('2026-04-24');

  it('includes the injected date', () => {
    assert.match(prompt, /2026-04-24/);
  });

  it('forbids inventing facts absent from the headline', () => {
    assert.match(prompt, /Use ONLY facts present/);
    assert.match(prompt, /Do not invent proper nouns/);
  });

  it('makes location conditional — no unconditional "WHERE" directive', () => {
    // Regression: P2 review finding. "Lead with WHAT happened and WHERE" + "use ONLY facts"
    // conflicted for headlines with no location, pushing the model to confabulate one.
    assert.doesNotMatch(prompt, /Lead with WHAT happened and WHERE/);
    assert.match(prompt, /ONLY if it appears in the headline/);
  });

  it('does not ask the LLM to rank/pick from multiple headlines', () => {
    // Regression: the original prompt said "Pick the ONE most significant headline".
    // Ranking is now done by pickBriefCluster upstream.
    assert.doesNotMatch(prompt, /Pick the ONE most significant/);
    assert.doesNotMatch(prompt, /Each numbered headline/i);
    assert.doesNotMatch(prompt, /summarize ONLY that story/i);
  });
});

describe('briefUserPrompt', () => {
  it('passes the headline verbatim', () => {
    const headline = 'Iran launches missile strikes on targets in Syria';
    const out = briefUserPrompt(headline);
    assert.ok(out.includes(headline));
  });

  it('instructs using only facts from the provided headline', () => {
    assert.match(briefUserPrompt('X'), /only facts from this headline/i);
  });
});

describe('splitLeadSentences', () => {
  // Regression for the live INSIGHTS_SYNTHESIS_GATE/LEAD_UNCITED failure whose
  // debug detail was literally "U.S." — the old /(?<=[.!?])\s+/ split turned a
  // correct, fully-cited lead into an uncitable fragment and rejected the brief.
  it('does not split inside dotted acronyms', () => {
    assert.deepEqual(
      splitLeadSentences('U.S. and Iran resumed talks [1].'),
      ['U.S. and Iran resumed talks [1].'],
    );
    for (const acronym of ['U.K.', 'E.U.', 'D.C.', 'U.N.']) {
      const lead = `${acronym} officials met [2].`;
      assert.deepEqual(splitLeadSentences(lead), [lead], `${acronym} must stay whole`);
    }
  });

  it('does not split after common abbreviations', () => {
    for (const lead of [
      'Dr. Smith briefed reporters [1].',
      'The Sept. 4 deadline passed [2].',
      'Acme Corp. issued a statement [3].',
      'Sen. Doe objected [1].',
    ]) {
      assert.deepEqual(splitLeadSentences(lead), [lead]);
    }
  });

  // The gate still needs real multi-sentence leads split, or per-sentence
  // citation and grounding checks would collapse into one permissive pass.
  it('still splits genuine sentence boundaries', () => {
    assert.deepEqual(
      splitLeadSentences('Talks resumed [1]. Markets rallied [2].'),
      ['Talks resumed [1].', 'Markets rallied [2].'],
    );
    assert.deepEqual(
      splitLeadSentences('Did talks resume [1]? Markets rallied [2]!'),
      ['Did talks resume [1]?', 'Markets rallied [2]!'],
    );
    assert.equal(splitLeadSentences('Output fell in 2026. The trend held [1].').length, 2);
  });

  // #4928 union hazard: a sentence ending in a dotted acronym whose citation
  // FOLLOWS the period ("…the U.S. [1]") must still end there. Merging it with
  // the next sentence produces one unit citing {1,2}, whose proper nouns then
  // ground against the UNION of both stories — each claim can borrow the other
  // claim's source, the exact shape-valid misattribution #4928 closed. The
  // single-capital lookbehind alone under-splits here; the citation run after
  // the acronym is what marks the boundary as real.
  it('splits after a sentence-final acronym that carries its citation', () => {
    const sentences = splitLeadSentences(
      'Strikes were carried out by the U.S. [1] GCC states condemned Iranian attacks on Kuwait [2].',
    );
    assert.equal(sentences.length, 2, `expected 2 units, got: ${JSON.stringify(sentences)}`);
    assert.match(sentences[0], /U\.S\./);
    assert.match(sentences[0], /\[1\]/, 'the citation must stay with the sentence it closes');
    assert.doesNotMatch(sentences[0], /GCC/);
    assert.match(sentences[1], /^GCC/);
    assert.match(sentences[1], /\[2\]/);
  });

  it('returns [] for non-string or empty input', () => {
    assert.deepEqual(splitLeadSentences(null), []);
    assert.deepEqual(splitLeadSentences(''), []);
    assert.deepEqual(splitLeadSentences('   '), []);
  });
});
