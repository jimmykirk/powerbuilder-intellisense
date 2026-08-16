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
  /** True when this chunk is embedded SQL text, not a PowerScript statement. */
  sql?: boolean;
}

/**
 * SQL verbs that begin an embedded SQL statement in PowerScript — the
 * statement runs (across physical lines, if needed) until its terminating
 * `;` and follows SQL syntax, not PowerScript's.
 */
export const SQL_START_RE =
  /^(select|selectblob|insert|update(?!\s*\()|updateblob|delete|fetch|declare|open(?!\s*\()|close(?!\s*\()|connect|disconnect|commit|rollback|execute)\b/i;

/**
 * Removes comments and string literals from each line, replacing them with
 * spaces so that character positions still line up with the original text.
 */
export function stripCommentsAndStrings(lines: string[]): string[] {
  const cleaned: string[] = [];
  // PowerScript block comments *nest* (unlike C-style languages) — a `/*`
  // inside an already-open comment starts another level that needs its own
  // `*/`, so track depth rather than a boolean.
  let commentDepth = 0;
  // Active quote character when a string literal is left open at end of line
  // (real DataWindow exports embed literal newlines inside quoted attribute
  // values, e.g. a `tag="..."` whose design-time text had line breaks), or
  // null when not mid-string.
  let inString: string | null = null;

  for (const original of lines) {
    // `$PBExportHeader$...` / `$PBExportComments$...` are free-form export
    // metadata, not PowerScript — their text can contain unbalanced quotes
    // (e.g. "don't") that would otherwise be mistaken for an unterminated
    // string literal and corrupt masking for the rest of the file.
    if (/^\$PBExport(Header|Comments)\$/.test(original)) {
      cleaned.push(''.padEnd(original.length, ' '));
      continue;
    }

    const chars = original.split('');
    let i = 0;

    if (inString) {
      while (i < chars.length && chars[i] !== inString) {
        if (chars[i] === '~' && i + 1 < chars.length) {
          // `~` escapes the next character (e.g. `~'` for a literal quote,
          // `~~` for a literal tilde) — it never ends the string.
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
          continue;
        }
        chars[i] = ' ';
        i++;
      }
      if (i < chars.length) {
        chars[i] = ' '; // closing quote
        i++;
        inString = null;
      }
    }

    while (i < chars.length) {
      if (commentDepth > 0) {
        if (chars[i] === '/' && chars[i + 1] === '*') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
          commentDepth++;
        } else if (chars[i] === '*' && chars[i + 1] === '/') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
          commentDepth--;
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
        commentDepth = 1;
        continue;
      }
      if (chars[i] === '"' || chars[i] === "'") {
        const quote = chars[i];
        chars[i] = ' ';
        i++;
        while (i < chars.length && chars[i] !== quote) {
          if (chars[i] === '~' && i + 1 < chars.length) {
            // `~` escapes the next character (e.g. `~'` for a literal quote,
            // `~~` for a literal tilde) — it never ends the string.
            chars[i] = ' ';
            chars[i + 1] = ' ';
            i += 2;
            continue;
          }
          chars[i] = ' ';
          i++;
        }
        if (i < chars.length) {
          chars[i] = ' '; // closing quote
          i++;
        } else {
          inString = quote; // unterminated on this line — continues onto the next
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
  // Tracked across logical lines while semicolons are still visible in the
  // masked text — once a statement is split off below, its own trailing `;`
  // is gone, so SQL state can't be recovered from that stripped chunk alone.
  let inSql = false;

  const allLogical = toLogicalLines(lines);
  // Mask every logical line in one pass so block-comment/string state (e.g. a
  // `/* ... */` doc comment spanning several logical lines) carries across
  // them correctly. Masking each logical line in isolation would reset that
  // state and let comment text leak through as if it were real code — which
  // could spuriously match `SQL_START_RE` and get SQL tracking stuck on.
  const maskedAll = stripCommentsAndStrings(allLogical.map((l) => l.text));

  for (let li = 0; li < allLogical.length; li++) {
    const logical = allLogical[li];
    const masked = maskedAll[li];
    let start = 0;
    let pushedAny = false;
    for (let i = 0; i <= masked.length; i++) {
      const atEnd = i === masked.length;
      if (!atEnd && masked[i] !== ';') {
        continue;
      }
      const chunkMasked = masked.slice(start, i);
      if (!inSql && SQL_START_RE.test(chunkMasked.trim())) {
        inSql = true;
      }
      const sql = inSql;
      const text = logical.text.slice(start, i);
      if (text.trim()) {
        out.push({ text, line: logical.line, column: start, sql });
        pushedAny = true;
      }
      if (!atEnd) {
        inSql = false; // a real `;` terminates the statement, SQL or not
      }
      start = i + 1;
    }
    if (!pushedAny) {
      // Keep lines that produced no real statement text (blank lines, or
      // lines that are entirely a comment) so indices stay meaningful.
      out.push({ ...logical, sql: inSql });
    }
  }

  return out;
}
