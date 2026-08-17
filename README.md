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

## Settings

- `powerbuilder.version` — target PowerBuilder version, `2022` or `2025`
  (default `2025`). Selects which built-in catalog is used.
- `powerbuilder.ansiEncoding` — codepage for exports that are neither UTF-16
  nor UTF-8 (default `windows-1252`; use e.g. `windows-1253` for Greek). This
  cannot be detected from the file itself.

## Commands

- **PowerBuilder: Switch Version (2022 ↔ 2025)**
- **PowerBuilder: Generate OrcaScript to Rebuild PBLs from Source**

## Documentation

- [USAGE.md](USAGE.md) — day-to-day usage guide
- [CHANGELOG.md](CHANGELOG.md) — release notes
- [CONTRIBUTING.md](CONTRIBUTING.md) — building, architecture, and releasing

## Roadmap

- DataWindow expression functions that mirror runtime `dw.Object.<column>.<property>`
  chains for arbitrary column expressions beyond property completion (e.g.
  validating property names against the bound `.srd`'s actual column types)
- Cross-file "unused" analysis for instance variables (today's hint is
  single-file only, so a variable used solely by a descendant class or another
  object's direct access won't be seen)

## License

MIT — see [LICENSE](LICENSE).
