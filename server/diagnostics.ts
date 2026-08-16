/**
 * Structural diagnostics for PowerBuilder source.
 *
 * Replaces the earlier heuristic IF/END-IF counter with a real block-matching
 * pass. The text is first stripped of comments and string literals (so keywords
 * inside them are ignored), then a stack tracks every block opener and verifies
 * it is closed by the correct terminator.
 */

import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { LogicalLine, stripCommentsAndStrings, toStatements } from './preprocess';

export { stripCommentsAndStrings };

type BlockType =
  | 'if'
  | 'for'
  | 'do'
  | 'choose'
  | 'try'
  | 'function'
  | 'subroutine'
  | 'event'
  | 'type'
  | 'on';

interface OpenBlock {
  type: BlockType;
  line: number;
  startChar: number;
  endChar: number;
}

/** The terminator keyword expected for each block type (used in messages). */
const CLOSER_LABEL: Record<BlockType, string> = {
  if: 'end if',
  for: 'next',
  do: 'loop',
  choose: 'end choose',
  try: 'end try',
  function: 'end function',
  subroutine: 'end subroutine',
  event: 'end event',
  type: 'end type',
  on: 'end on'
};

const FUNCTION_DEF_RE =
  /^(?:(?:public|private|protected|global)\s+)*(function|subroutine)\s+[\p{L}_][\p{L}\p{N}_]*.*\(/iu;
const TYPE_DEF_RE = /^(?:global\s+)?type\s+[\p{L}_][\p{L}\p{N}_$#%-]*\s+from\b/iu;

const PROTOTYPES_START_RE = /^\s*(?:forward\s+|type\s+|global\s+)?prototypes\b/i;
const PROTOTYPES_END_RE = /^\s*end\s+prototypes\b/i;

/** Identifies a block opener on a cleaned line, if any. */
function detectOpener(clean: string, enclosingType?: BlockType): BlockType | null {
  const trimmed = clean.trim();
  const lower = trimmed.toLowerCase();
  if (!lower) {
    return null;
  }

  // `if ... then` only opens a block when nothing follows `then` on the line.
  if (/^if\b/.test(lower) && /\bthen$/.test(lower.replace(/\s+$/, ''))) {
    return 'if';
  }
  if (/^for\b/.test(lower)) {
    return 'for';
  }
  if (/^do\b/.test(lower)) {
    return 'do';
  }
  if (/^choose\s+case\b/.test(lower)) {
    return 'choose';
  }
  if (/^try\b/.test(lower)) {
    return 'try';
  }
  if (TYPE_DEF_RE.test(trimmed)) {
    return 'type';
  }
  const functionMatch = FUNCTION_DEF_RE.exec(trimmed);
  if (functionMatch) {
    // Function/subroutine *declarations* only ever appear at the top level of
    // a script, same as `event` below. `Function wf_foo()` (or `Subroutine
    // ...`) nested inside an already-open block is a call statement (real
    // corpora call functions this way with an explicit, case-varying keyword
    // prefix), not a nested declaration.
    if (enclosingType) {
      return null;
    }
    // Use the matched keyword itself, not a substring search over the whole
    // line — a name like `of_validatefunctionnames` contains "function" and
    // would otherwise misclassify a `subroutine` declaration.
    return functionMatch[1].toLowerCase() === 'subroutine' ? 'subroutine' : 'function';
  }
  if (/^event\b/.test(lower)) {
    // Event *declarations* only ever appear at the top level of a script.
    // `Event <name>(args)` inside an already-open block (an override calling
    // its own event, `if`/`for`/... bodies, ...) is PowerScript's syntax for
    // synchronously *triggering* an event, not a nested declaration.
    return enclosingType ? null : 'event';
  }
  if (/^on\s+[\p{L}_]/u.test(lower)) {
    return 'on';
  }

  return null;
}

/** Identifies a block terminator on a cleaned line, if any. */
function detectCloser(clean: string): BlockType | null {
  const lower = clean.trim().toLowerCase();
  if (!lower.startsWith('end') && !lower.startsWith('next') && !lower.startsWith('loop')) {
    return null;
  }

  if (/^end\s+if\b/.test(lower)) {
    return 'if';
  }
  if (/^next\b/.test(lower) || /^end\s+for\b/.test(lower)) {
    // `end for` shows up in real-world code as an alternate to `next`.
    return 'for';
  }
  if (/^loop\b/.test(lower)) {
    return 'do';
  }
  if (/^end\s+choose\b/.test(lower)) {
    return 'choose';
  }
  if (/^end\s+try\b/.test(lower)) {
    return 'try';
  }
  if (/^end\s+function\b/.test(lower)) {
    return 'function';
  }
  if (/^end\s+subroutine\b/.test(lower)) {
    return 'subroutine';
  }
  if (/^end\s+event\b/.test(lower)) {
    return 'event';
  }
  if (/^end\s+type\b/.test(lower)) {
    return 'type';
  }
  if (/^end\s+on\b/.test(lower)) {
    return 'on';
  }

  // `end prototypes`, `end variables`, etc. are intentionally not tracked.
  return null;
}

function rangeFor(lineNumber: number, clean: string, column = 0): Range {
  const leading = column + clean.length - clean.trimStart().length;
  const end = column + clean.trimEnd().length;
  return {
    start: { line: lineNumber, character: leading },
    end: { line: lineNumber, character: Math.max(end, leading + 1) }
  };
}

/**
 * Name-resolution facade the server supplies so semantic checks can consult
 * the active built-in catalogs and the workspace index without this module
 * depending on either.
 */
export interface SemanticContext {
  /** True when the name resolves to any callable or declared identifier. */
  isKnown(name: string): boolean;
  /**
   * For an unknown name: a message when it exists in the *other* PB version's
   * catalog ("added in PB 2025" / "removed after PB 2022"), else undefined.
   */
  versionNote(name: string): string | undefined;
  /**
   * Maximum accepted argument count when the name is a built-in whose arity is
   * trustworthy (single-syntax, non-variadic); undefined disables the check.
   */
  maxArgs(name: string): number | undefined;
  /**
   * Declared parameter types when trustworthy (same conditions as maxArgs);
   * undefined disables literal-vs-type checking.
   */
  paramTypesOf(name: string): string[] | undefined;
  /**
   * Which parameters are declared by reference, when arity is trustworthy.
   * PowerBuilder requires a variable for these — a literal will not compile.
   */
  refParamsOf(name: string): boolean[] | undefined;
  /**
   * For member functions callable bare in two ambiguous ways — receiver
   * passed explicitly as the first argument (`TriggerEvent(this, "x")`) vs.
   * an implicit-self call from within an inherited script
   * (`GetItemStatus(row, col, buffer!)`) — the arity/type info for the
   * *implicit-self* (no receiver slot) interpretation. Undefined for
   * non-member names. Used only to avoid flagging a call that is valid under
   * either interpretation.
   */
  rawMaxArgs?(name: string): number | undefined;
  rawParamTypesOf?(name: string): string[] | undefined;
  rawRefParamsOf?(name: string): boolean[] | undefined;
  /** The enum an `Identifier!` value belongs to, or undefined. */
  enumNameOf(valueToken: string): string | undefined;
  /** True when typeName is a known enumerated datatype. */
  isEnumType(typeName: string): boolean;
  /** True when name is a declared variable/param/property — assignment targets. */
  isDeclaredIdentifier(name: string): boolean;
  /** Active PowerBuilder version, for messages. */
  version: string;
}

const NUMERIC_TYPES = new Set([
  'integer', 'int', 'long', 'longlong', 'double', 'decimal', 'dec', 'real',
  'uint', 'ulong', 'byte', 'unsignedinteger', 'unsignedlong'
]);

type LiteralKind = 'string' | 'number' | 'enum' | 'other';

function literalKindOf(argText: string): { kind: LiteralKind; token?: string } {
  const trimmed = argText.trim();
  if (/^["']/.test(trimmed)) {
    return { kind: 'string' };
  }
  if (/^[+-]?\d/.test(trimmed) && /^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'number' };
  }
  const enumMatch = /^([A-Za-z_]\w*!)$/.exec(trimmed);
  if (enumMatch) {
    return { kind: 'enum', token: enumMatch[1] };
  }
  return { kind: 'other' };
}

/** A human message when a literal argument cannot satisfy the declared type. */
function literalMismatch(
  semantic: SemanticContext,
  paramType: string,
  arg: { kind: LiteralKind; token?: string }
): string | undefined {
  const lower = paramType.toLowerCase();
  if (arg.kind === 'other' || lower === 'any') {
    return undefined;
  }
  if (NUMERIC_TYPES.has(lower)) {
    if (arg.kind === 'string') {
      return `expects ${paramType}, but a string literal was passed`;
    }
    if (arg.kind === 'enum') {
      return `expects ${paramType}, but the enumerated value ${arg.token} was passed`;
    }
    return undefined;
  }
  if (lower === 'string') {
    if (arg.kind === 'number') {
      return 'expects string, but a numeric literal was passed';
    }
    if (arg.kind === 'enum') {
      return `expects string, but the enumerated value ${arg.token} was passed`;
    }
    return undefined;
  }
  if (lower === 'boolean' && (arg.kind === 'string' || arg.kind === 'number')) {
    return `expects boolean, but a ${arg.kind} literal was passed`;
  }
  if (semantic.isEnumType(paramType)) {
    if (arg.kind === 'string' || arg.kind === 'number') {
      return `expects a ${paramType} enumerated value, but a ${arg.kind} literal was passed`;
    }
    if (arg.kind === 'enum' && arg.token) {
      const actual = semantic.enumNameOf(arg.token);
      if (actual && actual.toLowerCase() !== paramType.toLowerCase()) {
        return `expects a ${paramType} enumerated value, but ${arg.token} belongs to ${actual}`;
      }
    }
  }
  return undefined;
}

/** Control-flow words that read like calls when followed by `(`. */
const STATEMENT_WORDS = new Set([
  'if', 'elseif', 'then', 'else', 'while', 'until', 'for', 'do', 'loop',
  'choose', 'case', 'try', 'catch', 'finally', 'throw', 'return', 'when',
  'not', 'and', 'or', 'exit', 'continue', 'halt', 'goto', 'create', 'destroy',
  'on', 'call', 'is'
]);

const CALL_RE = /(^|[^.\w:])([A-Za-z_]\w*)\s*\(/g;

/**
 * Flags unknown bare calls (Information — the target may live in a library
 * that isn't exported to the workspace) and calls that pass more arguments
 * than a built-in accepts (Warning). Member calls after a dot are skipped:
 * without full type inference an unknown member is too often a false alarm.
 */

function semanticDiagnostics(
  cleaned: string[],
  original: string[],
  semantic: SemanticContext,
  logical: LogicalLine[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let inPrototypes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const clean = cleaned[i];
    const trimmed = clean.trim();
    if (!trimmed) {
      continue;
    }
    if (PROTOTYPES_START_RE.test(clean)) {
      inPrototypes = true;
      continue;
    }
    if (PROTOTYPES_END_RE.test(clean)) {
      inPrototypes = false;
      continue;
    }
    // Embedded SQL statements run until their terminating semicolon and follow
    // SQL semantics, not PowerScript's.
    if (logical[i]?.sql) {
      continue;
    }
    // Declaration lines legitimately contain `name (params)` shapes.
    if (
      inPrototypes ||
      FUNCTION_DEF_RE.test(trimmed) ||
      TYPE_DEF_RE.test(trimmed) ||
      /^(end|event|on)\b/i.test(trimmed)
    ) {
      continue;
    }

    // Assignment to an identifier that no declaration accounts for.
    const assign = /^(\s*)([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*=(?!=)/.exec(clean);
    if (
      assign &&
      !STATEMENT_WORDS.has(assign[2].toLowerCase()) &&
      !semantic.isKnown(assign[2]) &&
      !semantic.isDeclaredIdentifier(assign[2])
    ) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line: logical[i]?.line ?? i, character: assign[1].length },
          end: { line: logical[i]?.line ?? i, character: assign[1].length + assign[2].length }
        },
        message: `Variable '${assign[2]}' is assigned but never declared.`,
        source: 'powerbuilder'
      });
    }

    CALL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CALL_RE.exec(clean)) !== null) {
      const name = match[2];
      const nameStart = match.index + match[1].length;
      if (STATEMENT_WORDS.has(name.toLowerCase())) {
        continue;
      }
      // `object.dynamic MethodName(...)` is a dynamic-dispatch member call,
      // not a bare/global call — the `dynamic` keyword sits between the dot
      // chain and the method name, so CALL_RE's "not preceded by `.`" guard
      // doesn't catch it.
      if (/\bdynamic\s*$/i.test(clean.slice(0, nameStart))) {
        continue;
      }

      if (!semantic.isKnown(name)) {
        const note = semantic.versionNote(name);
        diagnostics.push({
          severity: note ? DiagnosticSeverity.Warning : DiagnosticSeverity.Information,
          range: { start: { line: logical[i]?.line ?? i, character: nameStart }, end: { line: logical[i]?.line ?? i, character: nameStart + name.length } },
          message: note ??
            `Unknown function '${name}' — not a PowerBuilder ${semantic.version} built-in or an indexed workspace symbol.`,
          source: 'powerbuilder'
        });
        continue;
      }

      const max = semantic.maxArgs(name);
      const openParen = clean.indexOf('(', nameStart + name.length);
      const args = extractArguments(clean, original[i], openParen);
      if (args === undefined) {
        continue; // multiline call — structure unknown on this line
      }
      const rawMax = semantic.rawMaxArgs?.(name);
      if (max !== undefined && args.length > max && (rawMax === undefined || args.length > rawMax)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start: { line: logical[i]?.line ?? i, character: nameStart }, end: { line: logical[i]?.line ?? i, character: nameStart + name.length } },
          message: `'${name}' accepts at most ${max} argument${max === 1 ? '' : 's'}, but ${args.length} were passed.`,
          source: 'powerbuilder'
        });
        continue;
      }

      const paramTypes = semantic.paramTypesOf(name);
      const refParams = semantic.refParamsOf(name);
      const rawParamTypes = semantic.rawParamTypesOf?.(name);
      const rawRefParams = semantic.rawRefParamsOf?.(name);
      if (paramTypes) {
        for (let a = 0; a < args.length && a < paramTypes.length; a++) {
          const literal = literalKindOf(args[a]);
          const isRefHere = refParams?.[a];
          const isRefUnderRaw = rawRefParams?.[a];
          if (isRefHere && literal.kind !== 'other' && (rawRefParams === undefined || isRefUnderRaw)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: { start: { line: logical[i]?.line ?? i, character: nameStart }, end: { line: logical[i]?.line ?? i, character: nameStart + name.length } },
              message: `Argument ${a + 1} of '${name}' is passed by reference and must be a variable, not a ${literal.kind} literal.`,
              source: 'powerbuilder'
            });
            continue;
          }
          const mismatch = literalMismatch(semantic, paramTypes[a], literal);
          if (mismatch) {
            const rawMismatch = rawParamTypes && a < rawParamTypes.length
              ? literalMismatch(semantic, rawParamTypes[a], literal)
              : mismatch;
            if (rawMismatch) {
              diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: { start: { line: logical[i]?.line ?? i, character: nameStart }, end: { line: logical[i]?.line ?? i, character: nameStart + name.length } },
                message: `Argument ${a + 1} of '${name}' ${mismatch}.`,
                source: 'powerbuilder'
              });
            }
          }
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Extracts the argument texts of a call whose `(` sits at openParen. Structure
 * (parens, commas) comes from the comment/string-stripped line; the returned
 * segments come from the original line so literals survive. Returns undefined
 * when the call does not close on the same line.
 */
function extractArguments(clean: string, orig: string, openParen: number): string[] | undefined {
  let depth = 0;
  let bracketDepth = 0;
  let segStart = openParen + 1;
  const args: string[] = [];
  for (let i = openParen; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        const last = orig.slice(segStart, i);
        if (args.length > 0 || last.trim().length > 0) {
          args.push(last);
        }
        return args;
      }
    } else if (ch === '[') {
      bracketDepth++;
    } else if (ch === ']') {
      bracketDepth--;
    } else if (ch === ',' && depth === 1 && bracketDepth === 0) {
      args.push(orig.slice(segStart, i));
      segStart = i + 1;
    }
  }
  return undefined;
}

// DataWindow (.srd) and Query (.srq) exports use a declarative
// `key=(nested=key=value pairs)` attribute syntax, not PowerScript — every
// object always opens with a `release <n>;` statement, which is otherwise
// never valid PowerScript. Detected once per file so semantic checks (which
// assume PowerScript statement shapes) can be skipped entirely for them.
const DW_SYNTAX_HEADER_RE = /^release\s+\d+(?:\.\d+)?\s*$/i;

export function computeDiagnostics(text: string, semantic?: SemanticContext): Diagnostic[] {
  const logical = toStatements(text.split(/\r?\n/));
  const lines = logical.map((l) => l.text);
  const lineNo = (i: number): number => logical[i]?.line ?? i;
  const colOf = (i: number): number => logical[i]?.column ?? 0;
  const cleaned = stripCommentsAndStrings(lines);
  const diagnostics: Diagnostic[] = [];
  const stack: OpenBlock[] = [];
  let inPrototypes = false;
  const isDataWindowSyntax = DW_SYNTAX_HEADER_RE.test(
    (cleaned.find((l) => l.trim()) ?? '').trim()
  );

  for (let i = 0; i < cleaned.length; i++) {
    const clean = cleaned[i];
    if (!clean.trim()) {
      continue;
    }

    // Forward/type prototype sections declare signatures without bodies, so their
    // `function`/`subroutine` lines must not be treated as block openers.
    if (PROTOTYPES_START_RE.test(clean)) {
      inPrototypes = true;
      continue;
    }
    if (PROTOTYPES_END_RE.test(clean)) {
      inPrototypes = false;
      continue;
    }
    if (inPrototypes) {
      continue;
    }

    // Embedded SQL runs until its terminating semicolon and follows SQL
    // syntax, not PowerScript's — a `JOIN ... ON` clause is not an `on` block.
    if (logical[i]?.sql) {
      continue;
    }

    const closer = detectCloser(clean);
    if (closer) {
      const matchIndex = findMatchIndex(stack, closer);
      if (matchIndex === -1) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: rangeFor(lineNo(i), clean, colOf(i)),
          message: `Unexpected '${CLOSER_LABEL[closer]}' — no matching '${closer}' block is open.`,
          source: 'powerbuilder'
        });
      } else {
        // Everything above the matched opener was left unclosed.
        for (let s = stack.length - 1; s > matchIndex; s--) {
          const orphan = stack[s];
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start: { line: orphan.line, character: orphan.startChar }, end: { line: orphan.line, character: orphan.endChar } },
            message: `'${orphan.type}' block is missing its '${CLOSER_LABEL[orphan.type]}' (closed by '${CLOSER_LABEL[closer]}' on line ${lineNo(i) + 1}).`,
            source: 'powerbuilder'
          });
        }
        stack.length = matchIndex;
      }
      continue;
    }

    const opener = detectOpener(clean, stack[stack.length - 1]?.type);
    if (opener) {
      const leading = colOf(i) + clean.length - clean.trimStart().length;
      stack.push({
        type: opener,
        line: lineNo(i),
        startChar: leading,
        endChar: colOf(i) + clean.trimEnd().length
      });
    }
  }

  // Anything still open at end of file was never closed.
  for (const orphan of stack) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: { start: { line: orphan.line, character: orphan.startChar }, end: { line: orphan.line, character: orphan.endChar } },
      message: `'${orphan.type}' block is never closed (missing '${CLOSER_LABEL[orphan.type]}').`,
      source: 'powerbuilder'
    });
  }

  if (semantic && !isDataWindowSyntax) {
    diagnostics.push(...semanticDiagnostics(cleaned, lines, semantic, logical));
  }

  return diagnostics;
}

/**
 * Foldable line ranges: every matched block pair from the structural matcher,
 * plus variables/prototypes sections (which the block stack ignores).
 */
export function computeFoldingRanges(text: string): { startLine: number; endLine: number }[] {
  const logical = toStatements(text.split(/\r?\n/));
  const lines = logical.map((l) => l.text);
  const lineNo = (i: number): number => logical[i]?.line ?? i;
  const cleaned = stripCommentsAndStrings(lines);
  const ranges: { startLine: number; endLine: number }[] = [];
  const stack: OpenBlock[] = [];
  let sectionStart = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const clean = cleaned[i];
    const trimmed = clean.trim();
    if (!trimmed) {
      continue;
    }

    if (/^(?:global|shared|type)\s+variables\b/i.test(trimmed) || PROTOTYPES_START_RE.test(clean)) {
      sectionStart = lineNo(i);
      continue;
    }
    if (/^end\s+(?:variables|prototypes)\b/i.test(trimmed)) {
      if (sectionStart >= 0 && lineNo(i) > sectionStart) {
        ranges.push({ startLine: sectionStart, endLine: lineNo(i) - 1 });
      }
      sectionStart = -1;
      continue;
    }
    if (sectionStart >= 0) {
      continue;
    }

    if (logical[i]?.sql) {
      continue;
    }

    const closer = detectCloser(clean);
    if (closer) {
      const matchIndex = findMatchIndex(stack, closer);
      if (matchIndex !== -1) {
        const opener = stack[matchIndex];
        if (lineNo(i) > opener.line) {
          ranges.push({ startLine: opener.line, endLine: lineNo(i) - 1 });
        }
        stack.length = matchIndex;
      }
      continue;
    }

    const opener = detectOpener(clean, stack[stack.length - 1]?.type);
    if (opener) {
      const leading = clean.length - clean.trimStart().length;
      stack.push({ type: opener, line: lineNo(i), startChar: leading, endChar: clean.trimEnd().length });
    }
  }

  return ranges;
}

/** Returns the deepest stack index whose block type matches, or -1. */
function findMatchIndex(stack: OpenBlock[], type: BlockType): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].type === type) {
      return i;
    }
  }
  return -1;
}
