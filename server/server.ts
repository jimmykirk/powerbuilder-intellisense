import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  Definition,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesParams,
  FileChangeType,
  Hover,
  InitializeParams,
  InitializeResult,
  Location,
  MarkupKind,
  ParameterInformation,
  ProposedFeatures,
  SignatureHelp,
  SignatureHelpParams,
  SignatureInformation,
  SymbolInformation,
  SymbolKind,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
  WorkspaceSymbolParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import { formatEventHover, formatHover, formatParam, formatSignature, ParamInfo } from './builtins';
import {
  builtinEvents2022,
  builtinFunctions2022,
  findBuiltin2022,
  findBuiltinEvent2022
} from './builtins-2022';
import {
  builtinEvents2025,
  builtinFunctions2025,
  findBuiltin2025,
  findBuiltinEvent2025
} from './builtins-2025';
import { parseVariableDeclaration, SymbolDefinition, WorkspaceIndex } from './indexer';
import { computeDiagnostics, SemanticContext } from './diagnostics';
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
        triggerCharacters: ['.']
      },
      hoverProvider: true,
      definitionProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
        retriggerCharacters: [',']
      },
      workspaceSymbolProvider: true
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

documents.onDidChangeContent((change): void => {
  index.updateDocument(change.document.uri, change.document.getText());
  connection.sendDiagnostics({
    uri: change.document.uri,
    diagnostics: computeDiagnostics(
      change.document.getText(),
      buildSemanticContext(change.document.getText())
    )
  });
});

/**
 * Name resolution for semantic diagnostics: built-in functions and events of
 * the active PB version, every indexed workspace callable/variable/type, and
 * identifiers declared anywhere in the current document (loose local scan, so
 * script-local declarations are never flagged).
 */
function buildSemanticContext(text: string): SemanticContext {
  const localNames = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const decl of parseVariableDeclaration(lines[i], i, '', 'local')) {
      localNames.add(decl.name.toLowerCase());
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
    maxArgs: (name) => {
      const fn = findActiveBuiltin(name);
      if (!fn || fn.variadic || index.find(name).length > 0) {
        return undefined; // unknown arity, or shadowed by a workspace symbol
      }
      return fn.params.length;
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
      const text = fs.readFileSync(URI.parse(change.uri).fsPath, 'utf8');
      index.updateDocument(change.uri, text);
    } catch {
      // Ignore files that disappeared or are unreadable.
    }
  }
});

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  // Member completion when the cursor sits after `receiver.`
  const doc = documents.get(params.textDocument.uri);
  if (doc) {
    const linePrefix = doc.getText({
      start: { line: params.position.line, character: 0 },
      end: params.position
    });
    // DataWindow object-expression chain: `dw_ctrl.object.<column>`
    const objectChain = /([A-Za-z_]\w*)\s*\.\s*object\s*\.\s*\w*$/i.exec(linePrefix);
    if (objectChain) {
      return dataWindowColumnCompletion(doc, params.position, objectChain[1]);
    }

    const dot = /([A-Za-z_]\w*)\s*\.\s*(\w*)$/.exec(linePrefix);
    if (dot) {
      return memberCompletion(doc, params.position, dot[1]);
    }
  }

  const keywordItems: CompletionItem[] = KEYWORDS.map((keyword) => ({
    label: keyword,
    kind: CompletionItemKind.Keyword
  }));

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

  return [...keywordItems, ...variableItems, ...builtinItems, ...eventItems, ...customItems];
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
    return buildSignatureHelp(builtIn.name, formatSignature(builtIn), builtIn.params, call.activeParam, builtIn.documentation);
  }

  const custom = index.findCallable(call.name);
  if (custom) {
    return buildSignatureHelp(custom.name, custom.signature, custom.params, call.activeParam, describeCustom(custom));
  }

  // Built-in object events, for call sites like `obj.EVENT Clicked(...)`.
  const builtinEvent = findActiveEvent(call.name);
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
  for (let i = position.line - 1; i >= stop; i--) {
    const line = lines[i];
    if (/^\s*end\s+(function|subroutine|event)\b/i.test(line)) {
      break; // left the enclosing script
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

/**
 * Members offered after `receiver.` — walks the resolved type's inheritance
 * chain, mixing workspace-defined functions/events with the built-in catalog
 * members of any ancestor that is a built-in object type.
 */
function memberCompletion(doc: TextDocument, position: { line: number }, receiver: string): CompletionItem[] {
  const typeName = resolveReceiverType(doc, position, receiver);
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
  return typeBlock?.[1];
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
        label: col,
        kind: CompletionItemKind.Field,
        detail: `column (${bound})`
      }));
    }
  }

  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  for (const [dataObject, columns] of index.allDataObjects()) {
    for (const col of columns) {
      const key = col.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ label: col, kind: CompletionItemKind.Field, detail: `column (${dataObject})` });
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
    } else {
      pbVersion = '2025';
      activeFunctions = builtinFunctions2025;
      findActiveBuiltin = findBuiltin2025;
      activeEvents = builtinEvents2025;
      findActiveEvent = findBuiltinEvent2025;
    }

    connection.console.log(`PowerBuilder version set to: ${pbVersion}`);
  } catch (e) {
    connection.console.error(`Failed to load configuration: ${e}`);
  }
}
