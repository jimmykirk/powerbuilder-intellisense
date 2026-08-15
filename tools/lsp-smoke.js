#!/usr/bin/env node
/**
 * End-to-end smoke test: spawns the compiled language server over stdio,
 * opens a synthetic PowerBuilder document, and exercises completion, hover,
 * and signature help. Run after `npm run compile`:  node tools/lsp-smoke.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fixture workspace on disk: a UTF-16LE (BOM) export, to prove encoding
// detection in the folder scan.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-smoke-'));
const UTF16_SRC = [
  '$PBExportHeader$w_utf16.srw',
  'global type w_utf16 from window',
  'end type',
  '',
  'public function integer wf_utf16_calc (integer ai_n)',
  'return ai_n * 2',
  'end function'
].join('\r\n');
fs.writeFileSync(
  path.join(fixtureDir, 'w_utf16.srw'),
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(UTF16_SRC, 'utf16le')])
);

const serverPath = path.join(__dirname, '..', 'out', 'server', 'server.js');
const child = spawn('node', [serverPath, '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });

let nextId = 1;
const pending = new Map();
const diagnosticsByUri = new Map();
let buffer = Buffer.alloc(0);

child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString();
    const length = parseInt(/Content-Length: (\d+)/.exec(header)[1], 10);
    if (buffer.length < headerEnd + 4 + length) return;
    const body = JSON.parse(buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.slice(headerEnd + 4 + length);
    if (body.id !== undefined && pending.has(body.id)) {
      pending.get(body.id)(body);
      pending.delete(body.id);
    } else if (body.method === 'textDocument/publishDiagnostics') {
      diagnosticsByUri.set(body.params.uri, body.params.diagnostics);
    }
  }
});

function send(message) {
  const json = JSON.stringify(message);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result);
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

const DOC = [
  /* 0*/ 'type variables',
  /* 1*/ 'private datawindow idw_main',
  /* 2*/ 'string is_title',
  /* 3*/ 'end variables',
  /* 4*/ '',
  /* 5*/ 'global type w_main from window',
  /* 6*/ 'end type',
  /* 7*/ '',
  /* 8*/ 'public function integer wf_calc (integer ai_x, integer ai_y)',
  /* 9*/ 'return ai_x + ai_y',
  /*10*/ 'end function',
  /*11*/ '',
  /*12*/ 'event clicked;',
  /*13*/ 'listview lv_items',
  /*14*/ 'lv_items.',
  /*15*/ 'idw_main.',
  /*16*/ 'this.',
  /*17*/ 'MessageBox(',
  /*18*/ 'idw_main.dataobject = "d_emp"',
  /*19*/ 'idw_main.object.',
  /*20*/ 'end event',
  /*21*/ '',
  /*22*/ 'event ue_chain;',
  /*23*/ 'this.idw_main.',
  /*24*/ 'end event',
  /*25*/ '',
  /*26*/ 'event ue_bind;',
  /*27*/ 'dw_shared.dataobject = "d_emp"',
  /*28*/ 'end event'
].join('\n');

const SRD = [
  'release 19;',
  'datawindow(units=0 timer_interval=0 color=1073741824)',
  'table(column=(type=char(10) updatewhereclause=yes name=emp_id dbname="employee.emp_id" )',
  ' column=(type=char(40) updatewhereclause=yes name=emp_name dbname="employee.emp_name" )',
  ' column=(type=decimal(2) updatewhereclause=yes name=salary dbname="employee.salary" )',
  ' )',
  'column(band=detail id=1 alignment="0" name=emp_id )',
  'column(band=detail id=2 alignment="0" name=emp_name )'
].join('\n');

const DIAG_DOC = [
  'event ue_test;',
  'string ls_name',
  'ls_name = Upper("abc")',
  'wf_missing(1)',
  'MessageBox("t", "m", Information!, OKCancel!, 2, 99)',
  'MessageBox("t", "m")',
  'BeginTransaction(1)',
  'ls_undeclared = 5',
  'MessageBox(42, "m")',
  'MessageBox("t", "m", OKCancel!)',
  'end event'
].join('\n');

const W2_DOC = [
  /*0*/ 'event ue_second;',
  /*1*/ 'datawindow dw_shared',
  /*2*/ 'dw_shared.object.',
  /*3*/ 'Close(',
  /*4*/ 'powerobject lpo_x',
  /*5*/ 'lpo_x = CREATE datastore',
  /*6*/ 'lpo_x.',
  /*7*/ 'powerobject lpo_c',
  /*8*/ 'dw_shared.GetChild("emp_id", lpo_c)',
  /*9*/ 'lpo_c.',
  /*10*/ 'end event'
].join('\n');
const W2_URI = 'file:///virtual/w_second.srw';

const FEATURE_DOC = [
  /* 0*/ 'type variables',
  /* 1*/ 'string is_title',
  /* 2*/ 'end variables',
  /* 3*/ '',
  /* 4*/ 'global type w_feat from window',
  /* 5*/ 'end type',
  /* 6*/ '',
  /* 7*/ 'event ue_go;',
  /* 8*/ 'string ls_emp',
  /* 9*/ 'SELECT emp_name INTO :',
  /*10*/ 'MessageBox("t", "m", ',
  /*11*/ 'this.Title',
  /*12*/ 'end event',
  /*13*/ '',
  /*14*/ 'event '
].join('\n');
const FEATURE_URI = 'file:///virtual/w_feat.srw';

const URI = 'file:///virtual/w_main.srw';
const SRD_URI = 'file:///virtual/d_emp.srd';
const DIAG_URI = 'file:///virtual/w_diag.srw';
let failures = 0;

function check(label, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`${mark}  ${label}${condition ? '' : ` — ${detail}`}`);
}

async function main() {
  await request('initialize', {
    processId: null,
    rootUri: null,
    workspaceFolders: [{ uri: `file://${fixtureDir}`, name: 'fixtures' }],
    capabilities: { workspace: { configuration: false } }
  });
  notify('initialized', {});
  notify('textDocument/didOpen', {
    textDocument: { uri: URI, languageId: 'powerbuilder', version: 1, text: DOC }
  });
  notify('textDocument/didOpen', {
    textDocument: { uri: SRD_URI, languageId: 'powerbuilder', version: 1, text: SRD }
  });

  const at = (line, character) => ({ textDocument: { uri: URI }, position: { line, character } });
  const labels = (items) => new Set((items.items ?? items).map((i) => i.label.toLowerCase()));

  // Dot completion on a builtin control type resolved from a local declaration
  const lv = labels(await request('textDocument/completion', at(14, 'lv_items.'.length)));
  check('lv_items. offers ListView members (AddItem)', lv.has('additem'), [...lv].slice(0, 8).join(','));
  check('lv_items. offers ListView events (Clicked)', lv.has('clicked'), [...lv].slice(0, 8).join(','));
  check('lv_items. offers universal members (TriggerEvent)', lv.has('triggerevent'), '');
  check('lv_items. omits global functions (Upper)', !lv.has('upper'), '');

  // Dot completion on an instance variable's type
  const dw = labels(await request('textDocument/completion', at(15, 'idw_main.'.length)));
  check('idw_main. offers DataWindow members', dw.size > 0 && !dw.has('upper'), [...dw].slice(0, 8).join(','));

  // this. resolves through the type declaration to window members + own symbols
  const self = labels(await request('textDocument/completion', at(16, 'this.'.length)));
  check('this. offers own function wf_calc', self.has('wf_calc'), [...self].slice(0, 8).join(','));
  check('this. offers window catalog members', self.has('changemenu') || self.has('arrangesheets'), [...self].slice(0, 12).join(','));
  check('this. offers instance variables', self.has('idw_main'), '');

  // Chained member access: this.idw_main. resolves through two hops
  const chained = labels(await request('textDocument/completion', at(23, 'this.idw_main.'.length)));
  check('chained this.idw_main. resolves to DataWindow members', chained.has('object') && !chained.has('upper'), [...chained].slice(0, 8).join(','));

  // Top-level completion: variables, builtins, events
  const top = labels(await request('textDocument/completion', at(11, 0)));
  check('top-level offers instance variable is_title', top.has('is_title'), '');
  check('top-level offers builtin MessageBox', top.has('messagebox'), '');
  check('top-level offers builtin event ItemChanged', top.has('itemchanged'), '');

  // Hover
  const hoverFn = await request('textDocument/hover', at(17, 3));
  check('hover on MessageBox shows docs', !!hoverFn && hoverFn.contents.value.includes('MessageBox'), JSON.stringify(hoverFn)?.slice(0, 80));
  const hoverVar = await request('textDocument/hover', at(15, 3));
  check('hover on idw_main shows type/scope', !!hoverVar && hoverVar.contents.value.includes('datawindow'), JSON.stringify(hoverVar)?.slice(0, 80));

  // DataWindow-aware completions
  const dwDot = labels(await request('textDocument/completion', at(15, 'idw_main.'.length)));
  check('idw_main. offers Object property', dwDot.has('object'), [...dwDot].slice(0, 8).join(','));
  const cols = await request('textDocument/completion', at(19, 'idw_main.object.'.length));
  const colLabels = labels(cols);
  check('dw.object. offers bound .srd columns', colLabels.has('emp_name') && colLabels.has('salary'), [...colLabels].join(','));
  const colDetail = (cols.items ?? cols).find((i) => i.label === 'emp_name')?.detail ?? '';
  check('dw.object. columns labeled with dataobject', colDetail.includes('d_emp'), colDetail);

  // Signature help inside MessageBox(
  const sig = await request('textDocument/signatureHelp', at(17, 'MessageBox('.length));
  check('signature help for MessageBox', !!sig && sig.signatures[0].label.includes('MessageBox'), JSON.stringify(sig)?.slice(0, 80));

  // Semantic diagnostics (server defaults to PB 2025; AccessToken is checked
  // against a separate doc below after nothing overrides the version)
  notify('textDocument/didOpen', {
    textDocument: { uri: DIAG_URI, languageId: 'powerbuilder', version: 1, text: DIAG_DOC }
  });
  await new Promise((r) => setTimeout(r, 500));
  const diags = diagnosticsByUri.get(DIAG_URI) ?? [];
  const onLine = (line) => diags.filter((d) => d.range.start.line === line);
  check('unknown call flagged as Information', onLine(3).some((d) => d.severity === 3 && d.message.includes('wf_missing')), JSON.stringify(diags).slice(0, 200));
  check('MessageBox with 6 args flagged as Warning', onLine(4).some((d) => d.severity === 2 && d.message.includes('at most 5')), JSON.stringify(onLine(4)));
  check('valid calls produce no diagnostics', onLine(2).length === 0 && onLine(5).length === 0, JSON.stringify([...onLine(2), ...onLine(5)]));

  // New-feature checks
  notify('textDocument/didOpen', {
    textDocument: { uri: FEATURE_URI, languageId: 'powerbuilder', version: 1, text: FEATURE_DOC }
  });
  await new Promise((r) => setTimeout(r, 300));

  // Property completion from the Objects and Controls catalog
  const winDot = labels(await request('textDocument/completion', {
    textDocument: { uri: FEATURE_URI }, position: { line: 11, character: 'this.'.length }
  }));
  check('this. offers Window properties (Title)', winDot.has('title'), [...winDot].slice(0, 10).join(','));

  // SQL host-variable completion after ':'
  const hostVars = labels(await request('textDocument/completion', {
    textDocument: { uri: FEATURE_URI }, position: { line: 9, character: 'SELECT emp_name INTO :'.length }
  }));
  check('SQL : offers local and instance vars', hostVars.has('ls_emp') && hostVars.has('is_title'), [...hostVars].join(','));
  check('SQL : omits builtin functions', !hostVars.has('messagebox'), '');

  // Enum values floated for the active argument (MessageBox icon param)
  const enumComp = await request('textDocument/completion', {
    textDocument: { uri: FEATURE_URI }, position: { line: 10, character: 'MessageBox("t", "m", '.length }
  });
  const enumLabels = labels(enumComp);
  check('enum values offered for Icon argument', enumLabels.has('information!') && enumLabels.has('stopsign!'), [...enumLabels].slice(0, 8).join(','));

  // Event stub completion
  const stubs = await request('textDocument/completion', {
    textDocument: { uri: FEATURE_URI }, position: { line: 14, character: 'event '.length }
  });
  const stubItems = stubs.items ?? stubs;
  const clickedStub = stubItems.find((i) => i.label.toLowerCase() === 'clicked');
  check('event stub offered for window events', !!clickedStub, stubItems.slice(0, 5).map((i) => i.label).join(','));
  check('event stub inserts end event skeleton', (clickedStub?.insertText ?? '').includes('end event'), clickedStub?.insertText);

  // Document symbols and folding
  const symbols = await request('textDocument/documentSymbol', { textDocument: { uri: URI } });
  check('document symbols include wf_calc and w_main', symbols.some((s) => s.name === 'wf_calc') && symbols.some((s) => s.name === 'w_main'), JSON.stringify(symbols.map((s) => s.name)));
  const folds = await request('textDocument/foldingRange', { textDocument: { uri: FEATURE_URI } });
  check('folding ranges cover variables block and event', folds.some((f) => f.startLine === 0) && folds.some((f) => f.startLine === 7), JSON.stringify(folds));

  // Version-availability: BeginTransaction exists in 2022 but not 2025
  check('2022-only builtin flagged with version note', onLine(6).some((d) => d.severity === 2 && /PB 2022/i.test(d.message)), JSON.stringify(onLine(6)));

  // Undeclared assignment target + literal type mismatches
  check('undeclared assignment flagged', onLine(7).some((d) => d.message.includes('ls_undeclared')), JSON.stringify(onLine(7)));
  check('numeric literal for string param flagged', onLine(8).some((d) => /Argument 1.*string/i.test(d.message)), JSON.stringify(onLine(8)));
  check('wrong enum for Icon param flagged', onLine(9).some((d) => /Icon.*OKCancel!.*Button/i.test(d.message)), JSON.stringify(onLine(9)));

  // Second window doc: cross-file dataobject binding + variant signatures
  notify('textDocument/didOpen', {
    textDocument: { uri: W2_URI, languageId: 'powerbuilder', version: 1, text: W2_DOC }
  });
  await new Promise((r) => setTimeout(r, 400));
  const w2at = (line, character) => ({ textDocument: { uri: W2_URI }, position: { line, character } });
  const crossCols = labels(await request('textDocument/completion', w2at(2, 'dw_shared.object.'.length)));
  check('cross-file dataobject binding resolves columns', crossCols.has('emp_name') && crossCols.has('salary'), [...crossCols].slice(0, 8).join(','));

  const closeSig = await request('textDocument/signatureHelp', w2at(3, 'Close('.length));
  check('Close shows multiple variant signatures', !!closeSig && closeSig.signatures.length >= 4, `got ${closeSig?.signatures?.length}`);
  check('variant signature labels carry docs syntax', !!closeSig && closeSig.signatures.some((s) => /Close\s*\(/i.test(s.label)), JSON.stringify(closeSig?.signatures?.[0]?.label));

  // References + rename across files (is_title is declared in both windows)
  const refs = await request('textDocument/references', {
    textDocument: { uri: URI }, position: { line: 2, character: 8 },
    context: { includeDeclaration: true }
  });
  const refUris = new Set(refs.map((r) => r.uri));
  check('references finds is_title across files', refs.length >= 2 && refUris.size >= 2, JSON.stringify(refs));

  const rename = await request('textDocument/rename', {
    textDocument: { uri: URI }, position: { line: 2, character: 8 }, newName: 'is_caption'
  });
  const editCount = Object.values(rename?.changes ?? {}).flat().length;
  check('rename edits every occurrence', editCount >= 2, JSON.stringify(rename).slice(0, 200));

  // Go to Definition into the .srd column
  const colDef = await request('textDocument/definition', {
    textDocument: { uri: FEATURE_URI }, position: { line: 9, character: 'SELECT emp'.length }
  });
  const colDefs = Array.isArray(colDef) ? colDef : colDef ? [colDef] : [];
  check('column name jumps into .srd definition', colDefs.some((l) => l.uri === SRD_URI), JSON.stringify(colDef));

  // Hover on a property through a chain, and on an enum value
  const propHover = await request('textDocument/hover', {
    textDocument: { uri: FEATURE_URI }, position: { line: 11, character: 'this.Ti'.length }
  });
  check('hover on this.Title shows property info', !!propHover && /property of window/i.test(propHover.contents.value), JSON.stringify(propHover)?.slice(0, 120));
  const enumHover = await request('textDocument/hover', {
    textDocument: { uri: DIAG_URI }, position: { line: 4, character: 'MessageBox("t", "m", Inf'.length }
  });
  check('hover on Information! shows enum info', !!enumHover && /Icon/.test(enumHover.contents.value), JSON.stringify(enumHover)?.slice(0, 120));

  // UTF-16LE export picked up by the workspace scan
  await new Promise((r) => setTimeout(r, 400));
  const wsSymbols = await request('workspace/symbol', { query: 'wf_utf16' });
  check('UTF-16LE export indexed by folder scan', wsSymbols.some((s) => s.name === 'wf_utf16_calc'), JSON.stringify(wsSymbols).slice(0, 150));

  // Deeper inference: CREATE assignment and GetChild ref-argument
  const created = labels(await request('textDocument/completion', w2at(6, 'lpo_x.'.length)));
  check('CREATE datastore refines powerobject receiver', created.has('object'), [...created].slice(0, 8).join(','));
  const childRef = labels(await request('textDocument/completion', w2at(9, 'lpo_c.'.length)));
  check('GetChild ref-arg infers datawindowchild', childRef.has('object'), [...childRef].slice(0, 8).join(','));

  // Semantic tokens
  const tokens = await request('textDocument/semanticTokens/full', { textDocument: { uri: DIAG_URI } });
  const types = [];
  for (let i = 3; i < (tokens?.data ?? []).length; i += 5) {
    types.push(tokens.data[i]);
  }
  check('semantic tokens produced', types.length > 0, JSON.stringify(tokens).slice(0, 100));
  check('semantic tokens include enum values', types.includes(2), `types seen: ${[...new Set(types)].join(',')}`);
  check('semantic tokens include function calls', types.includes(0), `types seen: ${[...new Set(types)].join(',')}`);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  child.kill();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  child.kill();
  process.exit(1);
});
