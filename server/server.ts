import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  Definition,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesParams,
  DocumentSymbol,
  DocumentSymbolParams,
  FileChangeType,
  FoldingRange,
  FoldingRangeParams,
  Hover,
  InitializeParams,
  InitializeResult,
  Location,
  MarkupKind,
  ParameterInformation,
  ProposedFeatures,
  ReferenceParams,
  RenameParams,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensParams,
  SignatureHelp,
  SignatureHelpParams,
  SignatureInformation,
  SymbolInformation,
  SymbolKind,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
  WorkspaceEdit,
  WorkspaceSymbolParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import {
  formatEventHover,
  formatHover,
  formatParam,
  formatSignature,
  ParamInfo,
  VariantInfo
} from './builtins';
import {
  builtinEvents2022,
  builtinFunctions2022,
  enumMap2022,
  findBuiltin2022,
  findBuiltinEvent2022,
  propertyMap2022
} from './builtins-2022';
import {
  builtinEvents2025,
  builtinFunctions2025,
  enumMap2025,
  findBuiltin2025,
  findBuiltinEvent2025,
  propertyMap2025
} from './builtins-2025';
import { parseVariableDeclaration, SymbolDefinition, WorkspaceIndex } from './indexer';
import {
  computeDiagnostics,
  computeFoldingRanges,
  SemanticContext,
  stripCommentsAndStrings
} from './diagnostics';
import { decodePBExport } from './encoding';
import { findActiveCall, getWordAtPosition } from './textutils';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
const index = new WorkspaceIndex();

let hasConfigurationCapability = false;
let pbVersion: '2022' | '2025' = '2025'; // Default
let activeFunctions = builtinFunctions2025;
let findActiveBuiltin = findBuiltin2025;
let activeEvents = builtinEvents2025;
let findActiveEvent = findBuiltinEvent2025;
let activeProperties = propertyMap2025;
let activeEnums = enumMap2025;
let otherFindBuiltin = findBuiltin2022;
let otherFindEvent = findBuiltinEvent2022;
let otherVersion: '2022' | '2025' = '2022';

const KEYWORDS = [
  'if', 'then', 'else', 'elseif', 'end if', 'for', 'to', 'step', 'next',
  'do', 'while', 'until', 'loop', 'choose case', 'case', 'end choose',
  'try', 'catch', 'finally', 'end try', 'throw', 'return', 'continue', 'exit',
  'function', 'subroutine', 'end function', 'end subroutine', 'event', 'end event',
  'create', 'destroy', 'call', 'super', 'this', 'parent', 'true', 'false', 'null',
  'and', 'or', 'not', 'public', 'private', 'protected', 'global', 'shared',
  'constant', 'readonly', 'ref'
];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;
  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);

  // Seed the workspace index from disk in the background.
  const folders = collectWorkspacePaths(params);
  void index.scanFolders(folders).then(() => {
    connection.console.log(`PowerBuilder index: scanned ${folders.length} folder(s).`);
  });

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['.', ':']
      },
      hoverProvider: true,
      definitionProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
        retriggerCharacters: [',']
      },
      workspaceSymbolProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      referencesProvider: true,
      renameProvider: true,
      semanticTokensProvider: {
        legend: { tokenTypes: SEMANTIC_TOKEN_TYPES, tokenModifiers: [] },
        full: true
      }
    }
  };
});

connection.onInitialized((): void => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
    // Load initial configuration
    void loadConfiguration();
  }
});

connection.onDidChangeConfiguration((): void => {
  void loadConfiguration();
});

// Diagnostics are debounced per document: the index update stays immediate
// (completion needs it), but the full semantic pass over a large export only
// runs once typing pauses.
const DIAGNOSTICS_DEBOUNCE_MS = 300;
const diagnosticsTimers = new Map<string, ReturnType<typeof setTimeout>>();

documents.onDidChangeContent((change): void => {
  const uri = change.document.uri;
  index.updateDocument(uri, change.document.getText());

  const existing = diagnosticsTimers.get(uri);
  if (existing) {
    clearTimeout(existing);
  }
  diagnosticsTimers.set(
    uri,
    setTimeout(() => {
      diagnosticsTimers.delete(uri);
      const doc = documents.get(uri);
      if (!doc) {
        return;
      }
      const text = doc.getText();
      connection.sendDiagnostics({
        uri,
        diagnostics: computeDiagnostics(text, buildSemanticContext(text))
      });
    }, DIAGNOSTICS_DEBOUNCE_MS)
  );
});

documents.onDidClose((event): void => {
  const timer = diagnosticsTimers.get(event.document.uri);
  if (timer) {
    clearTimeout(timer);
    diagnosticsTimers.delete(event.document.uri);
  }
});

/**
 * Name resolution for semantic diagnostics: built-in functions and events of
 * the active PB version, every indexed workspace callable/variable/type, and
 * identifiers declared anywhere in the current document (loose local scan, so
 * script-local declarations are never flagged).
 */
const PRONOUNS = new Set([
  'this', 'parent', 'super', 'sqlca', 'sqlda', 'sqlsa', 'error', 'message', 'parentwindow'
]);

let anyPropertyCache: { source: Map<string, unknown>; names: Set<string> } | null = null;

/** Lazily-built set of every property name in the active catalog. */
function anyPropertyNames(): Set<string> {
  if (anyPropertyCache?.source !== activeProperties) {
    const names = new Set<string>();
    for (const props of activeProperties.values()) {
      for (const p of props) {
        names.add(p.name.toLowerCase());
      }
    }
    anyPropertyCache = { source: activeProperties, names };
  }
  return anyPropertyCache.names;
}

function buildSemanticContext(text: string): SemanticContext {
  const localNames = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const decl of parseVariableDeclaration(lines[i], i, '', 'local')) {
      localNames.add(decl.name.toLowerCase());
    }
    // Script parameters declare identifiers too: function/subroutine/event
    // prototypes and catch clauses.
    const proto = /^\s*(?:(?:public|private|protected|global)\s+)*(?:function|subroutine|event)\b[^(]*\(([^)]*)\)/i.exec(lines[i]);
    if (proto && proto[1].trim()) {
      for (const segment of proto[1].split(',')) {
        const tokens = segment.trim().split(/\s+/).filter((t) => !/^(ref|readonly)$/i.test(t));
        const name = tokens[tokens.length - 1]?.replace(/\[.*$/, '');
        if (name && /^[A-Za-z_]\w*$/.test(name)) {
          localNames.add(name.toLowerCase());
        }
      }
    }
    const caught = /\bcatch\s*\(\s*\w+\s+(\w+)\s*\)/i.exec(lines[i]);
    if (caught) {
      localNames.add(caught[1].toLowerCase());
    }
  }

  return {
    version: pbVersion,
    isKnown: (name) =>
      !!findActiveBuiltin(name) ||
      !!findActiveEvent(name) ||
      index.find(name).length > 0 ||
      index.findVariables(name).length > 0 ||
      localNames.has(name.toLowerCase()),
    versionNote: (name) => {
      const other = otherFindBuiltin(name) ?? otherFindEvent(name);
      if (!other) {
        return undefined;
      }
      const detail =
        otherVersion > pbVersion
          ? `it was added in PB ${otherVersion}`
          : `it was removed after PB ${otherVersion}`;
      return `'${other.name}' is not available in PowerBuilder ${pbVersion} — ${detail}.`;
    },
    maxArgs: (name) => {
      const fn = findActiveBuiltin(name);
      if (!fn || fn.variadic || (fn.variants?.length ?? 0) > 1 || index.find(name).length > 0) {
        return undefined; // unknown arity, variants, or shadowed by workspace
      }
      return fn.params.length;
    },
    paramTypesOf: (name) => {
      const fn = findActiveBuiltin(name);
      if (!fn || fn.variadic || (fn.variants?.length ?? 0) > 1 || index.find(name).length > 0) {
        return undefined;
      }
      return fn.params.map((p) => p.type);
    },
    enumNameOf: (valueToken) => {
      const lower = valueToken.toLowerCase();
      for (const en of activeEnums.values()) {
        if (en.values.some((v) => v.toLowerCase() === lower)) {
          return en.name;
        }
      }
      return undefined;
    },
    isEnumType: (typeName) => activeEnums.has(typeName.toLowerCase()),
    isDeclaredIdentifier: (name) => {
      const lower = name.toLowerCase();
      return (
        localNames.has(lower) ||
        index.findVariables(name).length > 0 ||
        PRONOUNS.has(lower) ||
        anyPropertyNames().has(lower)
      );
    }
  };
}

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams): void => {
  for (const change of params.changes) {
    if (change.type === FileChangeType.Deleted) {
      index.removeDocument(change.uri);
      continue;
    }
    // Skip files that are open in the editor — their live buffer owns the index.
    if (documents.get(change.uri)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(URI.parse(change.uri).fsPath);
      index.updateDocument(change.uri, decodePBExport(raw));
    } catch {
      // Ignore files that disappeared or are unreadable.
    }
  }
});

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (doc) {
    const linePrefix = doc.getText({
      start: { line: params.position.line, character: 0 },
      end: params.position
    });

    // Embedded SQL host variables: `SELECT col INTO :ls_name FROM ...`
    if (/:[A-Za-z_]?\w*$/.test(linePrefix) && isSqlContext(doc, params.position.line)) {
      return hostVariableCompletion(doc, params.position);
    }

    // Event stub: `event ` offers the built-in events of the current object type
    if (/^\s*event\s+\w*$/i.test(linePrefix)) {
      return eventStubCompletion(doc);
    }

    // DataWindow object-expression chain: `dw_ctrl.object.<column>`
    const objectChain = /([A-Za-z_]\w*)\s*\.\s*object\s*\.\s*\w*$/i.exec(linePrefix);
    if (objectChain) {
      return dataWindowColumnCompletion(doc, params.position, objectChain[1]);
    }

    // Member access, including chains like `this.idw_main.` / `GetApplication().`
    const chainMatch =
      /([A-Za-z_]\w*(?:\s*\([^()]*\))?(?:\s*\.\s*[A-Za-z_]\w*(?:\s*\([^()]*\))?)*)\s*\.\s*\w*$/.exec(linePrefix);
    if (chainMatch) {
      const segments = parseChainSegments(chainMatch[1]);
      if (segments.length > 0) {
        return memberCompletion(doc, params.position, segments);
      }
    }
  }

  const keywordItems: CompletionItem[] = KEYWORDS.map((keyword) => ({
    label: keyword,
    kind: CompletionItemKind.Keyword
  }));

  // When the active call argument is an enumerated type, float its values first.
  const enumItems: CompletionItem[] = [];
  if (doc) {
    const call = findActiveCall(doc, params.position);
    const fn = call ? findActiveBuiltin(call.name) : undefined;
    if (call && fn && fn.params.length > 0) {
      const param = fn.params[Math.min(call.activeParam, fn.params.length - 1)];
      const en = activeEnums.get(param.type.toLowerCase());
      if (en) {
        for (const value of en.values) {
          enumItems.push({
            label: value,
            kind: CompletionItemKind.EnumMember,
            detail: `${en.name} enumerated value`,
            sortText: `0_${value}`
          });
        }
      }
    }
  }

  // Instance/shared variables from the current object, plus workspace globals.
  const seenVars = new Set<string>();
  const variableItems: CompletionItem[] = [];
  const ownVars = index.variablesIn(params.textDocument.uri);
  const globalVars = index.allVariables().filter((v) => v.scope === 'global');
  for (const v of [...ownVars, ...globalVars]) {
    const key = v.name.toLowerCase();
    if (seenVars.has(key)) {
      continue;
    }
    seenVars.add(key);
    variableItems.push({
      label: v.name,
      kind: CompletionItemKind.Variable,
      detail: `${v.type} ${v.name} (${v.scope})`
    });
  }

  const builtinItems: CompletionItem[] = activeFunctions.map((fn) => ({
    label: fn.name,
    kind: CompletionItemKind.Function,
    detail: formatSignature(fn),
    documentation: { kind: MarkupKind.Markdown, value: formatHover(fn) },
    insertText: `${fn.name}(${fn.params.length > 0 ? '$1' : ''})`,
    insertTextFormat: 2 // Snippet
  }));

  const eventItems: CompletionItem[] = activeEvents.map((ev) => ({
    label: ev.name,
    kind: CompletionItemKind.Event,
    detail: `event ${ev.name}(${ev.params.map(formatParam).join(', ')}) — ${ev.category}`,
    documentation: { kind: MarkupKind.Markdown, value: formatEventHover(ev) }
  }));

  const seen = new Set<string>();
  const customItems: CompletionItem[] = [];
  for (const def of index.all()) {
    if (def.kind === 'type') {
      continue;
    }
    const key = def.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    customItems.push({
      label: def.name,
      kind: def.kind === 'event' ? CompletionItemKind.Event : CompletionItemKind.Method,
      detail: def.signature,
      documentation: { kind: MarkupKind.Markdown, value: describeCustom(def) },
      insertText: `${def.name}(${def.params.length > 0 ? '$1' : ''})`,
      insertTextFormat: 2 // Snippet
    });
  }

  return [...enumItems, ...keywordItems, ...variableItems, ...builtinItems, ...eventItems, ...customItems];
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => item);

connection.onHover((params): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const word = getWordAtPosition(doc, params.position);
  if (!word) {
    return null;
  }

  // Check built-in functions first
  const builtIn = findActiveBuiltin(word);
  if (builtIn) {
    return { contents: { kind: MarkupKind.Markdown, value: formatHover(builtIn) } };
  }

  // Check custom functions/events (a workspace override beats the generic docs)
  const custom = index.findCallable(word) ?? index.find(word)[0];
  if (custom) {
    return { contents: { kind: MarkupKind.Markdown, value: describeCustom(custom) } };
  }

  // Check built-in object events
  const builtinEvent = findActiveEvent(word);
  if (builtinEvent) {
    return { contents: { kind: MarkupKind.Markdown, value: formatEventHover(builtinEvent) } };
  }

  // Check variables
  const variables = index.findVariables(word);
  if (variables.length > 0) {
    const var0 = variables[0];
    const lines: string[] = [];
    lines.push(`**${var0.name}** : \`${var0.type}\` *(${var0.scope})*`);
    lines.push(`Declared at line ${var0.line + 1}`);
    return { contents: { kind: MarkupKind.Markdown, value: lines.join('\n') } };
  }

  // Enumerated value: Identifier!
  const lineText = doc.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line + 1, character: 0 }
  });
  if (new RegExp(`\\b${word}!`, 'i').test(lineText)) {
    for (const en of activeEnums.values()) {
      const hit = en.values.find((v) => v.toLowerCase() === `${word.toLowerCase()}!`);
      if (hit) {
        const lines = [
          `**${hit}** — value of the \`${en.name}\` enumerated datatype`,
          '',
          `All values: ${en.values.map((v) => `\`${v}\``).join(', ')}`
        ];
        return { contents: { kind: MarkupKind.Markdown, value: lines.join('\n') } };
      }
    }
  }

  // Property accessed through a resolvable receiver chain (`this.Title`)
  let wordStart = params.position.character;
  while (wordStart > 0 && /[A-Za-z0-9_]/.test(lineText[wordStart - 1])) {
    wordStart--;
  }
  const receiverPrefix = lineText.slice(0, wordStart);
  const chainBefore =
    /([A-Za-z_]\w*(?:\s*\([^()]*\))?(?:\s*\.\s*[A-Za-z_]\w*(?:\s*\([^()]*\))?)*)\s*\.\s*$/.exec(receiverPrefix);
  if (chainBefore) {
    const receiverType = resolveChainType(doc, params.position, parseChainSegments(chainBefore[1]));
    if (receiverType) {
      const chain = index.getInheritanceChain(receiverType);
      for (const t of chain.length > 0 ? chain : [receiverType.toLowerCase()]) {
        const prop = activeProperties.get(t)?.find((p) => p.name.toLowerCase() === word.toLowerCase());
        if (prop) {
          const lines = [`**${prop.name}** : \`${prop.type}\` — *property of ${t}*`];
          if (prop.description) {
            lines.push('', prop.description);
          }
          return { contents: { kind: MarkupKind.Markdown, value: lines.join('\n') } };
        }
      }
    }
  }

  // Check types and show inheritance chain
  const typeDefs = index.find(word).filter((def) => def.kind === 'type');
  if (typeDefs.length > 0) {
    const typeDef = typeDefs[0];
    const chain = index.getInheritanceChain(word);
    const lines: string[] = [];
    lines.push(`**type** \`${typeDef.name}\``);
    if (chain.length > 1) {
      lines.push('');
      lines.push('**Inheritance chain:**');
      lines.push(chain.map((t, i) => `${' '.repeat(i * 2)}└ ${t}`).join('\n'));
    }
    const children = index.getChildTypes(word);
    if (children.length > 0) {
      lines.push('');
      lines.push('**Direct descendants:**');
      lines.push(children.map((c) => `- ${c}`).join('\n'));
    }
    return { contents: { kind: MarkupKind.Markdown, value: lines.join('\n') } };
  }

  return null;
});

connection.onDefinition((params): Definition | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const word = getWordAtPosition(doc, params.position);
  if (!word) {
    return null;
  }

  const defs = index.find(word);
  if (defs.length === 0) {
    // DataWindow column names jump into their .srd definition
    const columns = index.findColumns(word);
    if (columns.length > 0) {
      const locations = columns.map((col) =>
        Location.create(col.uri, {
          start: { line: col.line, character: col.character },
          end: { line: col.line, character: col.character + word.length }
        })
      );
      return locations.length === 1 ? locations[0] : locations;
    }
    return null;
  }

  const locations = defs.map((def) =>
    Location.create(def.uri, {
      start: { line: def.line, character: def.character },
      end: { line: def.line, character: def.character + def.name.length }
    })
  );

  return locations.length === 1 ? locations[0] : locations;
});

connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const call = findActiveCall(doc, params.position);
  if (!call) {
    return null;
  }

  const builtIn = findActiveBuiltin(call.name);
  if (builtIn) {
    if ((builtIn.variants?.length ?? 0) >= 2) {
      return buildVariantSignatureHelp(builtIn.name, builtIn.variants!, call.activeParam, builtIn.documentation);
    }
    return buildSignatureHelp(builtIn.name, formatSignature(builtIn), builtIn.params, call.activeParam, builtIn.documentation);
  }

  const custom = index.findCallable(call.name);
  if (custom) {
    return buildSignatureHelp(custom.name, custom.signature, custom.params, call.activeParam, describeCustom(custom));
  }

  // Built-in object events, for call sites like `obj.EVENT Clicked(...)`.
  const builtinEvent = findActiveEvent(call.name);
  if (builtinEvent && (builtinEvent.variants?.length ?? 0) >= 2) {
    return buildVariantSignatureHelp(
      builtinEvent.name,
      builtinEvent.variants!,
      call.activeParam,
      formatEventHover(builtinEvent)
    );
  }
  if (builtinEvent && builtinEvent.params.length > 0) {
    const label = `event ${builtinEvent.name}(${builtinEvent.params.map(formatParam).join(', ')})`;
    return buildSignatureHelp(
      builtinEvent.name,
      label,
      builtinEvent.params,
      call.activeParam,
      formatEventHover(builtinEvent)
    );
  }

  return null;
});

const SEMANTIC_TOKEN_TYPES = ['function', 'variable', 'enumMember', 'type', 'property', 'event'];
const TOKEN_IDX: Record<string, number> = Object.fromEntries(
  SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i])
);

connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return { data: [] };
  }
  const lines = doc.getText().split(/\r?\n/);
  const cleaned = stripCommentsAndStrings(lines);

  const docVarNames = new Set<string>();
  for (const v of index.variablesIn(doc.uri)) {
    docVarNames.add(v.name.toLowerCase());
  }
  for (let i = 0; i < lines.length; i++) {
    for (const decl of parseVariableDeclaration(lines[i], i, doc.uri, 'local')) {
      if (!NON_TYPE_KEYWORDS.has(decl.type.toLowerCase())) {
        docVarNames.add(decl.name.toLowerCase());
      }
    }
  }
  const enumValues = new Set<string>();
  for (const en of activeEnums.values()) {
    for (const v of en.values) {
      enumValues.add(v.toLowerCase());
    }
  }

  const tokens: { line: number; char: number; length: number; type: number }[] = [];
  const WORD_RE = /[A-Za-z_]\w*!?/g;
  for (let i = 0; i < cleaned.length; i++) {
    const clean = cleaned[i];
    WORD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WORD_RE.exec(clean)) !== null) {
      const word = match[0];
      const lower = word.toLowerCase();
      const start = match.index;
      const prev = clean.slice(0, start).trimEnd();
      const after = clean.slice(start + word.length);

      if (word.endsWith('!')) {
        if (enumValues.has(lower)) {
          tokens.push({ line: i, char: start, length: word.length, type: TOKEN_IDX.enumMember });
        }
        continue;
      }
      const isCall = /^\s*\(/.test(after);
      const afterDot = prev.endsWith('.');
      if (isCall && !STATEMENT_LIKE.has(lower)) {
        const custom = index.findCallable(word);
        if (custom?.kind === 'event' || (!custom && !findActiveBuiltin(word) && findActiveEvent(word))) {
          tokens.push({ line: i, char: start, length: word.length, type: TOKEN_IDX.event });
        } else if (custom || findActiveBuiltin(word)) {
          tokens.push({ line: i, char: start, length: word.length, type: TOKEN_IDX.function });
        }
        continue;
      }
      if (afterDot) {
        if (anyPropertyNames().has(lower)) {
          tokens.push({ line: i, char: start, length: word.length, type: TOKEN_IDX.property });
        }
        continue;
      }
      if (docVarNames.has(lower)) {
        tokens.push({ line: i, char: start, length: word.length, type: TOKEN_IDX.variable });
        continue;
      }
      if (index.find(word).some((d) => d.kind === 'type')) {
        tokens.push({ line: i, char: start, length: word.length, type: TOKEN_IDX.type });
      }
    }
  }

  tokens.sort((a, b) => a.line - b.line || a.char - b.char);
  const builder = new SemanticTokensBuilder();
  for (const t of tokens) {
    builder.push(t.line, t.char, t.length, t.type, 0);
  }
  return builder.build();
});

/** Control words that look like calls but are never callables. */
const STATEMENT_LIKE = new Set([
  'if', 'elseif', 'while', 'until', 'for', 'choose', 'case', 'catch', 'return',
  'throw', 'when', 'not', 'and', 'or', 'create', 'destroy', 'call', 'on', 'is'
]);

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  const symbols = index.symbolsIn(params.textDocument.uri);
  return symbols
    .filter((def) => def.kind !== 'variable')
    .map((def) => {
      const range = {
        start: { line: def.line, character: def.character },
        end: { line: def.line, character: def.character + def.name.length }
      };
      return {
        name: def.name,
        detail: def.signature,
        kind: symbolKindFor(def),
        range,
        selectionRange: range
      };
    });
});

connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  return computeFoldingRanges(doc.getText()).map((r) => ({
    startLine: r.startLine,
    endLine: r.endLine
  }));
});

connection.onReferences((params: ReferenceParams): Location[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  const word = getWordAtPosition(doc, params.position);
  if (!word) {
    return [];
  }
  return index.references(word).map((ref) =>
    Location.create(ref.uri, {
      start: { line: ref.line, character: ref.character },
      end: { line: ref.line, character: ref.character + word.length }
    })
  );
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }
  const word = getWordAtPosition(doc, params.position);
  if (!word || !/^[A-Za-z_]\w*$/.test(params.newName)) {
    return null;
  }
  const changes: { [uri: string]: TextEdit[] } = {};
  for (const ref of index.references(word)) {
    (changes[ref.uri] ??= []).push(
      TextEdit.replace(
        {
          start: { line: ref.line, character: ref.character },
          end: { line: ref.line, character: ref.character + word.length }
        },
        params.newName
      )
    );
  }
  return { changes };
});

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
  return index.search(params.query).map((def) => ({
    name: def.name,
    kind: symbolKindFor(def),
    location: Location.create(def.uri, {
      start: { line: def.line, character: def.character },
      end: { line: def.line, character: def.character + def.name.length }
    }),
    containerName: def.container
  }));
});

// ------------------------------------------------------- member completion

/**
 * Built-in object types whose catalog category differs from the type name.
 * Everything else matches by case-insensitive type name === category.
 */
const TYPE_CATEGORY_ALIASES: Record<string, string[]> = {
  datastore: ['DataWindow'],
  datawindowchild: ['DataWindow'],
  dropdownlistbox: ['ListBox'],
  dropdownpicturelistbox: ['PictureListBox', 'ListBox'],
  picturelistbox: ['PictureListBox', 'ListBox'],
  olecontrol: ['OLE'],
  olecustomcontrol: ['OLE'],
  restclient: ['RESTClient', 'RestClient'],
  crypterobject: ['Encryption'],
  coderobject: ['Encoding'],
  compressorobject: ['Compression'],
  extractorobject: ['Compression'],
  progressbar: ['Progress bar'],
  hprogressbar: ['Progress bar'],
  vprogressbar: ['Progress bar'],
  mdiclient: ['MDI frame'],
  inet: ['Inet (Obsolete)']
};

/** Member functions every PowerObject descendant understands. */
const UNIVERSAL_MEMBERS = ['TriggerEvent', 'PostEvent', 'ClassName', 'GetParent'];

/** Statement keywords that must never be mistaken for a declaration type. */
const NON_TYPE_KEYWORDS = new Set([
  'return', 'if', 'then', 'else', 'elseif', 'end', 'for', 'next', 'do', 'loop',
  'while', 'until', 'choose', 'case', 'try', 'catch', 'finally', 'throw',
  'call', 'create', 'destroy', 'open', 'close', 'halt', 'goto', 'exit',
  'continue', 'not', 'and', 'or', 'event', 'function', 'subroutine', 'on'
]);

/**
 * Resolves the declared type of an identifier at a position: local declarations
 * in the enclosing script first (scanning backwards, stopping at a script
 * boundary), then indexed instance/shared/global variables, then `this`/`super`.
 */
function resolveReceiverType(doc: TextDocument, position: { line: number }, receiver: string): string | undefined {
  const lower = receiver.toLowerCase();

  if (lower === 'this' || lower === 'super') {
    const mainType = index
      .symbolsIn(doc.uri)
      .find((def) => def.kind === 'type' && !!def.container);
    if (!mainType) {
      return undefined;
    }
    return lower === 'this' ? mainType.name : mainType.container;
  }

  const lines = doc.getText().split(/\r?\n/);
  const stop = Math.max(0, position.line - 400);
  const createRe = new RegExp(`^\\s*${lower}\\s*=\\s*create\\s+([A-Za-z_]\\w*)`, 'i');
  const getChildRe = new RegExp(`\\.\\s*GetChild\\s*\\([^,]+,\\s*${lower}\\s*\\)`, 'i');
  for (let i = position.line - 1; i >= stop; i--) {
    const line = lines[i];
    if (/^\s*end\s+(function|subroutine|event)\b/i.test(line)) {
      break; // left the enclosing script
    }
    // Nearest information wins: a CREATE assignment or a GetChild ref-argument
    // is more specific than the declared type (powerobject, datawindowchild).
    const created = createRe.exec(line);
    if (created && !/^using$/i.test(created[1])) {
      return created[1];
    }
    if (getChildRe.test(line)) {
      return 'datawindowchild';
    }
    for (const decl of parseVariableDeclaration(line, i, doc.uri, 'local')) {
      if (decl.name.toLowerCase() === lower && !NON_TYPE_KEYWORDS.has(decl.type.toLowerCase())) {
        return decl.type;
      }
    }
  }

  const indexed = index.findVariables(receiver);
  if (indexed.length > 0) {
    return indexed[0].type;
  }
  return undefined;
}

/** Completion items for the members of one built-in object type. */
function builtinMemberItems(typeName: string): CompletionItem[] {
  const lower = typeName.toLowerCase();
  const categories = new Set(
    (TYPE_CATEGORY_ALIASES[lower] ?? [typeName]).map((c) => c.toLowerCase())
  );

  const applies = (fn: { category: string; appliesTo?: string[] }): boolean =>
    (fn.appliesTo ?? [fn.category]).some((t) => categories.has(t.toLowerCase()));

  const fnItems: CompletionItem[] = activeFunctions
    .filter((fn) => fn.member !== false && applies(fn))
    .map((fn) => ({
      label: fn.name,
      kind: CompletionItemKind.Method,
      detail: formatSignature(fn),
      documentation: { kind: MarkupKind.Markdown, value: formatHover(fn) },
      insertText: `${fn.name}(${fn.params.length > 0 ? '$1' : ''})`,
      insertTextFormat: 2
    }));

  const evItems: CompletionItem[] = activeEvents
    .filter((ev) => applies(ev))
    .map((ev) => ({
      label: ev.name,
      kind: CompletionItemKind.Event,
      detail: `event ${ev.name}(${ev.params.map(formatParam).join(', ')})`,
      documentation: { kind: MarkupKind.Markdown, value: formatEventHover(ev) }
    }));

  return [...fnItems, ...evItems];
}

/** Splits `a.b(x).c` into [{name:'a'},{name:'b',call:true},{name:'c'}]. */
function parseChainSegments(chain: string): { name: string; call: boolean }[] {
  const segments: { name: string; call: boolean }[] = [];
  const re = /([A-Za-z_]\w*)(\s*\([^()]*\))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(chain)) !== null) {
    segments.push({ name: match[1], call: match[2] !== undefined });
  }
  return segments;
}

/** The declared type of `member` accessed on an instance of `typeName`. */
function memberTypeOf(typeName: string, member: string, isCall: boolean): string | undefined {
  const chain = index.getInheritanceChain(typeName);
  const walk = chain.length > 0 ? chain : [typeName.toLowerCase()];
  const lower = member.toLowerCase();

  for (const t of walk) {
    if (!isCall) {
      const prop = activeProperties.get(t)?.find((p) => p.name.toLowerCase() === lower);
      if (prop) {
        return prop.type;
      }
      const uri = index.uriForType(t);
      if (uri) {
        const iv = index.variablesIn(uri).find((v) => v.name.toLowerCase() === lower);
        if (iv) {
          return iv.type;
        }
      }
    } else {
      const uri = index.uriForType(t);
      const fn = uri
        ? index.symbolsIn(uri).find((d) => d.kind !== 'type' && d.name.toLowerCase() === lower)
        : undefined;
      if (fn?.returnType) {
        return fn.returnType;
      }
    }
  }
  if (isCall) {
    const builtin = findActiveBuiltin(member);
    if (builtin && /^[A-Za-z_]\w*$/.test(builtin.returnType)) {
      return builtin.returnType;
    }
    const custom = index.findCallable(member);
    if (custom?.returnType) {
      return custom.returnType;
    }
  }
  return undefined;
}

/**
 * Resolves the type at the end of a member chain (`this.idw_main` → the type
 * of idw_main; `GetApplication()` → application). Undefined when any link
 * fails to resolve.
 */
function resolveChainType(
  doc: TextDocument,
  position: { line: number },
  segments: { name: string; call: boolean }[]
): string | undefined {
  const [base, ...rest] = segments;
  let current = base.call
    ? memberTypeOf('', base.name, true)
    : resolveReceiverType(doc, position, base.name);
  for (const seg of rest) {
    if (!current) {
      return undefined;
    }
    current = memberTypeOf(current, seg.name, seg.call);
  }
  return current;
}

/**
 * Members offered after `receiver.` — walks the resolved type's inheritance
 * chain, mixing workspace-defined functions/events with the built-in catalog
 * members of any ancestor that is a built-in object type.
 */
function memberCompletion(
  doc: TextDocument,
  position: { line: number },
  segments: { name: string; call: boolean }[]
): CompletionItem[] {
  const typeName = resolveChainType(doc, position, segments);
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  const push = (item: CompletionItem): void => {
    const key = item.label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  };

  if (typeName) {
    if (DATAWINDOW_TYPES.has(typeName.toLowerCase())) {
      push({
        label: 'Object',
        kind: CompletionItemKind.Field,
        detail: 'DataWindow object expression — dw.Object.<column> reaches columns and properties'
      });
      push({
        label: 'DataObject',
        kind: CompletionItemKind.Field,
        detail: 'string DataObject — name of the DataWindow object bound to this control'
      });
    }
    const chain = index.getInheritanceChain(typeName);
    const walk = chain.length > 0 ? chain : [typeName.toLowerCase()];
    for (const t of walk) {
      const uri = index.uriForType(t);
      if (uri) {
        for (const def of index.symbolsIn(uri)) {
          if (def.kind === 'type') {
            continue;
          }
          push({
            label: def.name,
            kind: def.kind === 'event' ? CompletionItemKind.Event : CompletionItemKind.Method,
            detail: def.signature,
            documentation: { kind: MarkupKind.Markdown, value: describeCustom(def) },
            insertText: `${def.name}(${def.params.length > 0 ? '$1' : ''})`,
            insertTextFormat: 2
          });
        }
        for (const v of index.variablesIn(uri).filter((iv) => iv.scope === 'instance')) {
          push({
            label: v.name,
            kind: CompletionItemKind.Field,
            detail: `${v.type} ${v.name} (instance)`
          });
        }
      }
      for (const item of builtinMemberItems(t)) {
        push(item);
      }
      for (const prop of activeProperties.get(t) ?? []) {
        push({
          label: prop.name,
          kind: CompletionItemKind.Property,
          detail: `${prop.type} ${prop.name}`,
          documentation: prop.description
            ? { kind: MarkupKind.Markdown, value: prop.description }
            : undefined
        });
      }
    }
  } else {
    // Unresolved receiver: fall back to every documented member function/event
    // plus workspace callables, so completion stays useful on library types.
    for (const fn of activeFunctions.filter((f) => f.member)) {
      push({
        label: fn.name,
        kind: CompletionItemKind.Method,
        detail: formatSignature(fn),
        documentation: { kind: MarkupKind.Markdown, value: formatHover(fn) },
        insertText: `${fn.name}(${fn.params.length > 0 ? '$1' : ''})`,
        insertTextFormat: 2
      });
    }
    for (const def of index.all()) {
      if (def.kind === 'function' || def.kind === 'subroutine' || def.kind === 'event') {
        push({
          label: def.name,
          kind: def.kind === 'event' ? CompletionItemKind.Event : CompletionItemKind.Method,
          detail: def.signature,
          insertText: `${def.name}(${def.params.length > 0 ? '$1' : ''})`,
          insertTextFormat: 2
        });
      }
    }
  }

  for (const name of UNIVERSAL_MEMBERS) {
    const fn = findActiveBuiltin(name);
    if (fn) {
      push({
        label: fn.name,
        kind: CompletionItemKind.Method,
        detail: formatSignature(fn),
        documentation: { kind: MarkupKind.Markdown, value: formatHover(fn) },
        insertText: `${fn.name}(${fn.params.length > 0 ? '$1' : ''})`,
        insertTextFormat: 2
      });
    }
  }

  return items;
}

/** SQL verbs that begin an embedded SQL statement in PowerScript. */
const SQL_VERBS =
  /^(select|selectblob|insert|update|updateblob|delete|fetch|declare|connect|disconnect|commit|rollback|execute)\b/i;

/**
 * True when the cursor line sits inside an embedded SQL statement: an
 * unterminated statement above it starts with a SQL verb.
 */
function isSqlContext(doc: TextDocument, line: number): boolean {
  const lines = doc.getText().split(/\r?\n/);
  for (let i = line; i >= 0 && i > line - 25; i--) {
    const trimmed = lines[i].trim();
    if (i < line && /;\s*$/.test(trimmed)) {
      return false; // previous statement already terminated
    }
    if (SQL_VERBS.test(trimmed)) {
      return true;
    }
    if (i < line && /^(end\s|event\s|function\s|subroutine\s)/i.test(trimmed)) {
      return false;
    }
  }
  return false;
}

/** `:hostvar` completion inside embedded SQL — every variable in scope. */
function hostVariableCompletion(doc: TextDocument, position: { line: number }): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  const push = (name: string, type: string, scope: string): void => {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: `${type} ${name} (${scope})`
      });
    }
  };

  const lines = doc.getText().split(/\r?\n/);
  const stop = Math.max(0, position.line - 400);
  for (let i = position.line - 1; i >= stop; i--) {
    if (/^\s*end\s+(function|subroutine|event)\b/i.test(lines[i])) {
      break;
    }
    for (const decl of parseVariableDeclaration(lines[i], i, doc.uri, 'local')) {
      if (!NON_TYPE_KEYWORDS.has(decl.type.toLowerCase())) {
        push(decl.name, decl.type, 'local');
      }
    }
  }
  for (const v of index.variablesIn(doc.uri)) {
    push(v.name, v.type, v.scope);
  }
  for (const v of index.allVariables()) {
    if (v.scope === 'global') {
      push(v.name, v.type, 'global');
    }
  }
  return items;
}

/**
 * `event ` completion: stubs for the built-in events of the current object's
 * type chain (or every event when the type cannot be resolved), inserted as a
 * ready `name; ... end event` skeleton.
 */
function eventStubCompletion(doc: TextDocument): CompletionItem[] {
  const mainType = index.symbolsIn(doc.uri).find((def) => def.kind === 'type' && !!def.container);
  let events = activeEvents;
  if (mainType) {
    const chain = index.getInheritanceChain(mainType.name);
    const categories = new Set<string>();
    for (const t of chain) {
      for (const c of TYPE_CATEGORY_ALIASES[t] ?? [t]) {
        categories.add(c.toLowerCase());
      }
    }
    const applicable = activeEvents.filter((ev) =>
      (ev.appliesTo ?? [ev.category]).some((t) => categories.has(t.toLowerCase()))
    );
    if (applicable.length > 0) {
      events = applicable;
    }
  }

  return events.map((ev) => ({
    label: ev.name,
    kind: CompletionItemKind.Event,
    detail: `event ${ev.name}(${ev.params.map(formatParam).join(', ')}) — ${ev.category}`,
    documentation: { kind: MarkupKind.Markdown, value: formatEventHover(ev) },
    insertText: `${ev.name};\n\t$0\nend event`,
    insertTextFormat: 2
  }));
}

/** Built-in types that carry a DataWindow object expression (`.object.`). */
const DATAWINDOW_TYPES = new Set(['datawindow', 'datastore', 'datawindowchild', 'u_dw']);

/**
 * Finds the DataWindow object bound to a control: an explicit
 * `receiver.dataobject = "d_x"` assignment in the current document first, then
 * a `dataobject = "d_x"` property inside the control's exported type block.
 */
function resolveDataObject(doc: TextDocument, receiver: string): string | undefined {
  const text = doc.getText();
  const assign = new RegExp(`\\b${receiver}\\s*\\.\\s*dataobject\\s*=\\s*['"]([\\w$#%-]+)['"]`, 'i').exec(text);
  if (assign) {
    return assign[1];
  }
  const typeBlock = new RegExp(
    `\\btype\\s+${receiver}\\s+from\\b[\\s\\S]*?dataobject\\s*=\\s*"([\\w$#%-]+)"`,
    'i'
  ).exec(text);
  if (typeBlock) {
    return typeBlock[1];
  }
  // Bindings made in other indexed documents (open + closed files)
  return index.dataObjectFor(receiver);
}

/**
 * Column completion for `dw.object.` — columns of the bound DataWindow object
 * when the binding is known and indexed, otherwise the union of every indexed
 * .srd's columns (labeled with their source object).
 */
function dataWindowColumnCompletion(
  doc: TextDocument,
  position: { line: number },
  receiver: string
): CompletionItem[] {
  const receiverType = resolveReceiverType(doc, position, receiver)?.toLowerCase();
  if (receiverType && !DATAWINDOW_TYPES.has(receiverType) && !index.uriForType(receiverType)) {
    return [];
  }

  const bound = resolveDataObject(doc, receiver);
  if (bound) {
    const columns = index.columnsForDataObject(bound);
    if (columns.length > 0) {
      return columns.map((col) => ({
        label: col.name,
        kind: CompletionItemKind.Field,
        detail: `column (${bound})`
      }));
    }
  }

  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  for (const [dataObject, entry] of index.allDataObjects()) {
    for (const col of entry.columns) {
      const key = col.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ label: col.name, kind: CompletionItemKind.Field, detail: `column (${dataObject})` });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------- helpers

function collectWorkspacePaths(params: InitializeParams): string[] {
  const paths: string[] = [];
  if (params.workspaceFolders) {
    for (const folder of params.workspaceFolders) {
      paths.push(URI.parse(folder.uri).fsPath);
    }
  } else if (params.rootUri) {
    paths.push(URI.parse(params.rootUri).fsPath);
  } else if (params.rootPath) {
    paths.push(params.rootPath);
  }
  return paths;
}

function describeCustom(def: SymbolDefinition): string {
  const lines: string[] = [];
  const kindLabel = def.kind.charAt(0).toUpperCase() + def.kind.slice(1);
  lines.push(`**${def.name}** — *${kindLabel}*`);
  lines.push('');
  lines.push('```powerbuilder');
  lines.push(def.signature);
  lines.push('```');

  if (def.params.length > 0) {
    lines.push('');
    lines.push('**Parameters**');
    for (const param of def.params) {
      lines.push(`- \`${param.name}\` \`${param.type}\``);
    }
  }
  if (def.returnType) {
    lines.push('');
    lines.push(`*Returns* \`${def.returnType}\``);
  }
  return lines.join('\n');
}

function symbolKindFor(def: SymbolDefinition): SymbolKind {
  switch (def.kind) {
    case 'type':
      return SymbolKind.Class;
    case 'event':
      return SymbolKind.Event;
    case 'subroutine':
      return SymbolKind.Method;
    default:
      return SymbolKind.Function;
  }
}

/**
 * Signature help across every documented syntax variant. The active signature
 * is the first variant that can still accept the argument being typed.
 */
function buildVariantSignatureHelp(
  name: string,
  variants: VariantInfo[],
  activeParam: number,
  documentation: string
): SignatureHelp {
  const signatures: SignatureInformation[] = variants.map((variant) => {
    const ret = variant.returnType ? `${variant.returnType} ` : '';
    const label = variant.syntax
      ? variant.syntax
      : `${ret}${name}(${variant.params.map(formatParam).join(', ')})`;
    const doc = variant.label ? `**${variant.label}**\n\n${documentation}` : documentation;
    return {
      label,
      documentation: { kind: MarkupKind.Markdown, value: doc },
      parameters: variant.params.map((param) => ({
        label: `${param.type} ${param.name}`,
        documentation: param.description
          ? { kind: MarkupKind.Markdown, value: param.description }
          : undefined
      }))
    } as SignatureInformation;
  });

  let active = variants.findIndex((v) => v.params.length > activeParam);
  if (active === -1) {
    active = 0;
  }
  return {
    signatures,
    activeSignature: active,
    activeParameter: Math.min(activeParam, Math.max(0, (variants[active]?.params.length ?? 1) - 1))
  };
}

function buildSignatureHelp(
  name: string,
  signatureLabel: string,
  params: ParamInfo[],
  activeParam: number,
  documentation: string
): SignatureHelp {
  const parameters: ParameterInformation[] = params.map((param) => ({
    label: `${param.type} ${param.name}`,
    documentation: param.description
      ? { kind: MarkupKind.Markdown, value: param.description }
      : undefined
  }));

  const active = params.length === 0 ? 0 : Math.min(activeParam, params.length - 1);

  return {
    signatures: [
      {
        label: signatureLabel,
        documentation: { kind: MarkupKind.Markdown, value: documentation },
        parameters
      } as SignatureInformation
    ],
    activeSignature: 0,
    activeParameter: active
  };
}

documents.listen(connection);
connection.listen();

// ---------------------------------------------------------------- configuration

async function loadConfiguration(): Promise<void> {
  try {
    const config = await connection.workspace.getConfiguration('powerbuilder');
    const version = typeof config?.version === 'string' ? config.version : '2025';

    if (version === '2022') {
      pbVersion = '2022';
      activeFunctions = builtinFunctions2022;
      findActiveBuiltin = findBuiltin2022;
      activeEvents = builtinEvents2022;
      findActiveEvent = findBuiltinEvent2022;
      activeProperties = propertyMap2022;
      activeEnums = enumMap2022;
      otherFindBuiltin = findBuiltin2025;
      otherFindEvent = findBuiltinEvent2025;
      otherVersion = '2025';
    } else {
      pbVersion = '2025';
      activeFunctions = builtinFunctions2025;
      findActiveBuiltin = findBuiltin2025;
      activeEvents = builtinEvents2025;
      findActiveEvent = findBuiltinEvent2025;
      activeProperties = propertyMap2025;
      activeEnums = enumMap2025;
      otherFindBuiltin = findBuiltin2022;
      otherFindEvent = findBuiltinEvent2022;
      otherVersion = '2022';
    }

    connection.console.log(`PowerBuilder version set to: ${pbVersion}`);
  } catch (e) {
    connection.console.error(`Failed to load configuration: ${e}`);
  }
}
