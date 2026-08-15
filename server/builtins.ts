/**
 * Catalog of PowerScript (Appeon PowerBuilder 2025) built-in system functions.
 *
 * Each entry carries a structured parameter list so the language server can
 * render rich hover documentation and per-parameter signature help.
 */

export interface ParamInfo {
  name: string;
  type: string;
  description?: string;
  /** Optional / omittable argument. */
  optional?: boolean;
}

export interface FunctionInfo {
  name: string;
  returnType: string;
  params: ParamInfo[];
  documentation: string;
  category: string;
}

/**
 * Renders a single parameter as `type name` (with a trailing `?` marker for
 * optional arguments), matching PowerScript's `type name` declaration order.
 */
export function formatParam(param: ParamInfo): string {
  const optional = param.optional ? '?' : '';
  return `${param.type} ${param.name}${optional}`;
}

/** Builds a full C-style signature string, e.g. `long Pos(string source, string target)`. */
export function formatSignature(fn: FunctionInfo): string {
  const params = fn.params.map(formatParam).join(', ');
  return `${fn.returnType} ${fn.name}(${params})`;
}

/** Builds a markdown hover body with signature, description, and parameter table. */
export function formatHover(fn: FunctionInfo): string {
  const lines: string[] = [];
  lines.push(`**${fn.name}** — *${fn.category}*`);
  lines.push('');
  lines.push('```powerbuilder');
  lines.push(formatSignature(fn));
  lines.push('```');
  lines.push('');
  lines.push(fn.documentation);

  if (fn.params.length > 0) {
    lines.push('');
    lines.push('**Parameters**');
    for (const param of fn.params) {
      const optional = param.optional ? ' *(optional)*' : '';
      const desc = param.description ? ` — ${param.description}` : '';
      lines.push(`- \`${param.name}\` \`${param.type}\`${optional}${desc}`);
    }
  }

  lines.push('');
  lines.push(`*Returns* \`${fn.returnType}\``);
  return lines.join('\n');
}

export const builtinFunctions: FunctionInfo[] = [
  // ---------------------------------------------------------------- String
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
  {
    name: 'LeftTrim',
    returnType: 'string',
    category: 'String',
    documentation: 'Removes leading spaces from a string.',
    params: [{ name: 'value', type: 'string', description: 'The string to trim.' }]
  },
  {
    name: 'RightTrim',
    returnType: 'string',
    category: 'String',
    documentation: 'Removes trailing spaces from a string.',
    params: [{ name: 'value', type: 'string', description: 'The string to trim.' }]
  },
  {
    name: 'Replace',
    returnType: 'string',
    category: 'String',
    documentation: 'Replaces a portion of a string with another string.',
    params: [
      { name: 'source', type: 'string', description: 'The string to modify.' },
      { name: 'start', type: 'long', description: 'Starting position of the replacement.' },
      { name: 'n', type: 'long', description: 'Number of characters to replace.' },
      { name: 'replacement', type: 'string', description: 'The replacement text.' }
    ]
  },
  {
    name: 'Fill',
    returnType: 'string',
    category: 'String',
    documentation: 'Builds a string of a given length by repeating a pattern.',
    params: [
      { name: 'pattern', type: 'string', description: 'The characters to repeat.' },
      { name: 'n', type: 'long', description: 'Length of the resulting string.' }
    ]
  },
  {
    name: 'Space',
    returnType: 'string',
    category: 'String',
    documentation: 'Returns a string of a specified number of spaces.',
    params: [{ name: 'n', type: 'long', description: 'Number of spaces.' }]
  },
  {
    name: 'Match',
    returnType: 'boolean',
    category: 'String',
    documentation: 'Tests whether a string matches a regular-expression pattern.',
    params: [
      { name: 'source', type: 'string', description: 'The string to test.' },
      { name: 'pattern', type: 'string', description: 'The pattern to match against.' }
    ]
  },
  {
    name: 'Char',
    returnType: 'string',
    category: 'String',
    documentation: 'Converts a numeric ASCII value or blob into a character.',
    params: [{ name: 'value', type: 'any', description: 'The ASCII code or blob to convert.' }]
  },
  {
    name: 'Asc',
    returnType: 'integer',
    category: 'String',
    documentation: 'Returns the ASCII value of the first character of a string.',
    params: [{ name: 'value', type: 'string', description: 'The source string.' }]
  },

  // --------------------------------------------------------------- Numeric
  {
    name: 'Abs',
    returnType: 'any',
    category: 'Numeric',
    documentation: 'Returns the absolute value of a number.',
    params: [{ name: 'n', type: 'any', description: 'The number.' }]
  },
  {
    name: 'Ceiling',
    returnType: 'any',
    category: 'Numeric',
    documentation: 'Returns the smallest whole number greater than or equal to n.',
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
    name: 'Truncate',
    returnType: 'decimal',
    category: 'Numeric',
    documentation: 'Truncates a number to a specified number of decimal places.',
    params: [
      { name: 'x', type: 'any', description: 'The number to truncate.' },
      { name: 'n', type: 'integer', description: 'Number of decimal places.' }
    ]
  },
  {
    name: 'Mod',
    returnType: 'any',
    category: 'Numeric',
    documentation: 'Returns the remainder of dividing x by y.',
    params: [
      { name: 'x', type: 'any', description: 'The dividend.' },
      { name: 'y', type: 'any', description: 'The divisor.' }
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
  {
    name: 'Rand',
    returnType: 'long',
    category: 'Numeric',
    documentation: 'Returns a random whole number between 1 and n.',
    params: [{ name: 'n', type: 'long', description: 'Upper bound of the range.' }]
  },
  {
    name: 'Sqrt',
    returnType: 'double',
    category: 'Numeric',
    documentation: 'Returns the square root of a number.',
    params: [{ name: 'n', type: 'double', description: 'The number.' }]
  },
  {
    name: 'Sign',
    returnType: 'integer',
    category: 'Numeric',
    documentation: 'Returns -1, 0, or 1 indicating the sign of a number.',
    params: [{ name: 'n', type: 'any', description: 'The number.' }]
  },

  // ------------------------------------------------------------- Date/Time
  {
    name: 'Today',
    returnType: 'date',
    category: 'Date/Time',
    documentation: 'Returns the current system date (and optionally time).',
    params: []
  },
  {
    name: 'Now',
    returnType: 'time',
    category: 'Date/Time',
    documentation: 'Returns the current system time.',
    params: []
  },
  {
    name: 'Year',
    returnType: 'integer',
    category: 'Date/Time',
    documentation: 'Returns the year portion of a date.',
    params: [{ name: 'value', type: 'date', description: 'The date.' }]
  },
  {
    name: 'Month',
    returnType: 'integer',
    category: 'Date/Time',
    documentation: 'Returns the month portion of a date.',
    params: [{ name: 'value', type: 'date', description: 'The date.' }]
  },
  {
    name: 'Day',
    returnType: 'integer',
    category: 'Date/Time',
    documentation: 'Returns the day-of-month portion of a date.',
    params: [{ name: 'value', type: 'date', description: 'The date.' }]
  },
  {
    name: 'DaysAfter',
    returnType: 'long',
    category: 'Date/Time',
    documentation: 'Returns the number of days that date2 falls after date1.',
    params: [
      { name: 'date1', type: 'date', description: 'The earlier date.' },
      { name: 'date2', type: 'date', description: 'The later date.' }
    ]
  },
  {
    name: 'RelativeDate',
    returnType: 'date',
    category: 'Date/Time',
    documentation: 'Returns the date that is n days after (or before) a date.',
    params: [
      { name: 'value', type: 'date', description: 'The base date.' },
      { name: 'n', type: 'integer', description: 'Number of days to offset.' }
    ]
  },
  {
    name: 'DateTime',
    returnType: 'datetime',
    category: 'Date/Time',
    documentation: 'Combines a date and an optional time into a datetime value.',
    params: [
      { name: 'value', type: 'date', description: 'The date component.' },
      { name: 'time', type: 'time', description: 'The time component.', optional: true }
    ]
  },

  // ------------------------------------------------------------ Conversion
  {
    name: 'String',
    returnType: 'string',
    category: 'Conversion',
    documentation: 'Converts data to a string, optionally applying a display format.',
    params: [
      { name: 'value', type: 'any', description: 'The value to convert.' },
      { name: 'format', type: 'string', description: 'A display format string.', optional: true }
    ]
  },
  {
    name: 'Integer',
    returnType: 'integer',
    category: 'Conversion',
    documentation: 'Converts a string or number to an integer.',
    params: [{ name: 'value', type: 'any', description: 'The value to convert.' }]
  },
  {
    name: 'Long',
    returnType: 'long',
    category: 'Conversion',
    documentation: 'Converts a string or number to a long.',
    params: [{ name: 'value', type: 'any', description: 'The value to convert.' }]
  },
  {
    name: 'Dec',
    returnType: 'decimal',
    category: 'Conversion',
    documentation: 'Converts a string or number to a decimal.',
    params: [{ name: 'value', type: 'any', description: 'The value to convert.' }]
  },
  {
    name: 'Double',
    returnType: 'double',
    category: 'Conversion',
    documentation: 'Converts a string or number to a double.',
    params: [{ name: 'value', type: 'any', description: 'The value to convert.' }]
  },

  // ---------------------------------------------------------- System / UI
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
  },
  {
    name: 'SetNull',
    returnType: 'integer',
    category: 'System',
    documentation: 'Sets a variable to NULL.',
    params: [{ name: 'variable', type: 'any', description: 'The variable to set to NULL.' }]
  },
  {
    name: 'IsNull',
    returnType: 'boolean',
    category: 'System',
    documentation: 'Tests whether an expression is NULL.',
    params: [{ name: 'expression', type: 'any', description: 'The value to test.' }]
  },
  {
    name: 'IsValid',
    returnType: 'boolean',
    category: 'System',
    documentation: 'Tests whether an object reference is instantiated and valid.',
    params: [{ name: 'object', type: 'any', description: 'The object reference to test.' }]
  },
  {
    name: 'Open',
    returnType: 'integer',
    category: 'System',
    documentation: 'Opens a window and makes it visible.',
    params: [
      { name: 'window', type: 'window', description: 'The window variable to open.' },
      { name: 'parent', type: 'window', description: 'Parent window for the new window.', optional: true }
    ]
  },
  {
    name: 'Close',
    returnType: 'integer',
    category: 'System',
    documentation: 'Closes an open window.',
    params: [{ name: 'window', type: 'window', description: 'The window to close.' }]
  },
  {
    name: 'OpenWithParm',
    returnType: 'integer',
    category: 'System',
    documentation: 'Opens a window, passing a parameter available via Message.',
    params: [
      { name: 'window', type: 'window', description: 'The window to open.' },
      { name: 'parameter', type: 'any', description: 'Value passed through the Message object.' }
    ]
  },
  {
    name: 'TriggerEvent',
    returnType: 'integer',
    category: 'System',
    documentation: 'Immediately triggers an event on an object.',
    params: [
      { name: 'object', type: 'any', description: 'The object owning the event.' },
      { name: 'event', type: 'any', description: 'Event name or enumerated event id.' }
    ]
  },
  {
    name: 'PostEvent',
    returnType: 'boolean',
    category: 'System',
    documentation: 'Queues an event on an object to run after current processing.',
    params: [
      { name: 'object', type: 'any', description: 'The object owning the event.' },
      { name: 'event', type: 'any', description: 'Event name or enumerated event id.' }
    ]
  },
  {
    name: 'ClassName',
    returnType: 'string',
    category: 'System',
    documentation: 'Returns the class name of an object.',
    params: [{ name: 'object', type: 'any', description: 'The object to inspect.' }]
  },
  {
    name: 'Run',
    returnType: 'integer',
    category: 'System',
    documentation: 'Runs an external application.',
    params: [
      { name: 'program', type: 'string', description: 'The command line to run.' },
      { name: 'windowState', type: 'WindowState', description: 'How to display the program window.', optional: true }
    ]
  },

  // ------------------------------------------------------------ DataWindow
  {
    name: 'Retrieve',
    returnType: 'long',
    category: 'DataWindow',
    documentation: 'Retrieves rows from the database into a DataWindow. Returns the row count.',
    params: [{ name: 'arguments', type: 'any', description: 'Optional retrieval arguments.', optional: true }]
  },
  {
    name: 'Update',
    returnType: 'integer',
    category: 'DataWindow',
    documentation: 'Saves DataWindow changes to the database.',
    params: [
      { name: 'accept', type: 'boolean', description: 'Whether to call AcceptText first.', optional: true },
      { name: 'resetFlags', type: 'boolean', description: 'Whether to reset update flags.', optional: true }
    ]
  },
  {
    name: 'InsertRow',
    returnType: 'long',
    category: 'DataWindow',
    documentation: 'Inserts a new row into a DataWindow. Returns the new row number.',
    params: [{ name: 'row', type: 'long', description: 'Row number to insert before (0 = append).' }]
  },
  {
    name: 'DeleteRow',
    returnType: 'integer',
    category: 'DataWindow',
    documentation: 'Deletes a row from a DataWindow.',
    params: [{ name: 'row', type: 'long', description: 'Row number to delete (0 = current).' }]
  },
  {
    name: 'GetItemString',
    returnType: 'string',
    category: 'DataWindow',
    documentation: 'Returns the string value of a DataWindow item.',
    params: [
      { name: 'row', type: 'long', description: 'The row number.' },
      { name: 'column', type: 'any', description: 'Column name or number.' }
    ]
  },
  {
    name: 'GetItemNumber',
    returnType: 'double',
    category: 'DataWindow',
    documentation: 'Returns the numeric value of a DataWindow item.',
    params: [
      { name: 'row', type: 'long', description: 'The row number.' },
      { name: 'column', type: 'any', description: 'Column name or number.' }
    ]
  },
  {
    name: 'SetItem',
    returnType: 'integer',
    category: 'DataWindow',
    documentation: 'Sets the value of a DataWindow item.',
    params: [
      { name: 'row', type: 'long', description: 'The row number.' },
      { name: 'column', type: 'any', description: 'Column name or number.' },
      { name: 'value', type: 'any', description: 'The value to assign.' }
    ]
  },
  {
    name: 'RowCount',
    returnType: 'long',
    category: 'DataWindow',
    documentation: 'Returns the number of retrieved/inserted rows in a DataWindow.',
    params: []
  },
  {
    name: 'GetRow',
    returnType: 'long',
    category: 'DataWindow',
    documentation: 'Returns the current row number in a DataWindow.',
    params: []
  },
  {
    name: 'ScrollToRow',
    returnType: 'integer',
    category: 'DataWindow',
    documentation: 'Scrolls to and selects the specified row.',
    params: [{ name: 'row', type: 'long', description: 'The row to scroll to.' }]
  },
  {
    name: 'SetTransObject',
    returnType: 'integer',
    category: 'DataWindow',
    documentation: 'Associates a transaction object with a DataWindow.',
    params: [{ name: 'transaction', type: 'transaction', description: 'The transaction object.' }]
  },
  {
    name: 'AcceptText',
    returnType: 'integer',
    category: 'DataWindow',
    documentation: 'Applies the text in the edit control to the current DataWindow item.',
    params: []
  }
];

/** Case-insensitive lookup index for built-in functions. */
const builtinIndex = new Map<string, FunctionInfo>();
for (const fn of builtinFunctions) {
  builtinIndex.set(fn.name.toLowerCase(), fn);
}

export function findBuiltin(name: string): FunctionInfo | undefined {
  return builtinIndex.get(name.toLowerCase());
}
