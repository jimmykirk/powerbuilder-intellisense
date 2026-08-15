#!/usr/bin/env node
/**
 * End-to-end smoke test: spawns the compiled language server over stdio,
 * opens a synthetic PowerBuilder document, and exercises completion, hover,
 * and signature help. Run after `npm run compile`:  node tools/lsp-smoke.js
 */
const { spawn } = require('child_process');
const path = require('path');

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
  /*20*/ 'end event'
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
  'end event'
].join('\n');

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

  // Semantic diagnostics
  notify('textDocument/didOpen', {
    textDocument: { uri: DIAG_URI, languageId: 'powerbuilder', version: 1, text: DIAG_DOC }
  });
  await new Promise((r) => setTimeout(r, 500));
  const diags = diagnosticsByUri.get(DIAG_URI) ?? [];
  const onLine = (line) => diags.filter((d) => d.range.start.line === line);
  check('unknown call flagged as Information', onLine(3).some((d) => d.severity === 3 && d.message.includes('wf_missing')), JSON.stringify(diags).slice(0, 200));
  check('MessageBox with 6 args flagged as Warning', onLine(4).some((d) => d.severity === 2 && d.message.includes('at most 5')), JSON.stringify(onLine(4)));
  check('valid calls produce no diagnostics', onLine(2).length === 0 && onLine(5).length === 0, JSON.stringify([...onLine(2), ...onLine(5)]));

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  child.kill();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  child.kill();
  process.exit(1);
});
