#!/usr/bin/env node
/**
 * DEFCON readiness-estimate seed — defconlevel.com OSINT estimate.
 *
 * PROVENANCE, read before touching this file:
 *
 * The United States does not publish the current DEFCON level. It moves through
 * classified National Command Authority channels and becomes public only after
 * declassification or congressional testimony. defconlevel.com says so itself on
 * the page this seeder reads: "No government agency publishes the current DEFCON
 * level ... an OSINT-based estimate, not an official government disclosure."
 *
 * What this seeder collects is therefore a THIRD-PARTY OSINT ESTIMATE by a private
 * organization (founded 2013, Donald Standeford, "Not affiliated with the U.S.
 * Government"). Every record carries that framing in-band so no consumer -- human
 * or LLM -- can mistake it for a reading. Do not add a field, label, or locale
 * string that calls this "official".
 *
 * COLLECTION POSTURE (CONTEXT.md boundary 2):
 *   - Their robots.txt Allows "/" and Disallows "/api/". We read the homepage only.
 *     Do NOT point this at their JSON API -- that is a published control, and
 *     defeating it to take more than they permit is out of scope by boundary 2.
 *   - Honest UA, one request per seeder run. Crawl-delay is 1s; the seed-loop
 *     cycle is 45 min, so we are ~2700x gentler than their stated floor.
 *
 * MCP REDISTRIBUTION IS PERMITTED, WITH ONE CONDITION.
 *
 * This was dashboard-only until 2026-08-03 pending a licensing answer, because
 * displaying a public page in our own dashboard is ordinary use while re-serving
 * a third party's assessment to downstream consumers is a separate right. The
 * publisher was asked through their named channel (contact@defconlevel.com --
 * the Kraken precedent: use the channel, do not assume) and granted it, subject
 * to: **no model TRAINING on this data.** Inference and analysis are fine.
 *
 * That condition is carried IN-BAND on every record (`usageRestrictions`) rather
 * than left in prose, because the consumer here is a machine. Do not strip it,
 * and do not let a projection drop it silently -- it is the only thing travelling
 * with the data that states the term we agreed to.
 *
 * Provenance: the permission is owner-relayed rather than an attached artifact.
 * Not treated as urgent -- the owner is the sole consumer of this surface. If
 * that ever changes, or the `usageRestrictions` wording is quoted outward, pin
 * it to the original email first. See CONTEXT.md boundary 4 / v6.
 *
 * FAILS LOUDLY. If the global level will not parse, this throws rather than
 * publishing a default. A fabricated "DEFCON 5" is exactly the defect class
 * CONTEXT.md:18 exists to prevent.
 */

import { loadEnvFile, HONEST_UA, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:defcon-level:seed:v1';
const SOURCE_URL = 'https://www.defconlevel.com/';
const CACHE_TTL = 10800; // 3h -- survives several 45-min seed-loop cycles
const FETCH_TIMEOUT_MS = 20_000;

/**
 * defconlevel.com lists three thematic trackers alongside the eleven real US
 * unified combatant commands. They are theirs, not DoD structure, and the UI
 * must not present them as peers. Keyed by their /alerts/ slug.
 */
const SYNTHETIC_COMMANDS = new Set([
  'biological-command',
  'disaster-command',
  'financial-command',
]);

function parseLevel(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function parseCommands(html) {
  const nav = /<nav class="regional-menu-bar"[\s\S]*?<\/nav>/i.exec(html);
  if (!nav) return [];

  const linkRe = /<a\s+href="\/alerts\/([^"]+)"[^>]*title="([^"]*)"[^>]*>\s*<span class="regional-link-text">([^<]+)<\/span>/gi;
  const commands = [];
  let m;
  while ((m = linkRe.exec(nav[0]))) {
    const [, slug, title, abbr] = m;
    const level = parseLevel((/DEFCON\s*(\d)/i.exec(title) || [])[1]);
    if (level === null) continue;
    commands.push({
      id: slug,
      abbr: abbr.trim(),
      // Their title is "<Name> - DEFCON <n>"; keep only the name.
      name: title.replace(/\s*-\s*DEFCON\s*\d\s*$/i, '').trim(),
      level,
      // False for defconlevel's own thematic trackers. The UI groups on this.
      isCombatantCommand: !SYNTHETIC_COMMANDS.has(slug),
      sourceUrl: `${SOURCE_URL.replace(/\/$/, '')}/alerts/${slug}`,
    });
  }
  return commands;
}

async function fetchDefconLevel() {
  const resp = await fetch(SOURCE_URL, {
    headers: { Accept: 'text/html', 'User-Agent': HONEST_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`defconlevel.com HTTP ${resp.status}`);

  const html = await resp.text();

  const level = parseLevel((/<span class="home-hero-eyebrow-level">\s*DEFCON\s*(\d)\s*<\/span>/i.exec(html) || [])[1]);
  if (level === null) {
    // Their markup changed. Publishing a guess here would put an invented
    // readiness number in front of a human. Fail and let health go STALE_SEED.
    throw new Error('defconlevel.com: global level did not parse (markup changed?)');
  }

  const updatedRaw = (/<time datetime="([^"]+)"[^>]*itemprop="dateModified"/i.exec(html) || [])[1] || null;
  const sourceUpdatedAt = updatedRaw && !Number.isNaN(Date.parse(updatedRaw))
    ? new Date(updatedRaw).toISOString()
    : null;

  const commands = parseCommands(html);

  return {
    level,
    // Never "official". This wording is load-bearing -- see the header.
    estimateType: 'osint-estimate',
    officialStatus: 'classified-not-published',
    sourceName: 'DEFCON Level (defconlevel.com)',
    sourceUrl: SOURCE_URL,
    sourceOperator: 'Private OSINT organization; not affiliated with the U.S. Government',
    // The licence condition, carried with the data so an MCP consumer cannot
    // receive the records without also receiving the term. See the header note.
    usageRestrictions: {
      training: 'prohibited',
      redistribution: 'permitted',
      note: 'Publisher permits redistribution of this estimate, including over MCP, for inference and analysis. Using it as training data for a model is NOT permitted.',
    },
    sourceUpdatedAt,
    fetchedAt: new Date().toISOString(),
    commands,
    combatantCommandCount: commands.filter((c) => c.isCombatantCommand).length,
    syntheticCommandCount: commands.filter((c) => !c.isCombatantCommand).length,
  };
}

function validate(data) {
  return Number.isInteger(data?.level) && data.level >= 1 && data.level <= 5;
}

export function declareRecords(data) {
  return Array.isArray(data?.commands) ? data.commands.length : 0;
}

runSeed('intelligence', 'defcon-level', CANONICAL_KEY, fetchDefconLevel, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'defconlevel-home-scrape-v1',
  recordCount: (data) => (Array.isArray(data?.commands) ? data.commands.length : 0),
  declareRecords,
  schemaVersion: 1,
  maxStaleMin: 180,
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
