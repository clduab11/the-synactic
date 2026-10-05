/**
 * Parity guard for the brief-llm-core.js mirror.
 *
 * `shared/brief-llm-core.js` and `scripts/shared/brief-llm-core.js` are
 * byte-identical duplicates, not a symlink and not a re-export. They are
 * loaded by DIFFERENT consumers:
 *
 *   - `scripts/_insights-brief.mjs` imports './shared/brief-llm-core.js',
 *     which resolves to the scripts/ copy. That is the production seeder path
 *     (seed-loop-insights runs `node /repo/scripts/seed-insights.mjs`).
 *   - `tests/brief-llm-core.test.mjs` imports '../shared/brief-llm-core.js',
 *     the repo-root copy.
 *
 * So a fix applied to only the root copy makes the whole test suite go green
 * while production behaviour is completely unchanged — the most expensive
 * possible failure mode, because the green suite actively argues against
 * looking further. This suite exists so that state cannot survive CI.
 *
 * Same reasoning as tests/billing-marker-ttl-parity.test.mjs, whose comment
 * makes the companion point: cross-mirror equality alone is not sufficient if
 * a symmetric drift moves both files together. Byte-identity is the right
 * assertion HERE because the two files are supposed to be the same file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_COPY = resolve(ROOT, 'shared/brief-llm-core.js');
const SCRIPTS_COPY = resolve(ROOT, 'scripts/shared/brief-llm-core.js');

// Normalize line endings before comparing: this repo checks out CRLF on
// Windows and LF on CI, and a mixed-ending diff is noise, not drift.
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('brief-llm-core mirror parity', () => {
  it('both mirrors exist and are non-trivial', () => {
    for (const path of [ROOT_COPY, SCRIPTS_COPY]) {
      const text = read(path);
      assert.ok(text.length > 10_000, `${path} is unexpectedly small — is it a stub?`);
    }
  });

  it('the two mirrors are byte-identical', () => {
    const rootText = read(ROOT_COPY);
    const scriptsText = read(SCRIPTS_COPY);
    if (rootText === scriptsText) return;

    // Report the FIRST divergent line rather than dumping two 47 KB files.
    const a = rootText.split('\n');
    const b = scriptsText.split('\n');
    let line = 0;
    while (line < a.length && line < b.length && a[line] === b[line]) line += 1;
    assert.fail(
      `brief-llm-core mirrors diverged at line ${line + 1}.\n`
      + `  shared/:         ${JSON.stringify(a[line] ?? '<EOF>')}\n`
      + `  scripts/shared/: ${JSON.stringify(b[line] ?? '<EOF>')}\n`
      + '  Apply every edit to BOTH files. The seeder loads scripts/shared/;\n'
      + '  the tests load shared/. Patching one alone tests green and ships nothing.',
    );
  });

  it('the grounding-relaxation rule is present in the copy the SEEDER loads', () => {
    // Named explicitly rather than relying on byte-identity alone: if someone
    // ever reverts both mirrors together, byte-identity still passes. This
    // pins that the production path actually carries the fix.
    const scriptsText = read(SCRIPTS_COPY);
    assert.match(scriptsText, /isGroundedAfterRelaxation\(summarySeq, headlineSequences, headline\)/,
      'grounding relaxation ladder missing from the seeder-loaded mirror');
    assert.match(scriptsText, /occursAsContiguousRun/,
      'verbatim-run relaxation missing from the seeder-loaded mirror');
    assert.match(scriptsText, /matchesReorderedWindow/,
      'reordered-window relaxation missing from the seeder-loaded mirror');
    assert.doesNotMatch(scriptsText, /PROPER_NOUN_COORDINATOR/,
      'coordinator splitting must stay removed: a bridged "Johnson and Johnson" would launder against one surname');
    assert.match(scriptsText, /expandHyphenatedSequences/,
      'headline-side hyphen expansion missing from the seeder-loaded mirror');
  });
});
