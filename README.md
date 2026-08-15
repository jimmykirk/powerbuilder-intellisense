# PowerBuilder Support (VS Code)

PowerBuilder language support extension for Appeon PowerBuilder 2022 and 2025
(switchable via the `powerbuilder.version` setting).

## Features

- Syntax highlighting for PowerBuilder source files
- Full built-in catalogs scraped from the official Appeon docs: 914 (PB 2022) /
  1,118 (PB 2025) system functions, 139 / 150 object events (with `pbm_*` IDs),
  2,235 / 2,446 object properties across 155 / 185 classes, and ~70 enumerated
  datatypes with their `Value!` lists
- Auto-completion for keywords, built-in functions and events, instance/shared
  variables of the current object, workspace-wide globals, and custom
  functions/events indexed across the workspace
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
- DataWindow-aware completions: `.srd` exports are indexed for column names,
  `dw.Object.` completes the bound DataWindow object's columns, and
  DataWindow-typed receivers get `Object`/`DataObject` property items
- Rich hover documentation with per-parameter descriptions for built-in
  functions and events, signatures for custom functions, variable types/scopes,
  and type inheritance chains
- Signature help (parameter hints) while typing a function call, with the active argument highlighted
- Workspace-wide **Go to Definition** for custom functions, subroutines, events, and object types
- Workspace symbol search (`Ctrl+T`) across all PowerBuilder files
- Parser-based structural diagnostics that flag unmatched block terminators (`if`/`end if`, `for`/`next`, `do`/`loop`, `choose case`/`end choose`, `try`/`end try`, function/subroutine/event/type blocks), ignoring keywords inside comments and strings
- Semantic call diagnostics: unknown functions (Information), too many
  arguments to a built-in (Warning), and version-availability warnings when a
  call exists only in the other PB version ("added in PB 2025" / "removed
  after PB 2022") — conservative around non-exported libraries, variadic
  built-ins, and member calls
- Document outline/breadcrumbs and folding for all block constructs plus
  variables/prototypes sections
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

- Per-variant signatures for multi-syntax functions and events (Open, Close, Clicked, ...)
- Resolve `dataobject` bindings assigned outside the current document
- Type-aware argument checking and undeclared-variable diagnostics
- Go to Definition into DataWindow column definitions
- Hover for object properties and enumerated values
- Rename and Find All References for workspace symbols
