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

**VS Code Marketplace** (for VS Code proper) needs the `jimmykirk` publisher,
created once at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
The `+ New extension` button there accepts a `.vsix` upload directly, which
needs no token at all. For the CLI path instead, you need an Azure DevOps
Personal Access Token scoped to *Marketplace: Manage* with "All accessible
organizations":

```bash
npx vsce login jimmykirk                   # stores the PAT, or set VSCE_PAT
npm run publish
```

Note that creating an Azure DevOps organization from a work/school account
requires a linked Azure subscription; personal Microsoft accounts do not need
one. The web upload sidesteps this entirely.

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
keep them in step. Tag the release once it is live:

```bash
git tag -a v<version> -m "<version>" && git push --tags
```

`README.md` is rendered as the extension's Marketplace page, so changes to it
only reach users on the next published release.
