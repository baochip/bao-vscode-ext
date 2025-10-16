import * as vscode from 'vscode';
import { ensureBaoPath } from '@services/pathService';
import { listPorts } from '@services/portsService';
import { getPythonCmd, setMonitorPort } from '@services/configService';

export function registerSetMonitorPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return vscode.commands.registerCommand('baochip.setMonitorPort', async () => {
    let baoPath: string;
    try { baoPath = await ensureBaoPath(context); }
    catch (e: any) { vscode.window.showWarningMessage(e?.message || 'bao.py not set'); return; }

    const ports = await listPorts(getPythonCmd(), baoPath);
    if (ports.length === 0) { vscode.window.showWarningMessage('No serial ports found.'); return; }

    const picked = await vscode.window.showQuickPick(ports, { placeHolder: 'Select serial port' });
    if (!picked) return;
    await setMonitorPort(picked);
    refreshUI();
  });
}
