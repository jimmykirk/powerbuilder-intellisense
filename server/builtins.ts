/**
 * Catalog plumbing for PowerScript built-in system functions.
 *
 * The actual function data lives in server/data/*.json, scraped from the
 * official Appeon PowerScript Reference by tools/docs-scraper/. Each entry
 * carries a structured parameter list so the language server can render rich
 * hover documentation and per-parameter signature help.
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

/**
 * Shape of one entry in the scraped catalogs under server/data/ (produced by
 * tools/docs-scraper/parse.py from the Appeon PowerScript Reference).
 */
export interface RawFunctionEntry {
  name: string;
  returnType: string;
  category: string;
  documentation: string;
  /** Call signature as printed in the docs, e.g. `controlname.AddData ( ... )`. */
  syntax: string;
  params: ParamInfo[];
}

/**
 * Converts a scraped catalog into the runtime FunctionInfo list.
 *
 * Object member functions are documented as dot-calls whose first argument-table
 * row is the receiver itself (`controlname.AddCategory ( categoryname )` lists
 * `controlname` first). Callers never pass the receiver, so it is dropped from
 * the parameter list used for completion and signature help.
 */
export function loadFunctionCatalog(catalog: { functions: RawFunctionEntry[] }): FunctionInfo[] {
  return catalog.functions.map((fn) => {
    const receiver = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\./.exec(fn.syntax)?.[1]?.toLowerCase();
    const params =
      receiver && fn.params.length > 0 && fn.params[0].name.toLowerCase() === receiver
        ? fn.params.slice(1)
        : fn.params;
    return {
      name: fn.name,
      returnType: fn.returnType,
      category: fn.category,
      documentation: fn.documentation,
      params
    };
  });
}

/** Builds the case-insensitive lookup index for a catalog. */
export function buildFunctionIndex(functions: FunctionInfo[]): Map<string, FunctionInfo> {
  const index = new Map<string, FunctionInfo>();
  for (const fn of functions) {
    index.set(fn.name.toLowerCase(), fn);
  }
  return index;
}

/**
 * A built-in object event from the scraped catalogs (server/data/*_events.json).
 * Events are not called like functions: `eventId` is the `pbm_*` message the
 * event maps to (null where the docs list none, e.g. menu events), and params
 * are the arguments PowerBuilder passes into the event script.
 */
export interface EventInfo {
  name: string;
  returnType: string;
  category: string;
  documentation: string;
  eventId: string | null;
  params: ParamInfo[];
}

export function loadEventCatalog(catalog: { events: EventInfo[] }): EventInfo[] {
  return catalog.events;
}

/** Builds the case-insensitive lookup index for an event catalog. */
export function buildEventIndex(events: EventInfo[]): Map<string, EventInfo> {
  const index = new Map<string, EventInfo>();
  for (const ev of events) {
    index.set(ev.name.toLowerCase(), ev);
  }
  return index;
}

/** Builds a markdown hover body for a built-in event. */
export function formatEventHover(ev: EventInfo): string {
  const lines: string[] = [];
  lines.push(`**${ev.name}** — *${ev.category} event*`);
  lines.push('');
  lines.push('```powerbuilder');
  lines.push(`event ${ev.name}(${ev.params.map(formatParam).join(', ')})`);
  lines.push('```');
  lines.push('');
  lines.push(ev.documentation);

  if (ev.params.length > 0) {
    lines.push('');
    lines.push('**Arguments**');
    for (const param of ev.params) {
      const desc = param.description ? ` — ${param.description}` : '';
      lines.push(`- \`${param.name}\` \`${param.type}\`${desc}`);
    }
  }

  lines.push('');
  lines.push(`*Returns* \`${ev.returnType}\``);
  if (ev.eventId) {
    lines.push('');
    lines.push(`*Event ID* \`${ev.eventId}\``);
  }
  return lines.join('\n');
}
