#!/usr/bin/env node
/**
 * Bundles the extension client and language server into dist/ as single
 * minified files. The scraped JSON catalogs are inlined into the server
 * bundle, so the packaged extension needs neither node_modules nor
 * out/server/data.
 */
const esbuild = require('esbuild');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  minify: true,
  sourcemap: false,
  logLevel: 'info'
};

Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode']
  }),
  esbuild.build({
    ...common,
    entryPoints: ['server/server.ts'],
    outfile: 'dist/server.js'
  })
]).catch(() => process.exit(1));
