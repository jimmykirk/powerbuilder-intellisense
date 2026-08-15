/**
 * Structural diagnostics for PowerBuilder source.
 *
 * Replaces the earlier heuristic IF/END-IF counter with a real block-matching
 * pass. The text is first stripped of comments and string literals (so keywords
 * inside them are ignored), then a stack tracks every block opener and verifies
 * it is closed by the correct terminator.
 */

import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';

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

/**
 * Removes comments and string literals from each line, replacing them with
 * spaces so that character positions still line up with the original text.
 */
function stripCommentsAndStrings(lines: string[]): string[] {
  const cleaned: string[] = [];
  let inBlockComment = false;

  for (const original of lines) {
    const chars = original.split('');
    let i = 0;

    while (i < chars.length) {
      if (inBlockComment) {
        if (chars[i] === '*' && chars[i + 1] === '/') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
          inBlockComment = false;
        } else {
          chars[i] = ' ';
          i++;
        }
        continue;
      }

      const two = chars[i] + (chars[i + 1] ?? '');
      if (two === '//') {
        // Line comment: blank the remainder.
        for (let j = i; j < chars.length; j++) {
          chars[j] = ' ';
        }
        break;
      }
      if (two === '/*') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
        inBlockComment = true;
        continue;
      }
      if (chars[i] === '"' || chars[i] === "'") {
        const quote = chars[i];
        chars[i] = ' ';
        i++;
        while (i < chars.length && chars[i] !== quote) {
          chars[i] = ' ';
          i++;
        }
        if (i < chars.length) {
          chars[i] = ' '; // closing quote
          i++;
        }
        continue;
      }

      i++;
    }

    cleaned.push(chars.join(''));
  }

  return cleaned;
}

const FUNCTION_DEF_RE =
  /^(?:(?:public|private|protected|global)\s+)*(function|subroutine)\s+\w+.*\(/i;
const TYPE_DEF_RE = /^(?:global\s+)?type\s+\w+\s+from\b/i;

const PROTOTYPES_START_RE = /^\s*(?:forward\s+|type\s+|global\s+)?prototypes\b/i;
const PROTOTYPES_END_RE = /^\s*end\s+prototypes\b/i;

/** Identifies a block opener on a cleaned line, if any. */
function detectOpener(clean: string): BlockType | null {
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
  if (FUNCTION_DEF_RE.test(trimmed)) {
    return lower.includes('subroutine') && !lower.includes('function') ? 'subroutine' : 'function';
  }
  if (/^event\b/.test(lower)) {
    return 'event';
  }
  if (/^on\s+\w/.test(lower) && lower.endsWith(';')) {
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
  if (/^next\b/.test(lower)) {
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

function rangeFor(lineNumber: number, clean: string): Range {
  const leading = clean.length - clean.trimStart().length;
  const end = clean.trimEnd().length;
  return {
    start: { line: lineNumber, character: leading },
    end: { line: lineNumber, character: Math.max(end, leading + 1) }
  };
}

export function computeDiagnostics(text: string): Diagnostic[] {
  const lines = text.split(/\r?\n/);
  const cleaned = stripCommentsAndStrings(lines);
  const diagnostics: Diagnostic[] = [];
  const stack: OpenBlock[] = [];
  let inPrototypes = false;

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

    const closer = detectCloser(clean);
    if (closer) {
      const matchIndex = findMatchIndex(stack, closer);
      if (matchIndex === -1) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: rangeFor(i, clean),
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
            message: `'${orphan.type}' block is missing its '${CLOSER_LABEL[orphan.type]}' (closed by '${CLOSER_LABEL[closer]}' on line ${i + 1}).`,
            source: 'powerbuilder'
          });
        }
        stack.length = matchIndex;
      }
      continue;
    }

    const opener = detectOpener(clean);
    if (opener) {
      const leading = clean.length - clean.trimStart().length;
      stack.push({
        type: opener,
        line: i,
        startChar: leading,
        endChar: clean.trimEnd().length
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

  return diagnostics;
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
