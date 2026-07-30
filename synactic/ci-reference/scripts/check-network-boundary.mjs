#!/usr/bin/env node
/**
 * Network-boundary guard (Phase 1 policy).
 *
 * Scans packages/*\/src and services/*\/src (.ts/.mts, excluding *.test.ts and
 * node_modules) and fails if any file:
 *   - imports/requires node:http, node:https, node:net, node:dns (also the
 *     bare-specifier forms and subpaths like node:dns/promises)
 *   - imports/requires undici
 *   - uses an http: or https: URL specifier in an import/export statement
 *   - calls the bare global fetch(
 *
 * Run from the repo root:  node .github/scripts/check-network-boundary.mjs
 * Exits 0 when clean, 1 with a per-violation report otherwise.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const SCAN_ROOTS = ['packages', 'services'];

/** Specifiers that violate the Phase 1 no-network rule. */
const BANNED_SPECIFIER_PATTERNS = [
  /^(?:node:)?http(?:\/.*)?$/,
  /^(?:node:)?https(?:\/.*)?$/,
  /^(?:node:)?net(?:\/.*)?$/,
  /^(?:node:)?dns(?:\/.*)?$/,
  /^https?:\/\//, // URL specifiers (e.g. https://esm.sh/x)
  /^https?:$/, // bare http:/https: scheme specifiers
  /^undici(?:\/.*)?$/,
];

const SPECIFIER_REGEXES = [
  /\bimport\s+(?!\s*\()(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g, // static / side-effect import
  /\bexport\s+(?:[\s\S]*?\s+from\s+)["']([^"']+)["']/g, // export ... from
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import()
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // CJS require()
];

const BARE_FETCH_REGEX = /(?<![\w$.)\]"'])fetch\s*\(/g;

/**
 * Single-pass scanner: blanks out comments (and, optionally, string/regex
 * contents) with spaces while preserving newlines, so match offsets still map
 * to correct line numbers. String-aware, so `//` inside a string literal is
 * not mistaken for a comment.
 */
function maskSource(code, { keepStrings = false } = {}) {
  const out = code.split('');
  let i = 0;
  let state = 'code'; // 'code' | 'line' | 'block' | 'string'
  let quote = '';
  const blank = (idx) => {
    if (out[idx] !== '\n') out[idx] = ' ';
  };
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') {
        blank(i);
        blank(i + 1);
        state = 'line';
        i += 2;
      } else if (c === '/' && n === '*') {
        blank(i);
        blank(i + 1);
        state = 'block';
        i += 2;
      } else if (c === "'" || c === '"' || c === '`') {
        if (!keepStrings) blank(i);
        quote = c;
        state = 'string';
        i++;
      } else {
        i++;
      }
    } else if (state === 'line') {
      if (c === '\n') {
        state = 'code';
      } else {
        blank(i);
      }
      i++;
    } else if (state === 'block') {
      if (c === '*' && n === '/') {
        blank(i);
        blank(i + 1);
        state = 'code';
        i += 2;
      } else {
        blank(i);
        i++;
      }
    } else {
      // string
      if (c === '\\') {
        if (!keepStrings) {
          blank(i);
          blank(i + 1);
        }
        i += 2;
      } else if (c === quote) {
        if (!keepStrings) blank(i);
        state = 'code';
        i++;
      } else {
        if (!keepStrings) blank(i);
        i++;
      }
    }
  }
  return out.join('');
}

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (code[i] === '\n') line++;
  return line;
}

/** Recursively collect .ts/.mts files under dir, skipping node_modules/build output and *.test.ts. */
function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.mts$|\.ts$/.test(entry) && !/\.test\.(ts|mts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** @returns {string[]} source files under <repo>/<root>/<workspace>/src */
function findWorkspaceSources() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const rootDir = join(repoRoot, root);
    if (!existsSync(rootDir)) continue;
    for (const workspace of readdirSync(rootDir)) {
      const srcDir = join(rootDir, workspace, 'src');
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
        files.push(...collectSourceFiles(srcDir));
      }
    }
  }
  return files;
}

const violations = [];
const files = findWorkspaceSources();

for (const file of files) {
  const rel = relative(repoRoot, file);
  const raw = readFileSync(file, 'utf8');
  const commentsMasked = maskSource(raw, { keepStrings: true });

  for (const regex of SPECIFIER_REGEXES) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(commentsMasked)) !== null) {
      const specifier = match[1];
      if (BANNED_SPECIFIER_PATTERNS.some((p) => p.test(specifier))) {
        violations.push(
          `${rel}:${lineOf(commentsMasked, match.index)} — banned network specifier "${specifier}"`,
        );
      }
    }
  }

  const fullyMasked = maskSource(raw, { keepStrings: false });
  BARE_FETCH_REGEX.lastIndex = 0;
  let fetchMatch;
  while ((fetchMatch = BARE_FETCH_REGEX.exec(fullyMasked)) !== null) {
    violations.push(
      `${rel}:${lineOf(fullyMasked, fetchMatch.index)} — bare global fetch() call`,
    );
  }
}

if (violations.length > 0) {
  console.error(
    `Network-boundary guard FAILED: ${violations.length} violation(s) in packages/*/src, services/*/src.\n` +
      'Phase 1 policy forbids node:http, node:https, node:net, node:dns, undici, URL import specifiers, and bare fetch().\n',
  );
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(
  `Network-boundary guard passed: ${files.length} source file(s) scanned, no network imports or bare fetch() usage found.`,
);
