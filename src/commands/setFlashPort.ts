import * as vscode from 'vscode';
import { ensureBaoPath } from '@services/pathService';
import { listPorts } from '@services/portsService';
import { getPythonCmd, setFlashPort } from '@services/configService';

export function registerSetFlashPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return vscode.commands.registerCommand('baochip.setFlashPort', async () => {
    let baoPath: string;
    try { baoPath = await ensureBaoPath(context); }
    catch (e: any) { vscode.window.showWarningMessage(e?.message || 'bao.py not set'); return; }

    const ports = await listPorts(getPythonCmd(), baoPath);
    if (ports.length === 0) { vscode.window.showWarningMessage('No serial ports found.'); return; }

    const picked = await vscode.window.showQuickPick(ports, { placeHolder: 'Select flash port' });
    if (!picked) return;
    await setFlashPort(picked);
    vscode.window.showInformationMessage(`Flash port set to ${picked}`);
    refreshUI();
  });
}
