/**
 * PowerBuilder 2025 system functions catalog.
 * Extracted from official Appeon PowerScript Reference (PB 2025).
 *
 * https://docs.appeon.com/pb2025/powerscript_reference/
 */

import { FunctionInfo, formatSignature, formatHover } from './builtins';

// Re-export common formatting functions for use by both versions
export { formatSignature, formatHover };

// PB 2025 functions — this will be populated from deep-research findings
// For now, starting with core functions; will be extended with version-specific additions

export const builtinFunctions2025: FunctionInfo[] = [
  // String functions (2025 inherits all 2022 functions, plus new ones)
  {
    name: 'Len',
    returnType: 'long',
    category: 'String',
    documentation: 'Reports the length of a string or blob.',
    params: [{ name: 'value', type: 'string', description: 'The string to measure.' }]
  },
  {
    name: 'Left',
    returnType: 'string',
    category: 'String',
    documentation: 'Returns the leftmost characters of a string.',
    params: [
      { name: 'source', type: 'string', description: 'The string to extract from.' },
      { name: 'n', type: 'long', description: 'Number of characters to return.' }
    ]
  },
  {
    name: 'Right',
    returnType: 'string',
    category: 'String',
    documentation: 'Returns the rightmost characters of a string.',
    params: [
      { name: 'source', type: 'string', description: 'The string to extract from.' },
      { name: 'n', type: 'long', description: 'Number of characters to return.' }
    ]
  },
  {
    name: 'Mid',
    returnType: 'string',
    category: 'String',
    documentation: 'Returns a substring starting at a given position.',
    params: [
      { name: 'source', type: 'string', description: 'The string to extract from.' },
      { name: 'start', type: 'long', description: 'Starting character position (1-based).' },
      { name: 'length', type: 'long', description: 'Number of characters to return.', optional: true }
    ]
  },
  {
    name: 'Pos',
    returnType: 'long',
    category: 'String',
    documentation: 'Finds the position of a target string within a source string.',
    params: [
      { name: 'source', type: 'string', description: 'The string to search.' },
      { name: 'target', type: 'string', description: 'The string to find.' },
      { name: 'start', type: 'long', description: 'Position to begin searching from.', optional: true }
    ]
  },
  {
    name: 'Upper',
    returnType: 'string',
    category: 'String',
    documentation: 'Converts all characters in a string to uppercase.',
    params: [{ name: 'value', type: 'string', description: 'The string to convert.' }]
  },
  {
    name: 'Lower',
    returnType: 'string',
    category: 'String',
    documentation: 'Converts all characters in a string to lowercase.',
    params: [{ name: 'value', type: 'string', description: 'The string to convert.' }]
  },
  {
    name: 'Trim',
    returnType: 'string',
    category: 'String',
    documentation: 'Removes leading and trailing spaces from a string.',
    params: [{ name: 'value', type: 'string', description: 'The string to trim.' }]
  },
  // Numeric functions
  {
    name: 'Abs',
    returnType: 'any',
    category: 'Numeric',
    documentation: 'Returns the absolute value of a number.',
    params: [{ name: 'n', type: 'any', description: 'The number.' }]
  },
  {
    name: 'Int',
    returnType: 'long',
    category: 'Numeric',
    documentation: 'Returns the largest whole number less than or equal to n.',
    params: [{ name: 'n', type: 'any', description: 'The number.' }]
  },
  {
    name: 'Round',
    returnType: 'decimal',
    category: 'Numeric',
    documentation: 'Rounds a number to a specified number of decimal places.',
    params: [
      { name: 'x', type: 'any', description: 'The number to round.' },
      { name: 'n', type: 'integer', description: 'Number of decimal places.' }
    ]
  },
  {
    name: 'Max',
    returnType: 'any',
    category: 'Numeric',
    documentation: 'Returns the larger of two numbers.',
    params: [
      { name: 'x', type: 'any', description: 'First number.' },
      { name: 'y', type: 'any', description: 'Second number.' }
    ]
  },
  {
    name: 'Min',
    returnType: 'any',
    category: 'Numeric',
    documentation: 'Returns the smaller of two numbers.',
    params: [
      { name: 'x', type: 'any', description: 'First number.' },
      { name: 'y', type: 'any', description: 'Second number.' }
    ]
  },
  // Date/Time functions
  {
    name: 'Today',
    returnType: 'date',
    category: 'Date/Time',
    documentation: 'Returns the current system date.',
    params: []
  },
  {
    name: 'Now',
    returnType: 'time',
    category: 'Date/Time',
    documentation: 'Returns the current system time.',
    params: []
  },
  // System functions
  {
    name: 'IsNull',
    returnType: 'boolean',
    category: 'System',
    documentation: 'Tests whether an expression is NULL.',
    params: [{ name: 'expression', type: 'any', description: 'The value to test.' }]
  },
  {
    name: 'SetNull',
    returnType: 'integer',
    category: 'System',
    documentation: 'Sets a variable to NULL.',
    params: [{ name: 'variable', type: 'any', description: 'The variable to set to NULL.' }]
  },
  {
    name: 'MessageBox',
    returnType: 'integer',
    category: 'System',
    documentation: 'Displays a modal dialog box with a message and returns the button clicked.',
    params: [
      { name: 'title', type: 'string', description: 'Text shown in the title bar.' },
      { name: 'text', type: 'any', description: 'The message body.' },
      { name: 'icon', type: 'Icon', description: 'Icon to display (Information!, StopSign!, ...).', optional: true },
      { name: 'button', type: 'Button', description: 'Button set (OK!, YesNo!, ...).', optional: true },
      { name: 'default', type: 'integer', description: 'Which button is the default.', optional: true }
    ]
  }
  // More functions will be populated from deep-research results
];

const builtinIndex2025 = new Map<string, FunctionInfo>();
for (const fn of builtinFunctions2025) {
  builtinIndex2025.set(fn.name.toLowerCase(), fn);
}

export function findBuiltin2025(name: string): FunctionInfo | undefined {
  return builtinIndex2025.get(name.toLowerCase());
}
