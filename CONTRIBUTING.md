# Contributing

## Development

```bash
npm install
npm test                                   # compile, bundle, 83 end-to-end LSP checks
node tools/corpus-check.js /path/to/src    # index real exports and report anomalies
```

`corpus-check.js` runs the parsers over a directory of real PowerBuilder
exports and reports what was indexed plus any structural diagnostics — which
should be zero on code that compiles. It is how the continuation, statement
splitting, and identifier rules were found and verified.

Press `F5` in VS Code to launch an Extension Development Host.

The built-in catalogs live in `server/data/*.json`, generated from the Appeon
docs by `tools/docs-scraper/` (see its README to regenerate). The scrapers
cache the doc index pages as `tools/docs-scraper/*_index.html`; those are
gitignored and refetched automatically when absent.

## Architecture

The extension is a thin client (`src/extension.ts`) that launches a Language Server (`server/`) over IPC:

- `server/builtins.ts` — types, formatters, and loaders for the scraped catalogs
- `server/builtins-2022.ts` / `server/builtins-2025.ts` — per-version catalogs loaded from `server/data/*.json`
- `server/indexer.ts` — workspace symbol/variable index, type inheritance, and `.srd` column extraction
- `server/diagnostics.ts` — comment/string-aware block-structure validator plus semantic call checks
- `server/textutils.ts` — cursor helpers for hover / signature help
- `server/server.ts` — wires the LSP features together

The catalogs are inlined into `dist/server.js` at bundle time, so the packaged
extension ships neither `node_modules` nor `server/data`.

## Releasing

Bump `version` in `package.json`, add a `CHANGELOG.md` entry, then build once
and upload that same `.vsix` to both registries:

```bash
npm run package                            # -> powerbuilder-intellisense-<version>.vsix
```