#!/usr/bin/env node
/**
 * Runs the compiled indexer over a directory of real PowerBuilder exports and
 * reports what it managed to parse. Unlike the LSP smoke test (which uses
 * hand-written fixtures), this measures behaviour against production code.
 *
 *   node tools/corpus-check.js /path/to/extracted/source
 *
 * Exits non-zero if a file throws or if nothing at all was indexed.
 */
const fs = require('fs');
const path = require('path');

const { parseSymbols, POWERBUILDER_EXTENSIONS } = require('../out/server/indexer.js');
const { decodePBExport } = require('../out/server/encoding.js');
const { computeDiagnostics } = require('../out/server/diagnostics.js');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/corpus-check.js <corpus-dir>');
  process.exit(2);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (POWERBUILDER_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root);
const stats = {
  files: files.length,
  types: 0,
  functions: 0,
  subroutines: 0,
  events: 0,
  variables: 0,
  structures: 0,
  structureMembers: 0,
  continuationLines: 0,
  filesWithContinuations: 0,
  structuralDiagnostics: 0,
  filesWithStructuralDiagnostics: 0,
  errors: []
};

for (const file of files) {
  let text;
  try {
    text = decodePBExport(fs.readFileSync(file));
  } catch (e) {
    stats.errors.push(`${file}: decode: ${e.message}`);
    continue;
  }

  const contLines = (text.match(/&[ \t]*\r?\n/g) ?? []).length;
  if (contLines > 0) {
    stats.continuationLines += contLines;
    stats.filesWithContinuations++;
  }

  try {
    const { symbols, variables, structures } = parseSymbols(`file://${file}`, text);
    for (const s of symbols) {
      if (s.kind === 'type') stats.types++;
      else if (s.kind === 'function') stats.functions++;
      else if (s.kind === 'subroutine') stats.subroutines++;
      else if (s.kind === 'event') stats.events++;
    }
    stats.variables += variables.length;
    stats.structures += structures.length;
    stats.structureMembers += structures.reduce((n, s) => n + s.members.length, 0);
  } catch (e) {
    stats.errors.push(`${file}: parseSymbols: ${e.message}`);
    continue;
  }

  try {
    // Structural diagnostics on known-good production code should be silent;
    // anything reported here is a false positive in our block matcher.
    const diags = computeDiagnostics(text).filter((d) => d.severity <= 2);
    if (diags.length > 0) {
      stats.structuralDiagnostics += diags.length;
      stats.filesWithStructuralDiagnostics++;
      if (stats.errors.length < 40) {
        const first = diags[0];
        stats.errors.push(
          `${path.basename(file)}:${first.range.start.line + 1} ${first.message}`
        );
      }
    }
  } catch (e) {
    stats.errors.push(`${file}: diagnostics: ${e.message}`);
  }
}

console.log(`corpus: ${root}`);
console.log(`files indexed        : ${stats.files}`);
console.log(`  types              : ${stats.types}`);
console.log(`  functions          : ${stats.functions}`);
console.log(`  subroutines        : ${stats.subroutines}`);
console.log(`  events             : ${stats.events}`);
console.log(`  variables          : ${stats.variables}`);
console.log(`  structures         : ${stats.structures} (${stats.structureMembers} members)`);
console.log(`continuation lines   : ${stats.continuationLines} in ${stats.filesWithContinuations} files`);
console.log(
  `structural warnings  : ${stats.structuralDiagnostics} in ${stats.filesWithStructuralDiagnostics} files ` +
    `(false positives — this corpus compiles)`
);
if (stats.errors.length > 0) {
  console.log('\nfirst findings:');
  for (const e of stats.errors.slice(0, 15)) {
    console.log('  ' + e);
  }
}

const hardFailures = stats.errors.filter((e) => /parseSymbols|decode|diagnostics:/.test(e));
process.exit(hardFailures.length > 0 || stats.files === 0 ? 1 : 0);
