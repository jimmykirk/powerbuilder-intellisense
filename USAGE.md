# PowerBuilder IntelliSense Usage Guide

This guide explains how to use the PowerBuilder IntelliSense extension in everyday development work.

## Overview

The extension adds language-aware support for PowerBuilder source files, including:

- workspace symbol indexing
- code completion
- inherited member lookup
- hover documentation
- signature help
- Go to Definition / Find References / Rename
- semantic diagnostics
- DataWindow-aware completion
- embedded SQL host-variable completion
- syntax highlighting and folding

It supports both PowerBuilder 2022 and 2025 via the `powerbuilder.version` setting.

---

## Installation and Setup

1. Open the project in VS Code.
2. Press `F5` to launch the extension in an Extension Development Host.
3. Open a PowerBuilder workspace or source folder.
4. If needed, set the version:
   - `powerbuilder.version`: `2022` or `2025`

The extension will index `.sra`, `.srw`, `.sru`, `.srm`, `.srd`, `.srf`, `.srs`, `.srp`, `.srq`, `.srj` files automatically.

---

## Supported File Types

- `.sra` — Application object
- `.srw` — Window object
- `.sru` — Custom user object
- `.srm` — Menu object
- `.srd` — DataWindow object
- `.srf` — Global function
- `.srs` — Structure
- `.srp` — Data pipeline
- `.srq` — Query
- `.srj` — Project object

---

## Core IntelliSense Features

### 1. Auto-completion

The extension completes:

- keywords
- built-in functions
- built-in events
- script locals and parameters
- instance/shared variables
- workspace globals
- structure members
- custom functions and events across the workspace

Completion is ranked so your own symbols appear before built-in catalog entries.

### 2. Member completion after `.`

When you type something like:

```powerscript
this.
mydw.
myobj.
```

it resolves the receiver type and tries to complete members from:

- the receiver's declared type
- local and indexed variables
- `this` / `super`
- the type's inheritance chain
- built-in ancestor object members that match the relevant PowerBuilder class catalog

This is especially useful for inherited properties, methods, and events.

### 3. Inheritance inspection

The index tracks custom type ancestry by reading declarations such as:

```powerscript
type mywindow from window
end type
```

From there, the extension can:

- resolve the immediate ancestor for a type
- walk the full inheritance chain
- show direct descendants
- surface inherited members during completion
- show inheritance information in hover output

For example, if you hover a type name or inspect an object member, the extension can display the path from the current type up to its root ancestor.

> Inheritance inspection is static and declaration-based: it follows the indexed type graph, not runtime object behavior.

### 4. Hover documentation

Hover over:

- custom functions
- variables
- built-ins
- properties
- enumerated values
- type names

The extension provides useful documentation, including parameter details and inheritance chains when relevant.

### 5. Signature help

While typing function or event calls, the extension suggests parameter lists and highlights the active argument.

This includes:

- built-in overloads and variants
- workspace-defined functions
- events that vary by object type
- DataWindow method signatures

---

## Go To Definition and Reference Search

The extension supports:

- Go to Definition for custom functions, subroutines, events, and object types
- Find All References
- Rename across the workspace
- DataWindow column navigation into `.srd` definitions

This works across files and is case-insensitive in the same way PowerScript identifiers behave.

---

## Diagnostics

The extension performs semantic checks while you type, including:

- unknown functions
- too many arguments to built-ins
- literal arguments that do not match expected types
- assignments to undeclared variables
- version-specific availability warnings for calls that exist only in one PB version
- structural block diagnostics such as mismatched `if` / `end if`, `for` / `next`, and similar constructs

---

## DataWindow Support

The extension is DataWindow-aware and supports:

- DataWindow and DataStore completion
- real method signatures from the DataWindow API
- column-name completion via `.srd` exports
- DataWindow object binding resolution
- `dw.Object.<column>` completion for column properties

When a receiver is DataWindow-like, the correct API wins even if the same method name exists elsewhere in the built-in catalog.

---

## Embedded SQL Support

Inside SQL statements, the extension understands host variables such as:

```powerscript
SELECT *
FROM mytable
WHERE id = :l_id
```

It offers:

- SQL host-variable completion
- SQL keyword highlighting within embedded SQL blocks

---

## Event Stubs and Object-Specific Events

When you type `event `, the extension can suggest event stubs appropriate to the current object type and inheritance chain.

It also resolves the correct event signature based on the enclosing object or receiver type.

---

## Workspace Search and Navigation

Use workspace symbol search to find:

- functions
- variables
- events
- types
- structures

This is especially useful in large PowerBuilder exports or shared object libraries.

---

## Quick Examples

### Type inheritance hover

```powerscript
type n_window from window
end type
```

Hover `n_window` and the extension can show:

- the type itself
- its parent chain
- direct descendants if known

### Inherited member completion

```powerscript
this.
```

If the current object inherits from a parent type, the completion list can include inherited members without needing to re-declare them in the child type.

### Property chain resolution

```powerscript
this.Title
mydw.Object.
GetApplication().
```

These chains resolve through declared types and their ancestors when possible.

---

## Best Practices

- Keep workspace exports indexed and saved before relying on cross-file navigation.
- Prefer actual exported project sources for validation because the parser is designed around real PowerBuilder output.
- Use hover and signature help to confirm the exact type chain for inherited methods and events.
- If a type is unresolved, some inherited members will fall back to broader catalog completion rather than a precise object-specific result.

---

## Known Limitations

The extension is designed for practical PowerBuilder development, but it is still a static analysis tool.

Current limits include:

- runtime-only inheritance patterns are not inferred
- some dynamic object creation cases depend on local declaration resolution
- complex dynamic dispatch is not fully interpreted as a runtime VM would
- the inheritance graph is declaration-based and workspace-indexed

---

## Useful Commands

In VS Code, common actions include:

- `Ctrl+T` — workspace symbol search
- Go to Definition
- Find All References
- Rename Symbol
- Hover for docs and chain inspection
- Signature help while typing calls

---

## Summary

This extension is most valuable when you want PowerBuilder-style developer assistance in a modern editor:

- accurate member completion
- inherited member awareness
- hover-based inspection
- workspace navigation
- semantic validation
- DataWindow-aware support

It is strongest when the workspace is indexed and the source files are real exported PowerBuilder code.
