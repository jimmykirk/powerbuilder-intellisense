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
  active argument highlighted — multi-syntax built-ins (Open, Close, ...) show
  every documented variant, and events documented per object type (Clicked,
  DoubleClicked, DragDrop, ...) preselect the variant matching the enclosing
  object or the receiver, so a window's Clicked shows `xpos`/`ypos` while a
  ListView's shows `index`
- By-reference arguments are marked throughout: `ref` appears in signatures and
  hover, and passing a literal where the documented syntax declares `REF`
  (`GetChild`, `FileRead`, ...) is flagged, since PowerBuilder requires a
  variable there
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
- Built for real exports, not just tidy samples: `&` line continuations are
  joined before parsing, multiple statements per line (`event clicked;if ...`)
  are split, non-ASCII and punctuation identifiers (Greek menu names, `m_-`)
  are handled, and encoding detection covers UTF-16LE/BE, UTF-8, and a
  configurable ANSI codepage (`powerbuilder.ansiEncoding`)
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
npm test                                   # compile, bundle, 83 end-to-end LSP checks
node tools/corpus-check.js /path/to/src    # index real exports and report anomalies
```

`corpus-check.js` runs the parsers over a directory of real PowerBuilder
exports and reports what was indexed plus any structural diagnostics — which
should be zero on code that compiles. It is how the continuation, statement
splitting, and identifier rules below were found and verified.

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

## Publishing

Both registries are published from the same `.vsix`, so build it once and
upload that exact file to each:

```bash
npm run package                            # -> powerbuilder-intellisense-<version>.vsix
```

**VS Code Marketplace** (for VS Code proper) needs the `jimmykirk` publisher,
created once at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage),
and an Azure DevOps Personal Access Token scoped to *Marketplace: Manage* with
"All accessible organizations":

```bash
npx vsce login jimmykirk                   # stores the PAT, or set VSCE_PAT
npm run publish
```

**Open VSX** (for VSCodium, Cursor, Windsurf, Gitpod, and Eclipse Theia, which
cannot use the Microsoft Marketplace) needs an
[open-vsx.org](https://open-vsx.org) account, a signed Eclipse Foundation
Publisher Agreement, and a namespace claimed once:

```bash
npx ovsx create-namespace jimmykirk -p <token>
npm run publish:ovsx -- -p <token>         # or set OVSX_PAT
```

Publish the Marketplace first — if it rejects the package, nothing is live yet.
The two registries version independently, so re-run both on every release to
keep them in step.

## Roadmap

- DataWindow expression functions for `dw.Object.<column>.<property>` chains
- Unused local/instance variable hints
