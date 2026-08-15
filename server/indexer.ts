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
const VARIABLE_RE = /^\s*(?:(global|instance|shared|local)\s+)?(\w+)\s+(\w+)(?:\s*=\s*.+)?$/i;

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

    // Track variable declarations (global, instance, local, shared)
    if (/^\s*(type\s+|end\s+)?variables\b/i.test(line)) {
      inVariables = /^\s*type\s+variables\b/i.test(line) || /^\s*variables\b/i.test(line);
      continue;
    }
    if (/^\s*end\s+variables\b/i.test(line)) {
      inVariables = false;
      continue;
    }

    if (inVariables && line.trim() && !line.trim().startsWith('//')) {
      // Try to parse a variable declaration
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        let scope: 'global' | 'instance' | 'local' | 'shared' = currentScope;
        let typeAndName = parts;

        // Check if first part is a scope keyword
        if (parts[0].toLowerCase() === 'global') {
          scope = 'global';
          typeAndName = parts.slice(1);
        } else if (parts[0].toLowerCase() === 'instance') {
          scope = 'instance';
          typeAndName = parts.slice(1);
        } else if (parts[0].toLowerCase() === 'local') {
          scope = 'local';
          typeAndName = parts.slice(1);
        } else if (parts[0].toLowerCase() === 'shared') {
          scope = 'shared';
          typeAndName = parts.slice(1);
        }

        if (typeAndName.length >= 2) {
          const type = typeAndName[0];
          const name = typeAndName[1].split('=')[0].split(/[,;]/)[0].trim();

          if (name && /^[a-zA-Z_]\w*$/.test(name)) {
            variables.push({
              name,
              type,
              scope,
              uri,
              line: i,
              character: Math.max(line.indexOf(name), 0)
            });
          }
        }
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
  // Type inheritance: maps type name -> immediate ancestor name
  private typeAncestors = new Map<string, string>();
  // Reverse mapping: ancestor -> all direct children
  private typeChildren = new Map<string, Set<string>>();

  /** Re-parses a document and replaces any previously indexed symbols/variables for its URI. */
  updateDocument(uri: string, text: string): void {
    const { symbols, variables } = parseSymbols(uri, text);
    this.setEntries(uri, symbols, variables);
  }

  removeDocument(uri: string): void {
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
