# PowerBuilder Support (VS Code)

PowerBuilder language support extension for Appeon PowerBuilder 2025.

## Features

- Syntax highlighting for PowerBuilder source files
- Auto-completion for keywords, ~55 built-in system functions, and custom functions/events indexed across the workspace
- Rich hover documentation with per-parameter descriptions for built-in functions, and signatures for custom functions
- Signature help (parameter hints) while typing a function call, with the active argument highlighted
- Workspace-wide **Go to Definition** for custom functions, subroutines, events, and object types
- Workspace symbol search (`Ctrl+T`) across all PowerBuilder files
- Parser-based structural diagnostics that flag unmatched block terminators (`if`/`end if`, `for`/`next`, `do`/`loop`, `choose case`/`end choose`, `try`/`end try`, function/subroutine/event/type blocks), ignoring keywords inside comments and strings
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
```

Press `F5` in VS Code to launch an Extension Development Host.

## Architecture

The extension is a thin client (`src/extension.ts`) that launches a Language Server (`server/`) over IPC:

- `server/builtins.ts` — catalog of built-in system functions with structured parameters
- `server/indexer.ts` — workspace symbol index (scans files on startup, updates on edit/save)
- `server/diagnostics.ts` — comment/string-aware block-structure validator
- `server/textutils.ts` — cursor helpers for hover / signature help
- `server/server.ts` — wires the LSP features together

## Roadmap

- Instance/shared variable indexing and completion
- Member completion after `.` using resolved object types
- DataWindow-aware completions
- Semantic (type-aware) diagnostics
