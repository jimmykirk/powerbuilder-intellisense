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
import {
  builtinFunctions,
  findBuiltin,
  formatHover,
  formatSignature,
  ParamInfo
} from './builtins';
import { findBuiltin2022, builtinFunctions2022 } from './builtins-2022';
import { findBuiltin2025, builtinFunctions2025 } from './builtins-2025';
import { SymbolDefinition, WorkspaceIndex } from './indexer';
import { computeDiagnostics } from './diagnostics';
import { findActiveCall, getWordAtPosition } from './textutils';
import { discoverWorkspace } from './workspace';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
const index = new WorkspaceIndex();

let hasConfigurationCapability = false;
let pbVersion: '2022' | '2025' = '2025'; // Default
let activeFunctions = builtinFunctions2025;
let findActiveBuiltin = findBuiltin2025;

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
    diagnostics: computeDiagnostics(change.document.getText())
  });
});

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

connection.onCompletion((_position: TextDocumentPositionParams): CompletionItem[] => {
  const keywordItems: CompletionItem[] = KEYWORDS.map((keyword) => ({
    label: keyword,
    kind: CompletionItemKind.Keyword
  }));

  const builtinItems: CompletionItem[] = activeFunctions.map((fn) => ({
    label: fn.name,
    kind: CompletionItemKind.Function,
    detail: formatSignature(fn),
    documentation: { kind: MarkupKind.Markdown, value: formatHover(fn) },
    insertText: `${fn.name}(${fn.params.length > 0 ? '$1' : ''})`,
    insertTextFormat: 2 // Snippet
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

  return [...keywordItems, ...builtinItems, ...customItems];
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

  // Check custom functions/events
  const custom = index.findCallable(word) ?? index.find(word)[0];
  if (custom) {
    return { contents: { kind: MarkupKind.Markdown, value: describeCustom(custom) } };
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
    const version = config.get<string>('version', '2025');

    if (version === '2022') {
      pbVersion = '2022';
      activeFunctions = builtinFunctions2022;
      findActiveBuiltin = findBuiltin2022;
    } else {
      pbVersion = '2025';
      activeFunctions = builtinFunctions2025;
      findActiveBuiltin = findBuiltin2025;
    }

    connection.console.log(`PowerBuilder version set to: ${pbVersion}`);
  } catch (e) {
    connection.console.error(`Failed to load configuration: ${e}`);
  }
}
