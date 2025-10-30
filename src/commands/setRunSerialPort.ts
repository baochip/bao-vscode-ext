import * as vscode from 'vscode';
import { resolveBaoPy, ensureXousCorePath, ensurePythonCmd } from '@services/pathService';
import { listPorts } from '@services/portsService';
import { setRunSerialPort } from '@services/configService';

export function registerSetRunSerialPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return vscode.commands.registerCommand('baochip.setRunSerialPort', async () => {
    let baoPath: string, cwd: string;
    try {
      baoPath = await resolveBaoPy();
      cwd = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showWarningMessage(e?.message || 'xous-core path not set');
      return;
    }

    const py = await ensurePythonCmd();
    const ports = await listPorts(py, baoPath, cwd).catch(err => {
      vscode.window.showErrorMessage(`Could not list ports: ${err.message || err}`);
      return [] as string[];
    });
    if (ports.length === 0) {
      vscode.window.showWarningMessage('No serial ports found.');
      return;
    }

    const picked = await vscode.window.showQuickPick(ports, {
      placeHolder: 'Select run mode (firmware) serial port',
    });
    if (!picked) return;

    await setRunSerialPort(picked);
    vscode.window.showInformationMessage(`Run mode serial port set to: ${picked}`);
    refreshUI();
  });
}
