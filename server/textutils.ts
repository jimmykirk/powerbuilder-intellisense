/**
 * Pure text-position helpers shared by the language server. Kept free of any
 * connection/runtime dependencies so they can be unit-tested in isolation.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver/node';

/** Returns the identifier under the cursor, or null if the cursor is not on a word. */
export function getWordAtPosition(document: TextDocument, position: Position): string | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const isWordChar = (char: string): boolean => /[A-Za-z0-9_]/.test(char);

  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }

  let end = offset;
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }

  if (start === end) {
    return null;
  }

  return text.slice(start, end);
}

/**
 * Walks backwards from the cursor to find the innermost function call the cursor
 * sits inside, returning the callee name and which argument (0-based) is active.
 * Returns null when the cursor is not inside a call's argument list.
 */
export function findActiveCall(
  document: TextDocument,
  position: Position
): { name: string; activeParam: number } | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  let depth = 0;
  let commas = 0;
  let i = offset - 1;

  for (; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth === 0) {
        break;
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      commas++;
    } else if ((ch === '\n' || ch === ';') && depth === 0) {
      // Never cross a statement boundary while still at the top level.
      return null;
    }
  }

  if (i < 0) {
    return null;
  }

  // Identifier immediately preceding the opening paren.
  let end = i;
  while (end > 0 && /\s/.test(text[end - 1])) {
    end--;
  }
  let start = end;
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) {
    start--;
  }

  const name = text.slice(start, end);
  if (!name) {
    return null;
  }

  return { name, activeParam: commas };
}
