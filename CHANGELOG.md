# Change Log

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
