import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { BaoTreeProvider } from './tree';
import { MonitorPanel } from './monitorPanel';

/** Split "python" or "py -3" into exe + args for spawn() */
function splitExeAndArgs(cmd: string): { exe: string; args: string[] } {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  return { exe: parts[0], args: parts.slice(1) };
}

/** Resolve a possibly-relative baoPath against the current workspace */
function resolveBaoPath(p: string): string {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) return p;
  const candidate = path.join(ws, p);
  return fs.existsSync(candidate) ? candidate : p;
}

/** Pick a good target for settings updates */
function updateTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function showBaoPathHelpPanel(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'baoPathHelp',
    'What is bao.py?',
    vscode.ViewColumn.Active,
    { enableScripts: false }
  );
  panel.webview.html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: var(--vscode-font-family); padding: 16px; line-height: 1.5; }
        code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 4px; }
        pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 6px; overflow: auto; }
        h2 { margin-top: 0; }
      </style>
    </head>
    <body>
      <h2>bao.py path</h2>
      <p><strong>bao.py</strong> is the command-line script from your <em>bao-devkit</em> checkout. The extension calls it to list ports and open the serial monitor.</p>
      <p><b>Typical locations:</b></p>
      <ul>
        <li><code>C:\\code\\bao-devkit\\bao.py</code> (Windows)</li>
        <li><code>/Users/&lt;you&gt;/code/bao-devkit/bao.py</code> (macOS)</li>
        <li><code>/home/&lt;you&gt;/code/bao-devkit/bao.py</code> (Linux)</li>
      </ul>
      <p>Once selected, the path is saved in your settings so you won’t be asked again.</p>
      <p>Next step: close this tab and choose <em>“Choose bao.py…”</em> in the dialog.</p>
    </body>
    </html>
  `;
}

/** Ensure we have a valid bao.py path; prompt once if missing */
async function ensureBaoPath(context: vscode.ExtensionContext): Promise<string> {
  const cfg = vscode.workspace.getConfiguration();
  let p = resolveBaoPath(cfg.get<string>('baochip.baoPath') || '');
  if (p && fs.existsSync(p)) return p;

  // Info dialog with actions
  const choice = await vscode.window.showInformationMessage(
    'Baochip needs the path to your CLI script (bao.py).',
    { modal: true, detail: 'This is the Python file from the bao-devkit repo that is used to execute all the Baochip commands.' },
    'Choose bao.py…',
    'What is this?',
    'Cancel'
  );

  if (choice === 'What is this?') {
    showBaoPathHelpPanel(context);
    // After showing help, ask again
    return ensureBaoPath(context);
  }
  if (choice !== 'Choose bao.py…') {
    throw new Error('bao.py not set');
  }

  const picked = await vscode.window.showOpenDialog({
    title: 'Select bao.py',
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Use this bao.py',
    filters: { Python: ['py'] }
  });
  if (!picked || picked.length === 0) {
    throw new Error('bao.py not set');
  }
  const chosen = picked[0].fsPath;
  await cfg.update('baochip.baoPath', chosen, updateTarget());
  return chosen;
}


export function activate(context: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration();
  const getPython = () => cfg().get<string>('baochip.pythonCommand') || 'python';
  const getBaud = () => cfg().get<number>('baochip.defaultBaud') || 115200;
  const getPort = () => cfg().get<string>('baochip.defaultPort') || '';

  // Sidebar tree
  const tree = new BaoTreeProvider();
  vscode.window.registerTreeDataProvider('bao-view', tree);

  // Status bar: current port
  const portItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  portItem.command = 'baochip.setMonitorPort';
  const refreshPortItem = () => {
    const p = getPort();
    portItem.text = p ? `$(plug) Bao Port: ${p}` : '$(plug) Bao Port: (not set)';
    portItem.tooltip = 'Click to set monitor port';
    portItem.show();
  };
  refreshPortItem();
  context.subscriptions.push(portItem);

  // Set monitor port
  const setPortCmd = vscode.commands.registerCommand('baochip.setMonitorPort', async () => {
	let baoPath: string;
	try {
		baoPath = await ensureBaoPath(context);
	} catch (e: any) {
		vscode.window.showWarningMessage(e?.message || 'bao.py not set');
		return;
	}
    const ports = await listPorts(getPython(), baoPath).catch(err => {
      vscode.window.showErrorMessage(`Could not list ports: ${err.message || err}`);
      return [] as string[];
    });
    if (ports.length === 0) {
      vscode.window.showWarningMessage('No serial ports found.');
      return;
    }
    const picked = await vscode.window.showQuickPick(ports, { placeHolder: 'Select serial port' });
    if (!picked) return;
    await cfg().update('baochip.defaultPort', picked, updateTarget());
    refreshPortItem();
    tree.refresh();
  });

  // Monitor
  const monitorCmd = vscode.commands.registerCommand('baochip.openMonitor', async () => {
	const port = getPort();
	if (!port) {
		vscode.window.showInformationMessage('No port set. Pick one first.');
		await vscode.commands.executeCommand('baochip.setMonitorPort');
		return;
	}
	let baoPath: string;
	try {
		baoPath = await ensureBaoPath(context);
	} catch (e: any) {
		vscode.window.showWarningMessage(e?.message || 'bao.py not set');
		return;
	}
	MonitorPanel.show(context, {
		pythonCmd: getPython(),
		baoPath,
		port,
		baud: getBaud()
	});
	});

  context.subscriptions.push(setPortCmd, monitorCmd);
}

export function deactivate() {}

async function listPorts(pythonCmd: string, baoPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const { exe, args } = splitExeAndArgs(pythonCmd);
	const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
	const child = spawn(exe, [...args, baoPath, 'ports'], { env });
    let out = '', err = '';
    child.stdout.on('data', d => (out += d.toString()));
    child.stderr.on('data', d => (err += d.toString()));
    child.on('close', code => {
      if (code === 0) {
        const ports = out.split(/\r?\n/).map(l => l.split('\t')[0]).filter(Boolean);
        resolve(ports);
      } else {
        reject(new Error(err || `Exited ${code}`));
      }
    });
  });
}
