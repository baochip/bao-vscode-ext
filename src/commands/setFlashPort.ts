import * as vscode from 'vscode';
import { resolveBaoPy, ensureXousCorePath } from '@services/pathService';
import { listPorts } from '@services/portsService';
import { getPythonCmd, setFlashPort } from '@services/configService';

export function registerSetFlashPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return vscode.commands.registerCommand('baochip.setFlashPort', async () => {
    let baoPath: string, cwd: string;
    try {
      baoPath = await resolveBaoPy();
      cwd = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showWarningMessage(e?.message || 'xous-core path not set'); return;
    }

    const ports = await listPorts(getPythonCmd(), baoPath, cwd).catch(err => {
      vscode.window.showErrorMessage(`Could not list ports: ${err.message || err}`);
      return [] as string[];
    });
    if (ports.length === 0) { vscode.window.showWarningMessage('No serial ports found.'); return; }

    const picked = await vscode.window.showQuickPick(ports, { placeHolder: 'Select flash port' });
    if (!picked) return;
    await setFlashPort(picked);
    vscode.window.showInformationMessage(`Flash port set to ${picked}`);
    refreshUI();
  });
}
