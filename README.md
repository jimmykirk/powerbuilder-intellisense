# PowerBuilder IntelliSense (VS Code)

PowerBuilder language support extension for Appeon PowerBuilder 2022 and 2025
(switchable via the `powerbuilder.version` setting).

## Features

- Full built-in catalogs scraped from the official Appeon docs: 914 (PB 2022) /
  1,118 (PB 2025) system functions, 139 / 150 object events (with `pbm_*` IDs),
  2,235 / 2,446 object properties across 155 / 185 classes, ~70 enumerated
  datatypes with their `Value!` lists, and the full DataWindow API from the
  separate DataWindow Reference book — 253 / 254 methods (Retrieve, Update,
  InsertRow, GetItemString, ...) and 57 DataWindow events
- Auto-completion for keywords, built-in functions and events, script locals
  and parameters, instance/shared variables, workspace-wide globals, structure
  members, and custom functions/events indexed across the workspace — ranked so
  your own identifiers come before the 1,100-entry catalog, with documentation
  resolved lazily for the highlighted item only
- Member completion after `.` — resolves the receiver's type from local
  declarations, indexed variables, or `this`/`super`, follows chains like
  `this.idw_main.` and `GetApplication().` through property types and function
  return types, walks the inheritance chain, and offers workspace-defined
  members plus the built-in functions, events, and properties of any built-in
  ancestor (matched via the docs' Applies-to lists)
- Enumerated values floated to the top when the active call argument is an
  enum (`MessageBox("t", "m", ` → `Information!`, `StopSign!`, ...)
- Event stub completion: `event ` offers the built-in events of the current
  object's type and inserts a ready `name; ... end event` skeleton
- Embedded SQL host-variable completion: `:` inside a SQL statement offers
  every variable in scope
- DataWindow-aware completions: DataWindow controls, DataStores, and child
  DataWindows offer their real API with signatures and docs (and win over
  same-named PowerScript entries like RestClient's `Retrieve` when the
  receiver is a DataWindow); `.srd` exports are indexed for column names,
  `dw.Object.` completes the bound DataWindow object's columns (bindings are
  resolved across files, from assignments or exported control properties), and
  DataWindow-typed receivers get `Object`/`DataObject` property items
- Rich hover documentation with per-parameter descriptions for built-in
  functions and events, signatures for custom functions, variable types/scopes,
  and type inheritance chains
- Signature help (parameter hints) while typing a function call, with the
  active argument highlighted — multi-syntax built-ins (Open, Close, Clicked,
  ...) show every documented variant with the best match preselected
- Hover on properties through receiver chains (`this.Title`) and on enumerated
  values (`Information!` shows its enum and sibling values)
- Workspace-wide **Go to Definition** for custom functions, subroutines,
  events, and object types — and DataWindow column names jump into their
  `.srd` definition
- **Find All References** and **Rename** across the workspace (case-insensitive,
  comment/string-aware, matching PowerScript semantics)
- Workspace symbol search (`Ctrl+T`) across all PowerBuilder files
- Parser-based structural diagnostics that flag unmatched block terminators (`if`/`end if`, `for`/`next`, `do`/`loop`, `choose case`/`end choose`, `try`/`end try`, function/subroutine/event/type blocks), ignoring keywords inside comments and strings
- Semantic call diagnostics (debounced while typing): unknown functions
  (Information), too many arguments to a built-in (Warning), literal arguments
  that cannot satisfy the declared parameter type (wrong enum, string where a
  number is expected, ...), assignments to undeclared variables, and
  version-availability warnings when a call exists only in the other PB
  version — conservative around non-exported libraries, variadic and
  multi-variant built-ins, member calls, and embedded SQL
- Syntax highlighting with proper embedded-SQL regions (SQL keywords and
  `:host` variables highlight only inside SQL statements), enumerated `Value!`
  constants, export headers, and line continuations
- Document outline/breadcrumbs and folding for all block constructs plus
  variables/prototypes sections
- Server-driven semantic highlighting (known calls, variables, enum values,
  types, properties) layered over the TextMate grammar
- Encoding detection for exports read from disk: UTF-16LE/BE (with or without
  BOM), UTF-8, and ANSI fallback — real PB exports index correctly
- **PowerBuilder: Generate OrcaScript** command — writes a `.orca` script that
  rebuilds the workspace's PBLs from the exported sources on disk (the
  documented `scc refresh target` offline pattern)
- Basic snippets for common code blocks

## Supported File Extensions

- `.sra` Application object
- `.srw` Window object
- `.sru` Custom user object
- `.srm` Menu object
- `.srd` DataWindow object
- `.srf` Global function
- `.srs` Structure
- `.srp` Data pipeline
- `.srq` Query
- `.srj` Project object

## Development

```bash
npm install
npm run compile
node tools/lsp-smoke.js   # end-to-end check of the compiled language server
```

Press `F5` in VS Code to launch an Extension Development Host.

The built-in catalogs live in `server/data/*.json`, generated from the Appeon
docs by `tools/docs-scraper/` (see its README to regenerate).

## Architecture

The extension is a thin client (`src/extension.ts`) that launches a Language Server (`server/`) over IPC:

- `server/builtins.ts` — types, formatters, and loaders for the scraped catalogs
- `server/builtins-2022.ts` / `server/builtins-2025.ts` — per-version catalogs loaded from `server/data/*.json`
- `server/indexer.ts` — workspace symbol/variable index, type inheritance, and `.srd` column extraction
- `server/diagnostics.ts` — comment/string-aware block-structure validator plus semantic call checks
- `server/textutils.ts` — cursor helpers for hover / signature help
- `server/server.ts` — wires the LSP features together

## Roadmap

- Validate against a real exported PowerBuilder workspace
- Publish to the VS Code Marketplace (requires the `jimmykirk` publisher
  account; `npx @vscode/vsce publish`)
- `ref`-argument awareness in signature help and diagnostics
- Event variant selection based on the enclosing object's type
