/**
 * Source preprocessing shared by the indexer and the diagnostics passes.
 *
 * PowerBuilder continues a statement onto the next physical line when `&` is
 * the last non-whitespace character, so a declaration like
 *
 *     datawindow  idw_eteria, &
 *                 idw_masks, &
 *                 idw_prn
 *
 * is one statement declaring three variables. Anything that parses physical
 * lines in isolation sees only the first. Every structural pass therefore runs
 * over *logical* lines, each of which remembers the physical line it started
 * on so positions still point where the user is looking.
 *
 * `&` only continues when it survives comment and string masking: inside a
 * string it is part of the text, and inside a comment it means nothing.
 */

export interface LogicalLine {
  /** Joined text of the statement. */
  text: string;
  /** 0-based physical line the statement starts on. */
  line: number;
  /** Character offset of this statement within its logical line. */
  column?: number;
}

/**
 * Removes comments and string literals from each line, replacing them with
 * spaces so that character positions still line up with the original text.
 */
export function stripCommentsAndStrings(lines: string[]): string[] {
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

/** Index of the trailing `&` continuation marker on a masked line, or -1. */
function continuationAt(masked: string): number {
  const trimmed = masked.trimEnd();
  return trimmed.endsWith('&') ? trimmed.length - 1 : -1;
}

/**
 * Joins physical lines into logical ones on the `&` continuation marker.
 * Continuation is decided on the comment/string-masked text; the joined result
 * keeps the original characters so string and comment content survives intact.
 */
export function toLogicalLines(lines: string[]): LogicalLine[] {
  const masked = stripCommentsAndStrings(lines);
  const out: LogicalLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const startLine = i;
    let text = lines[i];
    let marker = continuationAt(masked[i]);

    while (marker >= 0 && i + 1 < lines.length) {
      // Drop the `&` and splice on the next physical line.
      text = `${text.slice(0, marker).trimEnd()} ${lines[i + 1].trim()}`;
      i++;
      marker = continuationAt(masked[i]);
      if (marker >= 0) {
        // The marker index refers to the physical line, but `text` is now the
        // joined statement — re-find the trailing `&` in what we have built.
        const joinedMask = continuationAt(stripCommentsAndStrings([text])[0]);
        marker = joinedMask;
      }
    }

    out.push({ text, line: startLine });
  }

  return out;
}

/**
 * Splits logical lines into statements on top-level `;`. PowerBuilder packs
 * several statements onto one physical line —
 *
 *     event dw::itemchanged;call super::itemchanged;choose case dwo.name
 *
 * — so block structure is only visible once they are separated. Semicolons
 * inside strings and comments are masked out first, and each statement
 * remembers where it started so diagnostics still land in the right place.
 */
export function toStatements(lines: string[]): LogicalLine[] {
  const out: LogicalLine[] = [];

  for (const logical of toLogicalLines(lines)) {
    const masked = stripCommentsAndStrings([logical.text])[0];
    let start = 0;
    for (let i = 0; i <= masked.length; i++) {
      const atEnd = i === masked.length;
      if (!atEnd && masked[i] !== ';') {
        continue;
      }
      const text = logical.text.slice(start, i);
      if (text.trim()) {
        out.push({ text, line: logical.line, column: start });
      }
      start = i + 1;
    }
    if (!masked.trim()) {
      out.push(logical); // keep blank lines so indices stay meaningful
    }
  }

  return out;
}
