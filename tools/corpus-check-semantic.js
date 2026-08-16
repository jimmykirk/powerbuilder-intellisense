#!/usr/bin/env node
/**
 * Like corpus-check.js, but exercises the *semantic* diagnostics path
 * (unknown-call / arg-count / literal-type / undeclared-assignment checks)
 * by building a real cross-file WorkspaceIndex over the whole corpus first,
 * then running computeDiagnostics(text, semanticContext) per file — mirroring
 * buildSemanticContext() in server/server.ts as closely as possible without
 * the LSP connection plumbing.
 *
 *   node tools/corpus-check-semantic.js /path/to/extracted/source
 *
 * Reports counts bucketed by diagnostic message shape so genuine false
 * positives (bugs in our resolution logic) can be told apart from expected
 * noise (calls into 3rd-party DLLs/COM/OCX objects we can't index).
 */
const fs = require('fs');
const path = require('path');

const { parseVariableDeclaration, POWERBUILDER_EXTENSIONS, WorkspaceIndex } = require('../out/server/indexer.js');
const { decodePBExport } = require('../out/server/encoding.js');
const { computeDiagnostics } = require('../out/server/diagnostics.js');
const { toStatements } = require('../out/server/preprocess.js');
const {
  findBuiltin2025,
  findBuiltinEvent2025,
  findDWMethod2025,
  findDWEvent2025,
  propertyMap2025,
  enumMap2025
} = require('../out/server/builtins-2025.js');
const { findBuiltin2022, findBuiltinEvent2022 } = require('../out/server/builtins-2022.js');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/corpus-check-semantic.js <corpus-dir>');
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
console.log(`corpus: ${root} (${files.length} files)`);

// --- Pass 1: build a real cross-file workspace index -----------------------
const index = new WorkspaceIndex();
let decodeErrors = 0;
for (const file of files) {
  let text;
  try {
    text = decodePBExport(fs.readFileSync(file));
  } catch {
    decodeErrors++;
    continue;
  }
  try {
    index.updateDocument(`file://${file}`, text);
  } catch {
    // parseSymbols already exercised in corpus-check.js; ignore here.
  }
}
console.log(`indexed ${files.length - decodeErrors} files into workspace index`);

// --- Semantic context, mirroring buildSemanticContext() in server.ts -------
const PRONOUNS = new Set([
  'this', 'parent', 'super', 'sqlca', 'sqlda', 'sqlsa', 'error', 'message', 'parentwindow'
]);

let anyPropertyNamesCache = null;
function anyPropertyNames() {
  if (!anyPropertyNamesCache) {
    const names = new Set();
    for (const props of propertyMap2025.values()) {
      for (const p of props) {
        names.add(p.name.toLowerCase());
      }
    }
    anyPropertyNamesCache = names;
  }
  return anyPropertyNamesCache;
}

function trustworthySignature(name) {
  const fn = findBuiltin2025(name) ?? findDWMethod2025(name);
  if (!fn || fn.variadic || (fn.variants?.length ?? 0) > 1 || index.find(name).length > 0) {
    return undefined;
  }
  return fn;
}

// Mirrors trustworthyParams() in server/server.ts: a bare call to a member
// function may pass the receiver explicitly as the first argument (e.g.
// `TriggerEvent(this, "ue_init")`), so prepend a synthetic receiver slot.
function trustworthyParams(name) {
  const fn = trustworthySignature(name);
  if (!fn) {
    return undefined;
  }
  return fn.member ? [{ name: 'receiver', type: 'any' }, ...fn.params] : fn.params;
}

// Mirrors trustworthyRawParams() in server/server.ts: the implicit-self (no
// receiver at all) interpretation of a bare call to a member function.
function trustworthyRawParams(name) {
  const fn = trustworthySignature(name);
  return fn?.member ? fn.params : undefined;
}

function buildSemanticContext(text) {
  const localNames = new Set();
  const statements = toStatements(text.split(/\r?\n/));
  for (const stmt of statements) {
    for (const decl of parseVariableDeclaration(stmt.text, stmt.line, '', 'local')) {
      localNames.add(decl.name.toLowerCase());
    }
    const proto = /^\s*(?:(?:public|private|protected|global)\s+)*(?:function|subroutine|event)\b[^(]*\(([^)]*)\)/i.exec(stmt.text);
    if (proto && proto[1].trim()) {
      for (const segment of proto[1].split(',')) {
        const tokens = segment.trim().split(/\s+/).filter((t) => !/^(ref|readonly)$/i.test(t));
        const name = tokens[tokens.length - 1]?.replace(/\[.*$/, '');
        if (name && /^[A-Za-z_]\w*$/.test(name)) {
          localNames.add(name.toLowerCase());
        }
      }
    }
    const caught = /\bcatch\s*\(\s*\w+\s+(\w+)\s*\)/i.exec(stmt.text);
    if (caught) {
      localNames.add(caught[1].toLowerCase());
    }
  }

  return {
    version: '2025',
    isKnown: (name) =>
      !!findBuiltin2025(name) ||
      !!findBuiltinEvent2025(name) ||
      !!findDWMethod2025(name) ||
      !!findDWEvent2025(name) ||
      index.find(name).length > 0 ||
      index.findVariables(name).length > 0 ||
      localNames.has(name.toLowerCase()),
    versionNote: (name) => {
      const other = findBuiltin2022(name) ?? findBuiltinEvent2022(name);
      if (!other) {
        return undefined;
      }
      return `'${other.name}' is not available in PowerBuilder 2025 — it was removed after PB 2022.`;
    },
    maxArgs: (name) => trustworthyParams(name)?.length,
    paramTypesOf: (name) => trustworthyParams(name)?.map((p) => p.type),
    refParamsOf: (name) => trustworthyParams(name)?.map((p) => !!p.ref),
    rawMaxArgs: (name) => trustworthyRawParams(name)?.length,
    rawParamTypesOf: (name) => trustworthyRawParams(name)?.map((p) => p.type),
    rawRefParamsOf: (name) => trustworthyRawParams(name)?.map((p) => !!p.ref),
    enumNameOf: (valueToken) => {
      const lower = valueToken.toLowerCase();
      for (const en of enumMap2025.values()) {
        if (en.values.some((v) => v.toLowerCase() === lower)) {
          return en.name;
        }
      }
      return undefined;
    },
    isEnumType: (typeName) => enumMap2025.has(typeName.toLowerCase()),
    isDeclaredIdentifier: (name) => {
      const lower = name.toLowerCase();
      return (
        localNames.has(lower) ||
        index.findVariables(name).length > 0 ||
        PRONOUNS.has(lower) ||
        anyPropertyNames().has(lower)
      );
    }
  };
}

// --- Pass 2: run diagnostics with the semantic context ----------------------
function bucketOf(message) {
  if (/is not available in PowerBuilder/.test(message)) return 'version-note (removed/added between versions)';
  if (/^Unknown function/.test(message)) return 'unknown-function (Information, filtered out)';
  if (/accepts at most/.test(message)) return 'arg-count-exceeded';
  if (/passed by reference and must be a variable/.test(message)) return 'ref-param-literal-mismatch';
  if (/^Argument \d+ of/.test(message)) return 'literal-type-mismatch';
  if (/is assigned but never declared/.test(message)) return 'undeclared-assignment';
  return 'structural (unexpected — should be 0)';
}

const buckets = new Map();
const samples = new Map();
let total = 0;
let filesWithFindings = 0;
let errors = 0;

for (const file of files) {
  let text;
  try {
    text = decodePBExport(fs.readFileSync(file));
  } catch {
    errors++;
    continue;
  }
  let diags;
  try {
    const semantic = buildSemanticContext(text);
    diags = computeDiagnostics(text, semantic).filter((d) => d.severity <= 2);
  } catch (e) {
    errors++;
    continue;
  }
  if (diags.length > 0) {
    filesWithFindings++;
    total += diags.length;
    for (const d of diags) {
      const bucket = bucketOf(d.message);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      if (!samples.has(bucket)) {
        samples.set(bucket, []);
      }
      const arr = samples.get(bucket);
      if (arr.length < 8) {
        arr.push(`${path.basename(file)}:${d.range.start.line + 1} ${d.message}`);
      }
    }
  }
}

console.log(`\nsemantic warnings (severity <= Warning): ${total} in ${filesWithFindings} files`);
if (errors > 0) {
  console.log(`(${errors} files threw during this pass)`);
}
console.log('\nby category:');
for (const [bucket, count] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(6)}  ${bucket}`);
}
for (const [bucket, arr] of samples) {
  console.log(`\n-- ${bucket} --`);
  for (const s of arr) {
    console.log('  ' + s);
  }
}
