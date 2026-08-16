# Change Log

## 0.3.1

Validated semantic diagnostics (unknown-function, argument-count,
argument-type, and undeclared-variable checks) against a much larger
real-world corpus (18,499 exported objects). False positives went from
164,832 warnings across 14,006 files to 3,218 across 304 — the remaining
cases stem from cross-file ancestor instance-variable resolution, a larger
architectural gap left for a future release.

- DataWindow/Query (`.srd`/`.srq`) exports use a declarative
  `key=(nested=key=value)` attribute syntax, not PowerScript; these are now
  detected (via their `release <n>;` header) and skipped entirely by
  semantic checks, instead of misreading attribute lines as undeclared
  variable assignments.
- PowerBuilder lets several documented member functions also be called bare
  with the receiver passed explicitly as the first argument (e.g.
  `TriggerEvent(this, "ue_init")`, `SetFocus(pb_save)`), or bare with no
  receiver at all from a script that inherits the function (e.g.
  `GetItemStatus(row, col, buffer!)`). Argument-count and argument-type
  checks now consider both call shapes before flagging a mismatch.
- `object.dynamic MethodName(args)` dynamic-dispatch calls are no longer
  mistaken for calls to an unrelated global/bare function named
  `MethodName`.
- Local variable declarations that share a physical source line with a
  preceding function/subroutine/event signature (`event ue_foo;longlong
  old_id, rtn`) are now recognised, instead of being flagged as "assigned
  but never declared" wherever they're later used.
- A comma inside a 2D array subscript (`arr[i,3]`) passed as a call
  argument is no longer miscounted as a second argument.

## 0.3.0

Validated against a real PowerBuilder application for the first time (OpenPay,
422 exported objects). Structural diagnostics went from **1,673 false
positives across 158 of 422 files to zero**.

- Logical-line preprocessing: `&` continuations are joined before any parsing,
  so continued declarations (`datawindow idw_a, &` / `idw_b`) no longer lose
  every variable after the first.
- Statement splitting on `;`: PowerBuilder packs several statements onto one
  line (`event dw::itemchanged;call super::itemchanged;choose case dwo.name`),
  which previously hid block openers and produced spurious unmatched-block
  errors.
- `on ... end on` blocks are recognised without a trailing semicolon, and
  `event` declarations inside a `type` block are no longer mistaken for event
  bodies.
- Identifiers may contain non-ASCII letters (Greek menu names) and type names
  may contain punctuation (`type m_- from menu`).
- ANSI decoding is configurable via `powerbuilder.ansiEncoding` (default
  windows-1252); the previous latin1 fallback mangled other codepages.
- New `tools/corpus-check.js` harness for running the parsers over real
  exports.

## 0.2.1

- By-reference arguments: the scrapers now read `REF` markers (and the declared
  types) straight from the documented syntax lines, so `ref` shows in
  signatures and hover, and passing a literal to a by-reference parameter is
  flagged as a warning.
- Events documented per object type now preselect the right variant in
  signature help and event-stub completion, chosen from the receiver or the
  enclosing object's inheritance chain — a window's `Clicked` shows
  `flags/xpos/ypos`, a ListView's shows `index`. A bare `event clicked;`
  implementation no longer hides the documented arguments.

## 0.2.0

- Renamed the extension to **PowerBuilder IntelliSense** (identifier
  `powerbuilder-intellisense`). The previous name understated the scope: the
  extension covers the DataWindow API, object properties, `.srd` objects, and
  workspace files, not only the PowerScript language. The repository moved to
  `github.com/jimmykirk/powerbuilder-intellisense`.

## 0.1.1

- Added the DataWindow Reference catalogs (253/254 methods, 57 events):
  `dw.Retrieve()`, `Update()`, `InsertRow()`, `GetItemString()` and the rest
  of the DataWindow API now complete, hover, and show signature help. Where a
  name exists in both books (RestClient `Retrieve`, JSONParser
  `GetItemString`), the resolved receiver decides which documentation wins.
- Completion now includes script locals and parameters, ranks results so your
  own identifiers precede the built-in catalog, ships without markdown and
  resolves documentation lazily (~693 KB no longer sent per keystroke), and
  offers structure members for structure-typed receivers.

## 0.1.0

- Replaced the hand-written catalogs with full data scraped from the official
  Appeon docs: 914 (PB 2022) / 1,118 (PB 2025) system functions, 139/150
  object events with `pbm_*` IDs, 2,235/2,446 object properties across
  155/185 classes, and ~70 enumerated datatypes — switchable between 2022 and
  2025 via the `powerbuilder.version` setting and the status-bar toggle.
- Member completion after `.` with receiver-type resolution, inheritance
  walking, chained access (`this.idw_main.`, `GetApplication().`), object
  properties, and deeper inference (`x = CREATE datastore`, `GetChild` ref
  arguments).
- DataWindow awareness: `.srd` column indexing, `dw.Object.` column
  completion with cross-file `dataobject` binding resolution, and Go to
  Definition into column definitions.
- Instance/shared/global variable indexing and completion; embedded SQL
  host-variable completion after `:`; enum values floated for enum-typed call
  arguments; event stub completion with `end event` skeletons.
- Signature help shows every documented variant of multi-syntax built-ins
  (Open, Close, Clicked, ...) with the best match preselected.
- Hover for built-in functions/events, properties through receiver chains,
  and enumerated values.
- Semantic diagnostics (debounced): unknown calls, arity and literal-type
  checks, undeclared assignment targets, and version-availability warnings.
- Document outline, folding ranges, Find All References, Rename, and
  server-driven semantic highlighting.
- Encoding detection for exports read from disk (UTF-16LE/BE BOMs, BOM-less
  UTF-16, UTF-8, ANSI fallback).
- TextMate grammar rewrite with proper embedded-SQL regions, enum `Value!`
  constants, export headers, and line continuations.
- "PowerBuilder: Generate OrcaScript" command rebuilds workspace PBLs from
  exported sources; `npm test` runs an end-to-end LSP smoke harness; CI
  workflow packages the extension on every push.

## 0.0.2

- Expanded the built-in function catalog to ~55 system functions with structured
  parameters and rich, per-parameter hover documentation.
- Added a workspace symbol index so Go to Definition and hover resolve custom
  functions, subroutines, events, and object types across every file in the
  project (not just the open document). Index updates on edit and on file save.
- Added workspace symbol search (`Ctrl+T`).
- Added signature help (parameter hints) for built-in and custom functions, with
  active-argument highlighting.
- Replaced the heuristic IF/END-IF check with a parser-based block-structure
  validator that is aware of comments and string literals and reports unmatched
  `if`/`for`/`do`/`choose`/`try` and function/subroutine/event/type blocks.

## 0.0.1

- Initial scaffold for PowerBuilder language support.
- Added language registration and file associations.
- Added TextMate grammar and snippets.
- Added Language Server with completion, hover, and definition support.
