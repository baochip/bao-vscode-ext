import * as vscode from 'vscode';
import { ensureXousCorePath, runBaoCmd } from '@services/pathService';
import { setBootloaderSerialPort as saveBootPort } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSetBootloaderSerialPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.setBootloaderSerialPort', async () => {
    let cwd: string;
    try {
      cwd = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showWarningMessage(e?.message || 'xous-core path not set');
      return;
    }

    const clicked = await vscode.window.showInformationMessage(
      'Is your Baochip board in bootloader mode?',
      {
        modal: true,
        detail:
          'Press RESET on the board if you do not\n' +
          'see a removable drive named "BAOCHIP".',
      },
      'OK'
    );
    if (clicked !== 'OK') return;

    const lines = await runBaoCmd(['ports'], cwd, { capture: true }).catch(err => {
      vscode.window.showErrorMessage(`Could not list ports: ${err.message || err}`);
      return '' as string;
    });

    const items = lines
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(line => {
        const [port, desc] = line.split('\t');
        return { label: port, description: desc || undefined };
      });

    if (items.length === 0) {
      vscode.window.showWarningMessage('No serial ports found.');
      return;
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select bootloader (drive mode) serial port',
    });
    if (!picked) return;

    await saveBootPort(picked.label); // store only the bare port
    vscode.window.showInformationMessage(`Bootloader (drive mode) serial port set to: ${picked.label}`);
    try { refreshUI(); } catch {}
  });
}
