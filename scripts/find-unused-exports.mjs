#!/usr/bin/env node
/**
 * AST-based unused-export finder.
 *
 * WHY THIS EXISTS. A session-12 cleanup pass used grep to decide which exports
 * were dead, then removed them with brace-matching. Both halves were wrong in
 * instructive ways:
 *
 *   - grep counts identifiers inside COMMENTS and STRING LITERALS, so a symbol
 *     named in a doc comment reads as "live" and survives forever.
 *   - brace-matching passed a balance assertion and still produced a
 *     syntactically broken file: a single-line `const` was cut mid-expression.
 *     BALANCE IS NOT VALIDITY. `tsc --noEmit` caught it; nothing else would.
 *
 * So this walks the TypeScript AST instead. Identifier references are counted
 * from real Identifier nodes, which means comments and strings cannot vote.
 *
 * It deliberately REPORTS ONLY and never edits. Removal needs a transform that
 * re-emits from the AST, and a report that a human reads is worth more than an
 * automated edit nobody reviews — the last attempt at the latter is the reason
 * this file exists.
 *
 * Usage:
 *   node scripts/find-unused-exports.mjs                  # whole repo
 *   node scripts/find-unused-exports.mjs src/services      # a subtree
 *   node scripts/find-unused-exports.mjs --json            # machine-readable
 *
 * ⚠ src-tauri/target is EXCLUDED and must stay excluded: it holds a full mirror
 * of src/ and api/, which would double every reference count and hide true
 * zeros behind their own copies.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', 'target', 'src-tauri',
  '.next', '.astro', 'generated', 'gen',
]);
const SOURCE_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const DECL_RE = /\.d\.(ts|mts|cts)$/;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const scopes = args.filter((a) => !a.startsWith('--'));

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (SOURCE_RE.test(entry.name) && !DECL_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
if (files.length < 500) {
  console.error(`ABORT — only ${files.length} source files found; the walker is probably broken.`);
  process.exit(1);
}

/** Parse once, reuse for both passes. */
const parsed = new Map();
for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  parsed.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
}

/** Exported declaration names in one source file, with their line numbers. */
function exportsOf(sourceFile) {
  const found = [];
  const isExported = (node) => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
  const record = (name, node) => {
    if (!name) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ name, line: line + 1 });
  };
  sourceFile.forEachChild((node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && isExported(node)) {
      record(node.name?.text, node);
    } else if (ts.isVariableStatement(node) && isExported(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) record(d.name.text, d);
      }
    } else if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && isExported(node)) {
      record(node.name.text, node);
    }
  });
  return found;
}

/** Every identifier used in a file, as a multiset. Comments/strings excluded. */
function identifiersOf(sourceFile) {
  const counts = new Map();
  const visit = (node) => {
    if (ts.isIdentifier(node)) counts.set(node.text, (counts.get(node.text) ?? 0) + 1);
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return counts;
}

const identifierIndex = new Map();
for (const [file, sf] of parsed) identifierIndex.set(file, identifiersOf(sf));

const inScope = (file) => scopes.length === 0
  || scopes.some((s) => relative(ROOT, file).split(sep).join('/').startsWith(s.replace(/\\/g, '/')));

const results = [];
for (const [file, sf] of parsed) {
  if (!inScope(file)) continue;
  const rel = relative(ROOT, file).split(sep).join('/');
  for (const { name, line } of exportsOf(sf)) {
    let external = 0;
    let firstUse = null;
    for (const [other, counts] of identifierIndex) {
      if (other === file) continue;
      const n = counts.get(name);
      if (n) { external += n; if (!firstUse) firstUse = relative(ROOT, other).split(sep).join('/'); }
    }
    if (external === 0) results.push({ file: rel, line, name });
    else if (asJson) results.push({ file: rel, line, name, refs: external, firstUse });
  }
}

const dead = results.filter((r) => r.refs === undefined);

if (asJson) {
  console.log(JSON.stringify({ scanned: parsed.size, dead }, null, 2));
} else {
  console.log(`scanned ${parsed.size} source files (src-tauri/target excluded)`);
  console.log(`${dead.length} export(s) with ZERO references outside their own file\n`);
  let current = '';
  for (const d of dead.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    if (d.file !== current) { current = d.file; console.log(`  ${current}`); }
    console.log(`    :${String(d.line).padEnd(5)} ${d.name}`);
  }
  if (dead.length) {
    console.log('\nNOTE: zero references is a CANDIDATE, not a verdict.');
    console.log('  - a public API surface is meant to be unreferenced internally;');
    console.log('  - dynamic access (obj[name]) is invisible to this pass;');
    console.log('  - both files touched in session 12 are UPSTREAM, and deleting from');
    console.log('    upstream code makes every future merge conflict. Weigh that first.');
  }
}
