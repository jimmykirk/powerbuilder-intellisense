/**
 * Encoding detection for PowerBuilder export files read from disk.
 *
 * Real-world exports are frequently UTF-16LE (the PB IDE writes a BOM and,
 * for HEXASCII exports, an `HA$PBExportHeader$` preamble), sometimes ANSI,
 * and only occasionally UTF-8. Documents opened in the editor arrive already
 * decoded over LSP — this module is only for files the server reads itself
 * (workspace scan and watched-file reloads).
 */

/** Decodes a PowerBuilder source file buffer using BOM + content heuristics. */
export function decodePBExport(buffer: Buffer): string {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.toString('utf16le', 2);
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return swapBytes(buffer.subarray(2)).toString('utf16le');
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8', 3);
  }

  // BOM-less UTF-16: ASCII-heavy source puts a NUL in every other byte.
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length >= 4) {
    let evenNul = 0;
    let oddNul = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        if (i % 2 === 0) {
          evenNul++;
        } else {
          oddNul++;
        }
      }
    }
    const half = sample.length / 2;
    if (oddNul > half * 0.6) {
      return buffer.toString('utf16le');
    }
    if (evenNul > half * 0.6) {
      return swapBytes(buffer).toString('utf16le');
    }
  }

  // UTF-8 when it decodes losslessly, otherwise treat as ANSI (latin1 keeps
  // byte values stable, which is enough for identifier/structure parsing).
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) {
    return utf8;
  }
  return buffer.toString('latin1');
}

function swapBytes(buffer: Buffer): Buffer {
  const swapped = Buffer.from(buffer);
  // Node's swap16 requires an even length; drop a trailing odd byte.
  const even = swapped.length % 2 === 0 ? swapped : swapped.subarray(0, swapped.length - 1);
  even.swap16();
  return even;
}
