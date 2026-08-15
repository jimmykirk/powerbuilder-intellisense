import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath(path.join('out', 'server', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] }
    }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'powerbuilder' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{sra,srw,sru,srm,srd,srf,srs,srp,srq,srj}')
    }
  };

  client = new LanguageClient(
    'powerbuilderLanguageServer',
    'PowerBuilder Language Server',
    serverOptions,
    clientOptions
  );

  context.subscriptions.push(client);
  await client.start();

  // Create status bar item to show and switch PB version
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'powerbuilder.switchVersion';
  updateStatusBar();
  context.subscriptions.push(statusBarItem);

  // Register command to switch version
  const switchVersionCmd = vscode.commands.registerCommand('powerbuilder.switchVersion', async () => {
    const config = vscode.workspace.getConfiguration('powerbuilder');
    const currentVersion = config.get<string>('version', '2025');
    const newVersion = currentVersion === '2025' ? '2022' : '2025';

    await config.update('version', newVersion, vscode.ConfigurationTarget.Workspace);
    updateStatusBar();
    vscode.window.showInformationMessage(`PowerBuilder version switched to ${newVersion}`);
  });
  context.subscriptions.push(switchVersionCmd);

  // Watch for version changes and update status bar
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('powerbuilder.version')) {
        updateStatusBar();
      }
    })
  );
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  const config = vscode.workspace.getConfiguration('powerbuilder');
  const version = config.get<string>('version', '2025');
  statusBarItem.text = `$(settings) PB ${version}`;
  statusBarItem.tooltip = 'Click to switch PowerBuilder version (2022 ↔ 2025)';
  statusBarItem.show();
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
  }
}
