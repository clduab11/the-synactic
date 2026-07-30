#!/usr/bin/env node
/**
 * One-shot bounded ACLED capture → oracle fixture.
 *
 * Mints a token, pulls a deliberately small slice, and writes it to
 * tests/fixtures/oracle/acled/. That fixture then backs all development, so
 * this script should run once — not on a schedule.
 *
 * Usage:
 *   ACLED_USERNAME="you@example.com" ACLED_PASSWORD="…" \
 *     node scripts/capture-acled-fixture.mjs --country Angola --limit 50
 *
 * Flags:
 *   --country <name>   ACLED country name (e.g. "Angola"). Optional.
 *   --limit <n>        Records to capture. Default 50, hard-capped at 200 here
 *                      — this is an integration check, not a backfill.
 *   --since <date>     ISO date lower bound on event_date. Optional.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAcledEvents, ACLED_FIXTURE_PATH } from './_acled-source.mjs';

const CAPTURE_CAP = 200;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--country') out.country = argv[++i];
    else if (argv[i] === '--limit') out.limit = Number(argv[++i]);
    else if (argv[i] === '--since') out.since = argv[++i];
  }
  return out;
}

const { country, limit = 50, since } = parseArgs(process.argv);

if (!Number.isInteger(limit) || limit < 1 || limit > CAPTURE_CAP) {
  console.error(
    `ERROR: --limit must be 1..${CAPTURE_CAP}. This script captures a fixture, ` +
      'not a dataset. See CONTEXT.md on the pre-licence posture.',
  );
  process.exit(1);
}

// Force live regardless of ambient ACLED_MODE — capturing is the one thing
// that must hit the network, and it should be explicit about it.
process.env.ACLED_MODE = 'live';

const result = await getAcledEvents({ country, limit, since });

mkdirSync(dirname(ACLED_FIXTURE_PATH), { recursive: true });
writeFileSync(ACLED_FIXTURE_PATH, JSON.stringify(result, null, 2) + '\n');

const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
console.log(`wrote ${ACLED_FIXTURE_PATH}`);
console.log(`  records: ${result.count}`);
console.log(`  bytes:   ${bytes} (compact JSON)`);
console.log(`  request: ${JSON.stringify(result._request)}`);
console.log('');
console.log('Development is now fixture-backed. Leave ACLED_MODE unset (defaults to fixture).');
console.log('This fixture is licensed content held pre-licence — do not commit it.');
console.log('Add to .gitignore:  tests/fixtures/oracle/acled/');
