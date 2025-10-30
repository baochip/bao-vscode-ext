import * as vscode from 'vscode';
import { resolveBaoPy, ensureXousCorePath, ensurePythonCmd } from '@services/pathService';
import { listPorts } from '@services/portsService';
import { setBootloaderSerialPort } from '@services/configService';

export function registerSetBootloaderSerialPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return vscode.commands.registerCommand('baochip.setBootloaderSerialPort', async () => {
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
      placeHolder: 'Select bootloader (drive mode) serial port',
    });
    if (!picked) return;

    await setBootloaderSerialPort(picked);
    vscode.window.showInformationMessage(`Bootloader (drive mode) serial port set to: ${picked}`);
    refreshUI();
  });
}
