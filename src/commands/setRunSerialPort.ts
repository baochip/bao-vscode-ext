import * as vscode from 'vscode';
import { ensureXousCorePath, runBaoCmd } from '@services/pathService';
import { setRunSerialPort as saveRunPort } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSetRunSerialPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.setRunSerialPort', async () => {
    let cwd: string;
    try {
      cwd = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showWarningMessage(e?.message || 'xous-core path not set');
      return;
    }

    const clicked = await vscode.window.showInformationMessage(
      'Is your Baochip board in run mode?',
      {
        modal: true,
        detail:
          'If you still see a removable drive named "BAOCHIP",\n' +
          'press PROG on the board to enter run mode.',
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
      placeHolder: 'Select run mode (firmware) serial port',
    });
    if (!picked) return;

    await saveRunPort(picked.label); // store only the bare port (e.g., "COM7")
    vscode.window.showInformationMessage(`Run mode serial port set to: ${picked.label}`);
    try { refreshUI(); } catch {}
  });
}
