# PowerBuilder Support (VS Code)

PowerBuilder language support extension for Appeon PowerBuilder 2022 and 2025
(switchable via the `powerbuilder.version` setting).

## Features

- Syntax highlighting for PowerBuilder source files
- Full built-in catalogs scraped from the official Appeon PowerScript Reference:
  914 (PB 2022) / 1,118 (PB 2025) system functions and 139 / 150 object events,
  with typed parameters, documentation, and `pbm_*` event IDs
- Auto-completion for keywords, built-in functions and events, instance/shared
  variables of the current object, workspace-wide globals, and custom
  functions/events indexed across the workspace
- Member completion after `.` — resolves the receiver's type from local
  declarations, indexed variables, or `this`/`super`, walks the inheritance
  chain, and offers workspace-defined members plus the built-in members of any
  built-in ancestor (matched via the docs' Applies-to lists)
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
- Semantic call diagnostics: unknown functions (Information) and too many
  arguments to a built-in (Warning), conservative around non-exported
  libraries, variadic built-ins, and member calls
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
- Object property catalogs (beyond functions/events) for hover and dot completion
- Type-aware argument checking and undeclared-variable diagnostics
- Go to Definition into DataWindow column definitions
