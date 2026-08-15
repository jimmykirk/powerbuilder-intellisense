/**
 * Workspace symbol index for PowerBuilder source files.
 *
 * Parses function, subroutine, event, and type definitions out of exported
 * PowerBuilder objects (.srw/.sru/.srf/...) and keeps an in-memory index so the
 * server can resolve go-to-definition, hover, completion, and workspace symbol
 * search across every file in the project — not just the open document.
 */

import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { ParamInfo } from './builtins';
import { stripCommentsAndStrings } from './diagnostics';

export type SymbolKind = 'function' | 'subroutine' | 'event' | 'type' | 'variable';

export interface SymbolDefinition {
  name: string;
  kind: SymbolKind;
  returnType?: string;
  params: ParamInfo[];
  /** Enclosing object type, when known (e.g. the ancestor for a `type` decl). */
  container?: string;
  /** Human-readable one-line signature for hover / completion detail. */
  signature: string;
  uri: string;
  /** 0-based line of the definition. */
  line: number;
  /** 0-based character offset of the symbol name on that line. */
  character: number;
}

export interface VariableDefinition {
  name: string;
  type: string;
  scope: 'global' | 'instance' | 'local' | 'shared';
  description?: string;
  uri: string;
  line: number;
  character: number;
}

/** File extensions that belong to PowerBuilder exported objects. */
export const POWERBUILDER_EXTENSIONS = [
  '.sra', '.srw', '.sru', '.srm', '.srd', '.srf', '.srs', '.srp', '.srq', '.srj'
];

const FUNCTION_RE =
  /^\s*(?:(public|private|protected)\s+)?(?:global\s+)?(function|subroutine)\b\s+(?:(\w+)\s+)?(\w+)\s*\(([^)]*)\)/i;
const EVENT_RE = /^\s*event\s+(?:type\s+(\w+)\s+)?(\w+)\s*(?:\(([^)]*)\))?\s*;/i;
const TYPE_RE = /^\s*(?:global\s+)?type\s+(\w+)\s+from\s+([\w`.]+)/i;
const PROTOTYPES_START_RE = /^\s*(?:forward\s+|type\s+|global\s+)?prototypes\b/i;
const PROTOTYPES_END_RE = /^\s*end\s+prototypes\b/i;

/** Splits a parameter list on top-level commas and parses each `type name` pair. */
function parseParams(raw: string): ParamInfo[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed.split(',').map((segment): ParamInfo => {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const name = tokens.pop() ?? '';
    const type = tokens.join(' ') || 'any';
    return { name, type };
  }).filter((param) => param.name.length > 0);
}

function buildFunctionSignature(
  kind: 'function' | 'subroutine',
  returnType: string | undefined,
  name: string,
  params: ParamInfo[]
): string {
  const paramText = params
    .map((param) => `${param.type} ${param.name}`.trim())
    .join(', ');
  const prefix = kind === 'function' && returnType ? `${returnType} ` : '';
  return `${prefix}${name}(${paramText})`;
}

/** Access-level and storage keywords that may precede a declaration's type. */
const DECLARATION_MODIFIERS = new Set([
  'public', 'private', 'protected', 'privatewrite', 'privateread',
  'protectedwrite', 'protectedread', 'constant', 'readonly'
]);

/**
 * Parses one line inside a variables block into zero or more declarations.
 * Handles access modifiers (`private integer ii_x`), access-section markers
 * (`private:`), multi-declaration lines (`integer a, b = 1, c`), array
 * suffixes (`string is_names[]`), and decimal precision (`decimal {2} ld_amt`).
 */
export function parseVariableDeclaration(
  line: string,
  lineNumber: number,
  uri: string,
  scope: VariableDefinition['scope']
): VariableDefinition[] {
  let text = line.trim();
  if (!text || text.startsWith('//') || text.startsWith('/*')) {
    return [];
  }
  // Access-section markers like `private:` / `public:`
  if (/^(public|private|protected)\s*:/i.test(text)) {
    return [];
  }
  // Strip trailing line comment
  text = text.replace(/\/\/.*$/, '').trim();

  const tokens = text.split(/\s+/);
  let idx = 0;
  while (idx < tokens.length && DECLARATION_MODIFIERS.has(tokens[idx].toLowerCase())) {
    idx++;
  }
  if (idx >= tokens.length - 1) {
    return [];
  }

  let type = tokens[idx];
  idx++;
  // Decimal precision: `decimal {2} ld_amt`
  if (tokens[idx]?.startsWith('{')) {
    while (idx < tokens.length && !tokens[idx].includes('}')) {
      idx++;
    }
    idx++;
  }
  if (!/^[a-zA-Z_]\w*$/.test(type)) {
    return [];
  }

  const rest = tokens.slice(idx).join(' ');
  if (!rest) {
    return [];
  }

  const declarations: VariableDefinition[] = [];
  // Split on top-level commas; initializers with commas inside braces/quotes are
  // rare in exports and a wrong split only drops that name, never invents one.
  for (const segment of rest.split(',')) {
    const name = segment.trim().split('=')[0].trim().replace(/\[.*$/, '').trim();
    if (name && /^[a-zA-Z_]\w*$/.test(name) && !DECLARATION_MODIFIERS.has(name.toLowerCase())) {
      declarations.push({
        name,
        type,
        scope,
        uri,
        line: lineNumber,
        character: Math.max(line.indexOf(name), 0)
      });
    }
  }
  return declarations;
}

/**
 * Extracts the column names of a DataWindow export (.srd). Column definitions
 * appear both in the `table(column=(type=... name=emp_name ...))` section and
 * as visual `column(band=detail ... name=emp_name ...)` objects; both are
 * matched by scanning a bounded window after each `column` opener so nested
 * parens like `type=char(10)` don't end the search early.
 */
export interface DataWindowColumn {
  name: string;
  /** 0-based position of the column's `name=` value in the .srd. */
  line: number;
  character: number;
}

export function parseDataWindowColumns(text: string): DataWindowColumn[] {
  const columns: DataWindowColumn[] = [];
  const seen = new Set<string>();
  const opener = /\bcolumn\s*[=(]/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text)) !== null) {
    const window = text.slice(match.index, match.index + 800);
    const name = /\bname=([a-zA-Z_]\w*)/.exec(window);
    if (name && !seen.has(name[1].toLowerCase())) {
      seen.add(name[1].toLowerCase());
      const offset = match.index + name.index + 'name='.length;
      const before = text.slice(0, offset);
      const line = (before.match(/\n/g) ?? []).length;
      const character = offset - (before.lastIndexOf('\n') + 1);
      columns.push({ name: name[1], line, character });
    }
  }
  return columns;
}

/**
 * DataWindow-object bindings declared in a document: both runtime assignments
 * (`dw_1.dataobject = "d_emp"`) and the `dataobject = "d_emp"` property inside
 * an exported control's type block.
 */
export function parseDataObjectBindings(text: string): { control: string; dataObject: string }[] {
  const bindings: { control: string; dataObject: string }[] = [];
  const assign = /\b([A-Za-z_]\w*)\s*\.\s*dataobject\s*=\s*['"]([\w$#%-]+)['"]/gi;
  let match: RegExpExecArray | null;
  while ((match = assign.exec(text)) !== null) {
    bindings.push({ control: match[1], dataObject: match[2] });
  }

  let currentType: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const typeMatch = /^\s*(?:global\s+)?type\s+(\w+)\s+from\b/i.exec(line);
    if (typeMatch) {
      currentType = typeMatch[1];
      continue;
    }
    if (/^\s*end\s+type\b/i.test(line)) {
      currentType = null;
      continue;
    }
    const prop = /^\s*dataobject\s*=\s*"([\w$#%-]+)"/i.exec(line);
    if (prop && currentType) {
      bindings.push({ control: currentType, dataObject: prop[1] });
    }
  }
  return bindings;
}

/**
 * Parses all indexable symbol definitions out of a single document's text.
 * Definitions inside `prototypes ... end prototypes` blocks are skipped so that
 * navigation lands on the real implementation rather than the forward declaration.
 * Also parses variable declarations for later hover/completion.
 */
export function parseSymbols(uri: string, text: string): {
  symbols: SymbolDefinition[];
  variables: VariableDefinition[];
} {
  const lines = text.split(/\r?\n/);
  const symbols: SymbolDefinition[] = [];
  const variables: VariableDefinition[] = [];
  let inPrototypes = false;
  let inVariables = false;
  let currentScope: 'global' | 'instance' | 'local' | 'shared' = 'global';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (PROTOTYPES_START_RE.test(line)) {
      inPrototypes = true;
      continue;
    }
    if (PROTOTYPES_END_RE.test(line)) {
      inPrototypes = false;
      continue;
    }

    const typeMatch = TYPE_RE.exec(line);
    if (typeMatch) {
      const name = typeMatch[1];
      const ancestor = typeMatch[2].replace(/`/g, '');
      symbols.push({
        name,
        kind: 'type',
        container: ancestor,
        params: [],
        signature: `type ${name} from ${ancestor}`,
        uri,
        line: i,
        character: Math.max(line.toLowerCase().indexOf(name.toLowerCase()), 0)
      });
      continue;
    }

    if (!inPrototypes) {
      const fnMatch = FUNCTION_RE.exec(line);
      if (fnMatch) {
        const kind = fnMatch[2].toLowerCase() as 'function' | 'subroutine';
        const returnType = kind === 'function' ? fnMatch[3] : undefined;
        const name = fnMatch[4];
        const params = parseParams(fnMatch[5] ?? '');
        symbols.push({
          name,
          kind,
          returnType,
          params,
          signature: buildFunctionSignature(kind, returnType, name, params),
          uri,
          line: i,
          character: Math.max(line.indexOf(name), 0)
        });
        continue;
      }
    }

    const eventMatch = EVENT_RE.exec(line);
    if (eventMatch) {
      const returnType = eventMatch[1];
      const name = eventMatch[2];
      const params = parseParams(eventMatch[3] ?? '');
      symbols.push({
        name,
        kind: 'event',
        returnType,
        params,
        signature: buildFunctionSignature('function', returnType, name, params).replace(/^/, 'event '),
        uri,
        line: i,
        character: Math.max(line.indexOf(name), 0)
      });
    }

    // Track variable declaration blocks. PowerBuilder exports use
    //   global variables ... end variables
    //   shared variables ... end variables
    //   type variables ... end variables   (these are the INSTANCE variables)
    const blockStart = /^\s*(global|shared|type)\s+variables\b/i.exec(line);
    if (blockStart) {
      inVariables = true;
      const blockKind = blockStart[1].toLowerCase();
      currentScope = blockKind === 'type' ? 'instance' : (blockKind as 'global' | 'shared');
      continue;
    }
    if (/^\s*end\s+variables\b/i.test(line)) {
      inVariables = false;
      continue;
    }

    if (inVariables) {
      for (const decl of parseVariableDeclaration(line, i, uri, currentScope)) {
        variables.push(decl);
      }
    }
  }

  return { symbols, variables };
}

export class WorkspaceIndex {
  private byUri = new Map<string, SymbolDefinition[]>();
  private byName = new Map<string, SymbolDefinition[]>();
  private varsByUri = new Map<string, VariableDefinition[]>();
  private varsByName = new Map<string, VariableDefinition[]>();
  // DataWindow object name (from the .srd basename) -> its source and columns
  private dwColumns = new Map<string, { uri: string; columns: DataWindowColumn[] }>();
  // Per-document control -> dataobject bindings
  private dwBindingsByUri = new Map<string, { control: string; dataObject: string }[]>();
  // Raw document text, kept for reference/rename scans
  private textByUri = new Map<string, string>();
  // Type inheritance: maps type name -> immediate ancestor name
  private typeAncestors = new Map<string, string>();
  // Reverse mapping: ancestor -> all direct children
  private typeChildren = new Map<string, Set<string>>();

  /** Re-parses a document and replaces any previously indexed symbols/variables for its URI. */
  updateDocument(uri: string, text: string): void {
    const { symbols, variables } = parseSymbols(uri, text);
    this.setEntries(uri, symbols, variables);
    this.textByUri.set(uri, text);

    if (uri.toLowerCase().endsWith('.srd')) {
      const dataObject = path.basename(URI.parse(uri).fsPath, path.extname(URI.parse(uri).fsPath));
      const columns = parseDataWindowColumns(text);
      if (columns.length > 0) {
        this.dwColumns.set(dataObject.toLowerCase(), { uri, columns });
      } else {
        this.dwColumns.delete(dataObject.toLowerCase());
      }
    } else {
      const bindings = parseDataObjectBindings(text);
      if (bindings.length > 0) {
        this.dwBindingsByUri.set(uri, bindings);
      } else {
        this.dwBindingsByUri.delete(uri);
      }
    }
  }

  removeDocument(uri: string): void {
    this.textByUri.delete(uri);
    this.dwBindingsByUri.delete(uri);
    if (uri.toLowerCase().endsWith('.srd')) {
      const dataObject = path.basename(URI.parse(uri).fsPath, path.extname(URI.parse(uri).fsPath));
      this.dwColumns.delete(dataObject.toLowerCase());
    }

    const existing = this.byUri.get(uri);
    if (existing) {
      for (const def of existing) {
        const key = def.name.toLowerCase();
        const arr = this.byName.get(key);
        if (arr) {
          const filtered = arr.filter((entry) => entry !== def);
          if (filtered.length > 0) {
            this.byName.set(key, filtered);
          } else {
            this.byName.delete(key);
          }
        }
      }
      this.byUri.delete(uri);
    }

    const existingVars = this.varsByUri.get(uri);
    if (existingVars) {
      for (const v of existingVars) {
        const key = v.name.toLowerCase();
        const arr = this.varsByName.get(key);
        if (arr) {
          const filtered = arr.filter((entry) => entry !== v);
          if (filtered.length > 0) {
            this.varsByName.set(key, filtered);
          } else {
            this.varsByName.delete(key);
          }
        }
      }
      this.varsByUri.delete(uri);
    }
  }

  private setEntries(uri: string, defs: SymbolDefinition[], vars: VariableDefinition[]): void {
    this.removeDocument(uri);
    this.byUri.set(uri, defs);
    for (const def of defs) {
      const key = def.name.toLowerCase();
      const arr = this.byName.get(key);
      if (arr) {
        arr.push(def);
      } else {
        this.byName.set(key, [def]);
      }

      // Track type inheritance
      if (def.kind === 'type' && def.container) {
        const typeKey = def.name.toLowerCase();
        const ancestorKey = def.container.toLowerCase();
        this.typeAncestors.set(typeKey, ancestorKey);
        const childrenSet = this.typeChildren.get(ancestorKey) || new Set<string>();
        childrenSet.add(typeKey);
        this.typeChildren.set(ancestorKey, childrenSet);
      }
    }

    this.varsByUri.set(uri, vars);
    for (const v of vars) {
      const key = v.name.toLowerCase();
      const arr = this.varsByName.get(key);
      if (arr) {
        arr.push(v);
      } else {
        this.varsByName.set(key, [v]);
      }
    }
  }

  /** Returns every definition matching a name (case-insensitive). */
  find(name: string): SymbolDefinition[] {
    return this.byName.get(name.toLowerCase()) ?? [];
  }

  /** Returns the first callable (function/subroutine/event) definition for a name. */
  findCallable(name: string): SymbolDefinition | undefined {
    return this.find(name).find((def) => def.kind !== 'type');
  }

  /** Returns all variables matching a name (case-insensitive). */
  findVariables(name: string): VariableDefinition[] {
    return this.varsByName.get(name.toLowerCase()) ?? [];
  }

  /** Returns every indexed variable declaration across the workspace. */
  allVariables(): VariableDefinition[] {
    const result: VariableDefinition[] = [];
    for (const vars of this.varsByUri.values()) {
      result.push(...vars);
    }
    return result;
  }

  /** Returns the variables declared in one document. */
  variablesIn(uri: string): VariableDefinition[] {
    return this.varsByUri.get(uri) ?? [];
  }

  /** Returns the symbols declared in one document. */
  symbolsIn(uri: string): SymbolDefinition[] {
    return this.byUri.get(uri) ?? [];
  }

  /** Returns the URI of the file whose primary `type` declaration defines typeName. */
  uriForType(typeName: string): string | undefined {
    return this.find(typeName).find((def) => def.kind === 'type')?.uri;
  }

  /** Returns the columns of an indexed DataWindow object (.srd basename). */
  columnsForDataObject(name: string): DataWindowColumn[] {
    return this.dwColumns.get(name.toLowerCase())?.columns ?? [];
  }

  /** Returns every indexed DataWindow object with its source URI and columns. */
  allDataObjects(): Map<string, { uri: string; columns: DataWindowColumn[] }> {
    return this.dwColumns;
  }

  /** The DataWindow object bound to a control, from any indexed document. */
  dataObjectFor(control: string): string | undefined {
    const lower = control.toLowerCase();
    for (const bindings of this.dwBindingsByUri.values()) {
      const hit = bindings.find((b) => b.control.toLowerCase() === lower);
      if (hit) {
        return hit.dataObject;
      }
    }
    return undefined;
  }

  /** Every indexed column definition matching a name, as .srd locations. */
  findColumns(name: string): { uri: string; line: number; character: number; dataObject: string }[] {
    const lower = name.toLowerCase();
    const results: { uri: string; line: number; character: number; dataObject: string }[] = [];
    for (const [dataObject, entry] of this.dwColumns) {
      for (const col of entry.columns) {
        if (col.name.toLowerCase() === lower) {
          results.push({ uri: entry.uri, line: col.line, character: col.character, dataObject });
        }
      }
    }
    return results;
  }

  /**
   * Every textual occurrence of an identifier across the indexed workspace
   * (word-boundary, case-insensitive — PowerScript identifiers are
   * case-insensitive), skipping comments and string literals.
   */
  references(name: string): { uri: string; line: number; character: number }[] {
    const results: { uri: string; line: number; character: number }[] = [];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w])${escaped}(?![\\w!])`, 'gi');

    for (const [uri, text] of this.textByUri) {
      const cleaned = stripCommentsAndStrings(text.split(/\r?\n/));
      for (let i = 0; i < cleaned.length; i++) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(cleaned[i])) !== null) {
          results.push({ uri, line: i, character: match.index });
        }
      }
    }
    return results;
  }

  /** Returns the immediate ancestor type name, or undefined if not found or if it's a base type. */
  getAncestorType(typeName: string): string | undefined {
    return this.typeAncestors.get(typeName.toLowerCase());
  }

  /**
   * Returns the full inheritance chain from a type up to its root ancestor.
   * Includes the type itself as the first element.
   * Returns empty array if the type is not found.
   */
  getInheritanceChain(typeName: string): string[] {
    const chain: string[] = [];
    let current: string | undefined = typeName.toLowerCase();

    while (current) {
      chain.push(current);
      current = this.typeAncestors.get(current);

      // Protect against circular inheritance (shouldn't happen but be safe)
      if (chain.length > 100) {
        break;
      }
    }

    return chain;
  }

  /**
   * Returns all immediate children (direct descendants) of a type.
   */
  getChildTypes(typeName: string): string[] {
    const children = this.typeChildren.get(typeName.toLowerCase());
    return children ? Array.from(children) : [];
  }

  all(): SymbolDefinition[] {
    const result: SymbolDefinition[] = [];
    for (const defs of this.byUri.values()) {
      result.push(...defs);
    }
    return result;
  }

  /** Fuzzy-ish substring search used to back the workspace symbol provider. */
  search(query: string): SymbolDefinition[] {
    const needle = query.toLowerCase();
    if (!needle) {
      return this.all();
    }
    return this.all().filter((def) => def.name.toLowerCase().includes(needle));
  }

  /**
   * Recursively scans workspace folders on disk and indexes every PowerBuilder
   * file found. Open documents are re-indexed separately as they change.
   */
  async scanFolders(folders: string[]): Promise<void> {
    for (const folder of folders) {
      await this.scanDirectory(folder);
    }
  }

  private async scanDirectory(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) {
          continue;
        }
        await this.scanDirectory(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!POWERBUILDER_EXTENSIONS.includes(ext)) {
          continue;
        }
        try {
          const text = await fs.promises.readFile(fullPath, 'utf8');
          this.updateDocument(URI.file(fullPath).toString(), text);
        } catch {
          // Ignore unreadable files.
        }
      }
    }
  }
}
